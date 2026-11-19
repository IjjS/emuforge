// The page's public configuration, given by Studio's server at `GET /config.json` (`scripts/serve.ts`, or the
// binary's Studio server). Read once at start; anything unusable falls back to the defaults, so the app always renders.

import { acceptEnginePath, channelBase, isEnginePath, loopbackBase } from '../lib/engine/engine-base';

export interface StudioConfig {
  /** The engine's port on 127.0.0.1: what the page shows a user to run on the host. */
  enginePort: number;
  /**
   * The channel's path on the page's own origin (issue 503), where the page sends its engine and AWS requests; a
   * string of one or more segments `/<letters, digits, _ or ->`. `undefined` when `/config.json` names none or names
   * something else: the page then calls the engine on loopback.
   */
  enginePath: string | undefined;
}

export const DEFAULT_ENGINE_PORT = 8297;

const MAX_PORT = 65535;

const DEFAULTS: StudioConfig = { enginePort: DEFAULT_ENGINE_PORT, enginePath: undefined };

function isPort(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_PORT;
}

async function readConfig(): Promise<StudioConfig> {
  try {
    const response = await fetch('/config.json', { cache: 'no-store', credentials: 'same-origin' });
    if (!response.ok) {
      return DEFAULTS;
    }
    // A static server with an SPA fallback answers `index.html` here: not JSON, so the default applies.
    const body: unknown = await response.json();
    const fields = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const enginePort = fields.enginePort;
    const enginePath = fields.enginePath;
    return {
      enginePort: isPort(enginePort) ? enginePort : DEFAULT_ENGINE_PORT,
      enginePath: isEnginePath(enginePath) ? enginePath : undefined,
    };
  } catch {
    return DEFAULTS;
  }
}

let loaded: Promise<StudioConfig> | undefined;

/**
 * The page's configuration; `/config.json` is fetched on the first call only. Never rejects. Its channel path is
 * recorded for the AWS client factory, which accepts that channel as an endpoint.
 */
export function loadConfig(): Promise<StudioConfig> {
  loaded ??= readConfig().then((config) => {
    acceptEnginePath(config.enginePath);
    return config;
  });
  return loaded;
}

/**
 * Where the page sends its engine and AWS requests: `<pageOrigin><enginePath>` when the configuration names a
 * channel path, else the engine on loopback, `http://127.0.0.1:<enginePort>`.
 */
export function engineBase(config: StudioConfig, pageOrigin: string): string {
  return config.enginePath === undefined ? loopbackBase(config.enginePort) : channelBase(pageOrigin, config.enginePath);
}
