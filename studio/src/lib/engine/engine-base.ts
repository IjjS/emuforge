// Where the page sends its engine and AWS requests (issue 503, requirement 3.5): the engine on loopback,
// `http://127.0.0.1:<engine port>`, or, when Studio's server names a channel path in `/config.json`, the page's own
// origin under that path (`<page origin><engine path>`). The path is recorded here once, when the page's
// configuration is read, so the AWS client factory accepts that one channel and no other.

export const ENGINE_HOST = '127.0.0.1';

// One or more segments `/<letters, digits, _ or ->`: no empty, dot or encoded segment, no query, no fragment, no
// host. Short enough to be a path, never a document.
const ENGINE_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/;
const MAX_ENGINE_PATH = 256;

/** A channel path `/config.json` may name: one or more segments of letters, digits, `_` or `-`. */
export function isEnginePath(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_ENGINE_PATH && ENGINE_PATH.test(value);
}

/** The engine's address on loopback for an engine port. */
export function loopbackBase(enginePort: number): string {
  return `http://${ENGINE_HOST}:${String(enginePort)}`;
}

/** The channel's address for the page's origin and a channel path. */
export function channelBase(pageOrigin: string, enginePath: string): string {
  return `${pageOrigin}${enginePath}`;
}

let acceptedPath: string | undefined;

/**
 * Records the channel path the page's configuration named, `undefined` when it named none. Only the page's
 * configuration calls it, once it has validated the path with `isEnginePath`; a value that is not one records none.
 */
export function acceptEnginePath(enginePath: string | undefined): void {
  acceptedPath = isEnginePath(enginePath) ? enginePath : undefined;
}

/** The page's own origin when it is an `http` or `https` one; `undefined` otherwise (an opaque origin). */
export function pageOrigin(): string | undefined {
  const origin = globalThis.location.origin;
  return origin.startsWith('http://') || origin.startsWith('https://') ? origin : undefined;
}

/** `<page origin><engine path>` for the recorded channel path; `undefined` when there is none. */
export function acceptedChannel(): string | undefined {
  const origin = pageOrigin();
  return acceptedPath === undefined || origin === undefined ? undefined : channelBase(origin, acceptedPath);
}
