//! Emulator state a check sets up straight through the emulator (never through the engine), with names that
//! carry the run's prefix, and guards that delete what was created when they drop, so a failed assertion
//! leaves nothing behind.

use std::cell::RefCell;

use crate::support::aws::{Call, Endpoint, Key, percent_encode};
use crate::support::check::{Ctx, Env};
use crate::support::http::Response;
use crate::support::pair::elements;

/// A name prefix unique to this run of this check, valid in S3 bucket, DynamoDB table, SQS queue and IAM
/// user names: `efit-<run id>-<tag>`, lower case.
pub fn prefix(ctx: &Ctx, tag: &str) -> String {
    let run: String = ctx
        .run_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("efit-{run}-{tag}")
}

/// Requests straight to the run's emulator, signed with its key.
#[derive(Clone)]
pub struct Direct<'a> {
    pub ctx: &'a Ctx,
    pub endpoint: Endpoint,
    pub key: Key,
}

impl<'a> Direct<'a> {
    pub fn new(ctx: &'a Ctx) -> Result<Direct<'a>, Env> {
        Ok(Direct {
            ctx,
            endpoint: Endpoint::emulator(ctx),
            key: Key::of_emulator(ctx, ctx.emulator_port)?,
        })
    }

    /// Any answer; `Env` when there is none.
    pub fn send(&self, what: &str, call: &Call) -> Result<Response, Env> {
        call.send(self.ctx, &self.endpoint, &self.key)
            .map_err(|e| Env::new(format!("{what} sent directly got no answer: {e}")))
    }

    /// A `2xx` answer; `Env` otherwise, since the check's Given would not hold.
    pub fn ok(&self, what: &str, call: &Call) -> Result<Response, Env> {
        let response = self.send(what, call)?;
        if (200..300).contains(&response.status) {
            Ok(response)
        } else {
            Err(Env::new(format!(
                "{what} sent directly answered {}: {}",
                response.status,
                response.text().chars().take(400).collect::<String>()
            )))
        }
    }

    fn cleanup(&self, what: &str, call: &Call) {
        match self.send(what, call) {
            Ok(r) if (200..300).contains(&r.status) => {
                self.ctx.log(format!("cleanup {what}: {}", r.status))
            }
            Ok(r) => self
                .ctx
                .log(format!("cleanup {what}: {} {}", r.status, r.text())),
            Err(Env(e)) => self.ctx.log(format!("cleanup {what}: {e}")),
        }
    }
}

/// An S3 bucket. On drop: every object the check put or tracked is deleted, then the bucket.
pub struct Bucket<'a> {
    direct: Direct<'a>,
    pub name: String,
    keys: RefCell<Vec<String>>,
}

impl<'a> Bucket<'a> {
    pub fn create(direct: &Direct<'a>, name: &str) -> Result<Bucket<'a>, Env> {
        direct.ok(
            &format!("CreateBucket {name}"),
            &Call::s3("PUT", &format!("/{name}")),
        )?;
        Ok(Bucket {
            direct: direct.clone(),
            name: name.to_owned(),
            keys: RefCell::new(Vec::new()),
        })
    }

    /// `/<bucket>/<key>`; `key` is used as it is in the path.
    pub fn path(&self, key: &str) -> String {
        format!("/{}/{key}", self.name)
    }

    /// Deletes `key` on drop, whoever creates it.
    pub fn track(&self, key: &str) {
        let mut keys = self.keys.borrow_mut();
        if !keys.iter().any(|k| k == key) {
            keys.push(key.to_owned());
        }
    }

    /// `PutObject` straight to the emulator.
    pub fn put(&self, key: &str, body: Vec<u8>) -> Result<Response, Env> {
        self.track(key);
        self.direct.ok(
            &format!("PutObject {key}"),
            &Call::s3("PUT", &self.path(key)).body(body),
        )
    }

    /// A multipart upload straight to the emulator, in parts of `part` bytes: for objects larger than the
    /// emulator accepts in one `PutObject` (16 MiB on v1.0.364).
    pub fn put_multipart(&self, key: &str, body: &[u8], part: usize) -> Result<(), Env> {
        self.track(key);
        let created = self.direct.ok(
            &format!("CreateMultipartUpload {key}"),
            &Call::s3("POST", &format!("{}?uploads", self.path(key))),
        )?;
        let id = elements(&created.body, "UploadId")
            .pop()
            .ok_or_else(|| Env::new("CreateMultipartUpload answered no UploadId"))?;
        let id = percent_encode(&id);
        let mut parts = String::new();
        for (i, bytes) in body.chunks(part).enumerate() {
            let n = i + 1;
            let uploaded = self.direct.ok(
                &format!("UploadPart {n} of {key}"),
                &Call::s3(
                    "PUT",
                    &format!("{}?partNumber={n}&uploadId={id}", self.path(key)),
                )
                .body(bytes.to_vec()),
            )?;
            let etag = uploaded
                .header("etag")
                .ok_or_else(|| Env::new(format!("UploadPart {n} answered no ETag")))?;
            parts.push_str(&format!(
                "<Part><PartNumber>{n}</PartNumber><ETag>{etag}</ETag></Part>"
            ));
        }
        let complete = format!("<CompleteMultipartUpload>{parts}</CompleteMultipartUpload>");
        self.direct.ok(
            &format!("CompleteMultipartUpload {key}"),
            &Call::s3("POST", &format!("{}?uploadId={id}", self.path(key)))
                .body(complete.into_bytes()),
        )?;
        Ok(())
    }
}

impl Drop for Bucket<'_> {
    fn drop(&mut self) {
        for key in self.keys.borrow().iter() {
            self.direct.cleanup(
                &format!("DeleteObject {key}"),
                &Call::s3("DELETE", &self.path(key)),
            );
        }
        self.direct.cleanup(
            &format!("DeleteBucket {}", self.name),
            &Call::s3("DELETE", &format!("/{}", self.name)),
        );
    }
}

