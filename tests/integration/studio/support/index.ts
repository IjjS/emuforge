// Helpers shared by the Studio flow checks. The check contract is in `check.ts`. Everything a check starts (Studio's
// server, engines, emulators) is owned by its `ctx` and stopped when the check ends, so a failed assertion leaves
// nothing behind.

export { EnvError, expect, test, type Ctx } from './check';
export { Engine, type EngineOptions } from './engine';
export {
  OwnEmulator,
  answersOk,
  directHealth,
  emulatorDir,
  readEmulatorFiles,
  requireRunEmulator,
  type EmulatorFiles,
} from './emulator';
export { ensurePortFree, freePort, freePortExcept, isLoopback, probe } from './net';
export {
  COMMANDS,
  EMULATOR_FILES,
  Form,
  commandLine,
  containerIdentity,
  containersPublishing,
  health,
  productTimeout,
  signedS3,
  waitHealth,
  type FormOptions,
  type Situation,
} from './product';
export { register as registerSecret, redact } from './secrets';
export { startStack, type Stack, type StackOptions } from './stack';
export { StudioServer, type StudioOptions } from './studio';
export { waitFor } from './wait';
