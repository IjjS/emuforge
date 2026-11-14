// Settings of Studio's own server (`scripts/serve.ts`), read from the environment once at start. The server binds
// loopback only; the engine port is handed to the page as public configuration (`GET /config.json`).

export const LISTEN_ADDRESS = '127.0.0.1';
export const DEFAULT_STUDIO_PORT = 8296;
export const DEFAULT_ENGINE_PORT = 8297;

const MAX_PORT = 65535;

export interface ServeConfig {
  /** Always `127.0.0.1`: Studio is never reachable from another address. */
  listenAddress: typeof LISTEN_ADDRESS;
  studioPort: number;
  enginePort: number;
}

export class ServeConfigError extends Error {
  readonly setting: string;

  constructor(setting: string, value: string) {
    super(`${setting} must be a port from 1 to ${String(MAX_PORT)}, not ${JSON.stringify(value)}.`);
    this.name = 'ServeConfigError';
    this.setting = setting;
  }
}

function port(env: Readonly<Record<string, string | undefined>>, setting: string, fallback: number): number {
  const value = env[setting];
  if (value === undefined || value === '') {
    return fallback;
  }
  if (!/^[0-9]{1,5}$/.test(value) || Number(value) < 1 || Number(value) > MAX_PORT) {
    throw new ServeConfigError(setting, value);
  }
  return Number(value);
}

/** The server's settings from `EMUFORGE_STUDIO_PORT` and `EMUFORGE_ENGINE_PORT`; throws `ServeConfigError`. */
export function serveConfig(env: Readonly<Record<string, string | undefined>>): ServeConfig {
  return {
    listenAddress: LISTEN_ADDRESS,
    studioPort: port(env, 'EMUFORGE_STUDIO_PORT', DEFAULT_STUDIO_PORT),
    enginePort: port(env, 'EMUFORGE_ENGINE_PORT', DEFAULT_ENGINE_PORT),
  };
}
