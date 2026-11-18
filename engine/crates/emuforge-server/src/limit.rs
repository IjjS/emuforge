//! The in-flight bound (L3, D11): one semaphore shared by every route, fallback and refusal. A request takes a
//! permit or is answered `503 Busy` at once; the permit moves into the response body and is released when that
//! body ends or is dropped, so a streamed relay body counts until its last byte. Studio's server has a bound of
//! its own, with its own semaphore and its own answer.

use std::pin::Pin;
use std::sync::Arc;
use std::task::{Context, Poll};

use axum::body::{Body, Bytes, HttpBody};
use axum::extract::{Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use http_body::{Frame, SizeHint};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::browser::engine_refusal;
use crate::routes::{Shape, refusal};

/// The bound and its semaphore.
#[derive(Clone)]
pub(crate) struct InFlight {
    max: usize,
    permits: Arc<Semaphore>,
}

impl InFlight {
    pub(crate) fn new(max: usize) -> InFlight {
        InFlight {
            max,
            permits: Arc::new(Semaphore::new(max)),
        }
    }

    /// A permit, or `None` at once when `max` requests are in flight.
    pub(crate) fn try_acquire(&self) -> Option<OwnedSemaphorePermit> {
        self.permits.clone().try_acquire_owned().ok()
    }
}

/// `response` with `permit` moved into its body, released when the body ends or is dropped.
pub(crate) fn hold(response: Response, permit: OwnedSemaphorePermit) -> Response {
    response.map(|body| Body::new(Permitted::new(body, permit)))
}

/// Outside the `Host` guard and inside the CORS layer. Never waits for a permit.
pub(crate) async fn limit(
    State(in_flight): State<InFlight>,
    request: Request,
    next: Next,
) -> Response {
    let Some(permit) = in_flight.try_acquire() else {
        let (parts, _body) = request.into_parts();
        let busy = refusal(
            StatusCode::SERVICE_UNAVAILABLE,
            "Busy",
            format!(
                "the engine is already serving {} requests; retry shortly",
                in_flight.max
            ),
        );
        return engine_refusal(Shape::of(&parts).apply(busy));
    };
    hold(next.run(request).await, permit)
}

/// A response body that holds an in-flight permit until it ends or is dropped.
struct Permitted {
    inner: Body,
    permit: Option<OwnedSemaphorePermit>,
}

impl Permitted {
    fn new(inner: Body, permit: OwnedSemaphorePermit) -> Permitted {
        Permitted {
            inner,
            permit: Some(permit),
        }
    }
}

impl HttpBody for Permitted {
    type Data = Bytes;
    type Error = axum::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Bytes>, axum::Error>>> {
        let this = self.get_mut();
        let frame = Pin::new(&mut this.inner).poll_frame(cx);
        if let Poll::Ready(None) = frame {
            this.permit = None;
        }
        frame
    }

    fn is_end_stream(&self) -> bool {
        self.inner.is_end_stream()
    }

    fn size_hint(&self) -> SizeHint {
        self.inner.size_hint()
    }
}
