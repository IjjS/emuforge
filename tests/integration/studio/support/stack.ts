// The whole path a developer opens: Studio's server, then the engine started for that Studio's origin, in front of
// an emulator that answers. Each piece is owned by the check and stopped when it ends.

import { type Ctx } from './check';
import { Engine, type EngineOptions } from './engine';
import { OwnEmulator, requireRunEmulator } from './emulator';
import { StudioServer } from './studio';

export interface Stack {
  studio: StudioServer;
  engine: Engine;
  /** The check's own emulator, when it asked for one; else the engine talks to the run's emulator. */
  emulator: OwnEmulator | null;
  /** The emulator port the engine was started with. */
  emulatorPort: number;
}

export interface StackOptions {
  /** Start an emulator of the check's own (checks labelled `own-emulator`). */
  ownEmulator?: boolean;
  /** Start the engine with this `--studio-port` instead of the port Studio is served on. */
  engineStudioPort?: number;
}

/**
 * Starts, in order: Studio's server (`bun run serve`) on the run's Studio port, the emulator (the run's, checked to
 * answer, or the check's own), and the engine on the run's engine port with `--studio-port` set to Studio's port.
 */
export async function startStack(ctx: Ctx, options: StackOptions = {}): Promise<Stack> {
  const studio = await StudioServer.start(ctx);
  let emulator: OwnEmulator | null = null;
  if (options.ownEmulator) emulator = await OwnEmulator.start(ctx);
  else await requireRunEmulator(ctx);
  const emulatorPort = emulator ? emulator.port : ctx.emulatorPort;
  const engineOptions: EngineOptions = {
    emulatorPort,
    studioPort: options.engineStudioPort ?? studio.port,
  };
  const engine = await Engine.start(ctx, engineOptions);
  return { studio, engine, emulator, emulatorPort };
}
