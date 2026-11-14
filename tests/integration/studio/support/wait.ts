// The one bounded wait for state outside the page (a port, a process, a container). Checks never sleep to let
// something happen; they wait for a condition and give up when the bound runs out. What the page shows is waited
// for with Playwright's own `expect(...)` and its `timeout`, which is the same kind of wait.

/**
 * Pause between two evaluations of a condition, so a wait does not spin a core. Not a synchronization delay: the
 * condition, not the time, decides when the wait ends.
 */
const POLL_INTERVAL_MS = 25;

/**
 * Evaluates `condition` until it returns a value other than `undefined`, for at most `boundMs`. Returns `undefined`
 * when the bound ran out. The condition is evaluated at least once, and once more after the bound has passed.
 */
export async function waitFor<T>(boundMs: number, condition: () => Promise<T | undefined> | T | undefined) {
  const deadline = Date.now() + boundMs;
  for (;;) {
    const value = await condition();
    if (value !== undefined) return value;
    const left = deadline - Date.now();
    if (left <= 0) return undefined;
    await new Promise((resolve) => setTimeout(resolve, Math.min(POLL_INTERVAL_MS, left)));
  }
}
