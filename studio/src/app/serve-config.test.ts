import { describe, expect, it } from 'vitest';

import { ServeConfigError, serveConfig } from './serve-config';

describe("Studio's server configuration", () => {
  it('uses Studio port 8296, engine port 8297 and 127.0.0.1 when the settings are unset', () => {
    expect(serveConfig({})).toEqual({ listenAddress: '127.0.0.1', studioPort: 8296, enginePort: 8297 });
  });

  it('takes the ports from EMUFORGE_STUDIO_PORT and EMUFORGE_ENGINE_PORT, still on 127.0.0.1', () => {
    expect(serveConfig({ EMUFORGE_STUDIO_PORT: '8500', EMUFORGE_ENGINE_PORT: '8501' })).toEqual({
      listenAddress: '127.0.0.1',
      studioPort: 8500,
      enginePort: 8501,
    });
  });

  it.each(['0', '65536', 'abc'])('refuses EMUFORGE_STUDIO_PORT=%s with an error naming the setting', (value) => {
    let refused: unknown;
    try {
      serveConfig({ EMUFORGE_STUDIO_PORT: value });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(ServeConfigError);
    expect((refused as ServeConfigError).setting).toBe('EMUFORGE_STUDIO_PORT');
    expect((refused as Error).message).toContain('EMUFORGE_STUDIO_PORT');
  });
});
