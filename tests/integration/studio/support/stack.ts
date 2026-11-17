// The whole path a developer opens: Studio's server, then the engine started for that Studio's origin, in front of
// an emulator that answers. Each piece is owned by the check and stopped when it ends.

import { type Ctx } from './check';
import { Engine, type EngineOptions } from './engine';
import { OwnEmulator, requireRunEmulator } from './emulator';
import { freePortExcept } from './net';
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
  /** With `ownEmulator`: the lowest port that emulator may get (10000 for a port of five digits). */
  ownEmulatorMinPort?: number | undefined;
  /** Start the engine with this `--studio-port` instead of the port Studio is served on. */
  engineStudioPort?: number;
  /**
   * Start the engine on a free port of at least this (10000 for a port of five digits) instead of the run's engine
   * port, and serve Studio with that engine port, whatever ports the run was given.
   */
  engineMinPort?: number;
}

/**
 * Starts, in order: Studio's server (`bun run serve`) on the run's Studio port, the emulator (the run's, checked to
 * answer, or the check's own), and the engine on the run's engine port with `--studio-port` set to Studio's port.
 *
 * With `engineMinPort` the emulator comes first, then the engine's port is chosen (none of the run's ports and not
 * the emulator's), then Studio's server is started with that engine port, then the engine on it.
 */
export async function startStack(ctx: Ctx, options: StackOptions = {}): Promise<Stack> {
  const startEmulator = async (): Promise<OwnEmulator | null> => {
    if (options.ownEmulator) return OwnEmulator.start(ctx, { minPort: options.ownEmulatorMinPort });
    await requireRunEmulator(ctx);
    return null;
  };
  let emulator: OwnEmulator | null = null;
  let enginePort: number | undefined;
  if (options.engineMinPort !== undefined) {
    emulator = await startEmulator();
    const taken = [ctx.emulatorPort, ctx.enginePort, ctx.studioPort, ...(emulator ? [emulator.port] : [])];
    enginePort = await freePortExcept(ctx.home, taken, { min: options.engineMinPort });
    ctx.log(`engine port ${String(enginePort)} chosen (at least ${String(options.engineMinPort)})`);
  }
  const studio = await StudioServer.start(ctx, enginePort === undefined ? {} : { enginePort });
  if (options.engineMinPort === undefined) emulator = await startEmulator();
  const emulatorPort = emulator ? emulator.port : ctx.emulatorPort;
  const engineOptions: EngineOptions = {
    emulatorPort,
    studioPort: options.engineStudioPort ?? studio.port,
    ...(enginePort === undefined ? {} : { port: enginePort }),
  };
  const engine = await Engine.start(ctx, engineOptions);
  return { studio, engine, emulator, emulatorPort };
}
