// The commands Home shows for recovery (requirement 3.2, 3.3), in shell continuation form: no line is longer than
// `MAX_COMMAND_LINE` characters for any port from 1 to 65535, so each reads unbroken in a 390-wide alert. Studio
// shows them to copy; it runs nothing.

export const MAX_COMMAND_LINE = 26;

/** Builds the `aws-emulator` image, from the root of the EmuForge checkout. */
export const BUILD_IMAGE_COMMAND = ['cd infra/aws-emulator', 'docker compose build'].join('\n');

/** Starts one emulator container on `port`; the port is set once in `P=`, so every other line keeps its length. */
export function startEmulatorCommand(port: number): string {
  return [
    'E=$HOME/.aws/emulator',
    `P=${String(port)}`,
    'docker run -d \\',
    '  --name \\',
    '  emuforge-emulator-$P \\',
    '  -p 127.0.0.1:$P:$P \\',
    '  -e HOME=$HOME \\',
    '  -v $E:$E \\',
    '  aws-emulator \\',
    '  -p $P -t off',
  ].join('\n');
}

/** Removes the container `startEmulatorCommand(port)` started, running or killed. */
export function stopEmulatorCommand(port: number): string {
  return ['docker rm -f \\', `  emuforge-emulator-${String(port)}`].join('\n');
}

export interface EngineCommandPorts {
  enginePort: number;
  studioPort: number;
  /** Added only when an earlier answer reported it; without it the engine's default 9297 applies. */
  emulatorPort?: number | undefined;
}

/** Starts the engine for this Studio, run in `engine/` of the EmuForge checkout. */
export function startEngineCommand({ enginePort, studioPort, emulatorPort }: EngineCommandPorts): string {
  const lines = [
    'cargo run',
    '  -p emuforge-server --',
    `  --port ${String(enginePort)}`,
    `  --studio-port ${String(studioPort)}`,
  ];
  if (emulatorPort !== undefined) {
    lines.push(`  --emulator-port ${String(emulatorPort)}`);
  }
  return lines.map((line, index) => (index < lines.length - 1 ? `${line} \\` : line)).join('\n');
}
