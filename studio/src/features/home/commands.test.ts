import { describe, expect, it } from 'vitest';

import { startEngineCommand } from './commands';

describe('startEngineCommand', () => {
  it('without an emulator port: runs the emuforge binary with serve, the engine port and the Studio port', () => {
    expect(startEngineCommand({ enginePort: 8297, studioPort: 5173 }).split('\n')).toEqual([
      'cargo run \\',
      '  -p emuforge -- serve \\',
      '  --port 8297 \\',
      '  --studio-port 5173',
    ]);
  });

  it('with an emulator port: the same lines, then --emulator-port as the last line', () => {
    expect(startEngineCommand({ enginePort: 8297, studioPort: 5173, emulatorPort: 9393 }).split('\n')).toEqual([
      'cargo run \\',
      '  -p emuforge -- serve \\',
      '  --port 8297 \\',
      '  --studio-port 5173 \\',
      '  --emulator-port 9393',
    ]);
  });
});
