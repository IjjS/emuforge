// The page's public configuration, given by Studio's own server at `GET /config.json` (`scripts/serve.ts`). Read
// once at start; anything unusable falls back to the defaults, so the app always renders.

export interface StudioConfig {
  /** The engine's port on 127.0.0.1. */
  enginePort: number;
}

export const DEFAULT_ENGINE_PORT = 8297;

const MAX_PORT = 65535;

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PORT;
}

async function readConfig(): Promise<StudioConfig> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      return { enginePort: DEFAULT_ENGINE_PORT };
    }
    // A static server with an SPA fallback answers `index.html` here: not JSON, so the default applies.
    const body: unknown = await response.json();
    const enginePort = typeof body === 'object' && body !== null ? (body as { enginePort?: unknown }).enginePort : null;
    return { enginePort: isPort(enginePort) ? enginePort : DEFAULT_ENGINE_PORT };
  } catch {
    return { enginePort: DEFAULT_ENGINE_PORT };
  }
}

let loaded: Promise<StudioConfig> | undefined;

/** The page's configuration; `/config.json` is fetched on the first call only. Never rejects. */
export function loadConfig(): Promise<StudioConfig> {
  loaded ??= readConfig();
  return loaded;
}
