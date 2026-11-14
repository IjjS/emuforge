//! The one bounded wait. Checks never sleep to let something happen; they wait for a condition, and give up
//! when the bound runs out.

use std::time::{Duration, Instant};

/// Pause between two evaluations of a condition, so a wait does not spin a core. Not a synchronization
/// delay: the condition, not the time, decides when the wait ends.
const POLL_INTERVAL: Duration = Duration::from_millis(25);

/// Evaluates `condition` until it returns `Some`, for at most `bound`. Returns `None` when the bound ran out.
/// The condition is evaluated at least once, and once more after the bound has passed.
pub fn wait_for<T>(bound: Duration, mut condition: impl FnMut() -> Option<T>) -> Option<T> {
    let deadline = Instant::now() + bound;
    loop {
        if let Some(value) = condition() {
            return Some(value);
        }
        let now = Instant::now();
        if now >= deadline {
            return None;
        }
        std::thread::sleep(POLL_INTERVAL.min(deadline - now));
    }
}