/// A DynamoDB table with one string hash key `id`, billed per request. Deleted on drop (emulator v1.0.364
/// answers `DeleteTable` with `TableStatus: DELETING` and keeps listing the table; the run's prefix keeps a
/// later run from meeting it).
pub struct Table<'a> {
    direct: Direct<'a>,
    pub name: String,
}

impl<'a> Table<'a> {
    pub fn create(direct: &Direct<'a>, name: &str) -> Result<Table<'a>, Env> {
        let body = format!(
            r#"{{"TableName":"{name}","AttributeDefinitions":[{{"AttributeName":"id","AttributeType":"S"}}],"KeySchema":[{{"AttributeName":"id","KeyType":"HASH"}}],"BillingMode":"PAY_PER_REQUEST"}}"#
        );
        direct.ok(
            &format!("CreateTable {name}"),
            &Call::json("dynamodb", "DynamoDB_20120810.CreateTable", &body),
        )?;
        Ok(Table {
            direct: direct.clone(),
            name: name.to_owned(),
        })
    }
}

impl Drop for Table<'_> {
    fn drop(&mut self) {
        let body = format!(r#"{{"TableName":"{}"}}"#, self.name);
        self.direct.cleanup(
            &format!("DeleteTable {}", self.name),
            &Call::json("dynamodb", "DynamoDB_20120810.DeleteTable", &body),
        );
    }
}

/// Tracks the run's queue before CreateQueue, so cleanup also works after a bad relay response.
pub struct Queue<'a> {
    direct: Direct<'a>,
    name: String,
}

impl<'a> Queue<'a> {
    pub fn track(direct: &Direct<'a>, name: &str) -> Queue<'a> {
        Queue {
            direct: direct.clone(),
            name: name.to_owned(),
        }
    }

    fn remove(&self) -> Result<(), Env> {
        let mut query = serde_json::json!({"QueueNamePrefix": self.name, "MaxResults": 1000});
        loop {
            let response = self.direct.ok(
                "cleanup ListQueues",
                &Call::json("sqs", "AmazonSQS.ListQueues", &query.to_string()),
            )?;
            let page: serde_json::Value = serde_json::from_slice(&response.body)
                .map_err(|e| Env::new(format!("cleanup ListQueues: {e}")))?;
            if let Some(urls) = page["QueueUrls"].as_array() {
                for url in urls.iter().filter_map(|value| value.as_str()) {
                    if url
                        .rsplit_once('/')
                        .is_some_and(|(_, name)| name == self.name)
                    {
                        let body = serde_json::json!({"QueueUrl": url});
                        self.direct.cleanup(
                            "DeleteQueue",
                            &Call::json("sqs", "AmazonSQS.DeleteQueue", &body.to_string()),
                        );
                        return Ok(());
                    }
                }
            }
            let Some(next) = page["NextToken"].as_str().filter(|s| !s.is_empty()) else {
                return Ok(());
            };
            query["NextToken"] = serde_json::Value::String(next.to_owned());
        }
    }
}

impl Drop for Queue<'_> {
    fn drop(&mut self) {
        if let Err(Env(message)) = self.remove() {
            self.direct.ctx.log(message);
        }
    }
}

/// An IAM user. Deleted on drop.
pub struct User<'a> {
    direct: Direct<'a>,
    pub name: String,
}

impl<'a> User<'a> {
    pub fn create(direct: &Direct<'a>, name: &str) -> Result<User<'a>, Env> {
        direct.ok(
            &format!("CreateUser {name}"),
            &Call::query(
                "iam",
                &format!("Action=CreateUser&UserName={name}&Version=2010-05-08"),
            ),
        )?;
        Ok(User {
            direct: direct.clone(),
            name: name.to_owned(),
        })
    }
}

impl Drop for User<'_> {
    fn drop(&mut self) {
        self.direct.cleanup(
            &format!("DeleteUser {}", self.name),
            &Call::query(
                "iam",
                &format!(
                    "Action=DeleteUser&UserName={}&Version=2010-05-08",
                    self.name
                ),
            ),
        );
    }
}
