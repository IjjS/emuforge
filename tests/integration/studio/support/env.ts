// The run's environment as `tests/integration/run` sets it, read once per process.
//
// | Variable | Meaning |
// |---|---|
// | `EMUFORGE_IT_VERDICTS` | directory for verdict files; logs go to its sibling `logs/` |
// | `EMUFORGE_IT_ENGINE_BIN` | the engine binary under test |
// | `EMUFORGE_IT_ENGINE_BUILD` | `ok`, `absent` or `failed`; anything but `ok` means there is no engine to run |
// | `EMUFORGE_IT_STUDIO_BUILD` | `ok`, `absent` or `failed`: `bun install --frozen-lockfile` and `bun run build` |
// | `EMULATOR_PORT` | the run's emulator, already started |
// | `EMUFORGE_ENGINE_PORT` | the port the engine a check starts listens on |
// | `EMUFORGE_STUDIO_PORT` | the port Studio's server a check starts listens on |
// | `EMUFORGE_IT_RUN_ID` | unique per run; names and labels the containers a check starts, and its emulators' image `aws-emulator:it-<run id>` |
// | `EMUFORGE_IT_PRODUCT_IMAGE` | the run's own name for the product form's image (`EMUFORGE_IMAGE` of a form) |
// | `EMUFORGE_IT_EMULATOR_IMAGE` | the run's own tag of its pinned emulator image (`EMUFORGE_EMULATOR_IMAGE` of a form) |
// | `EMUFORGE_IT_PRODUCT_BUILD` | `ok`, `absent` or `failed`: the run's build of the product image |
// | `EMUFORGE_IT_EMULATOR_VERSION`, `EMUFORGE_IT_EMULATOR_COMMIT` | the version and commit the run recorded |

import path from 'node:path';

export interface RunEnv {
  /** The checkout under test: `<checkout>/studio`, `<checkout>/engine`. */
  checkout: string;
  studioDir: string;
  /** `$HOME` of the run; the emulator writes its files under `$HOME/.aws/emulator/<port>/`. */
  home: string;
  verdicts: string;
  logs: string;
  /** Scratch space of the run, removed by `run` when it ends. */
  tmp: string;
  emulatorPort: number;
  enginePort: number;
  studioPort: number;
  engineBin: string;
  /** Why there is no engine binary to run, when `run` knows it. */
  engineMissing: string | null;
  /** Why there is no built Studio to serve, when `run` knows it. */
  studioMissing: string | null;
  runId: string;
  /**
   * The tag of the image every emulator a check starts runs: `it-<run id>`, the run's own image
   * `aws-emulator:it-<run id>` that `run` built, when `EMUFORGE_IT_RUN_ID` is set; else `latest`, the machine's image
   * `aws-emulator` (a check started by hand), never a name made from a process id.
   */
  emulatorTag: string;
  /** The run's names for the product form's images; `''` when `run` did not set them. */
  productImage: string;
  emulatorImage: string;
  /** Why the run's product image did not build, when `run` knows it. */
  productMissing: string | null;
  /** The emulator version and commit the run recorded; `''` when `run` did not set them. */
  emulatorVersion: string;
  emulatorCommit: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} is not set; run the suite with tests/integration/run`);
  }
  return value;
}

function port(name: string): number {
  const value = required(name);
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name}=${value} is not a port`);
  }
  return parsed;
}

function missing(build: string | undefined, what: string, absent: string): string | null {
  switch (build) {
    case undefined:
    case 'ok':
      return null;
    case 'absent':
      return absent;
    default:
      return `${what} ${build}, see output/logs/integration-${what.replace(' ', '-')}.log`;
  }
}

let cached: RunEnv | undefined;

export function runEnv(): RunEnv {
  if (cached) return cached;
  const checkout = path.resolve(__dirname, '..', '..', '..', '..');
  const verdicts = path.resolve(required('EMUFORGE_IT_VERDICTS'));
  const out = path.dirname(verdicts);
  cached = {
    checkout,
    studioDir: path.join(checkout, 'studio'),
    home: required('HOME'),
    verdicts,
    logs: path.join(out, 'logs'),
    tmp: path.join(out, 'tmp'),
    emulatorPort: port('EMULATOR_PORT'),
    enginePort: port('EMUFORGE_ENGINE_PORT'),
    studioPort: port('EMUFORGE_STUDIO_PORT'),
    engineBin: required('EMUFORGE_IT_ENGINE_BIN'),
    engineMissing: missing(process.env.EMUFORGE_IT_ENGINE_BUILD, 'engine build', 'engine/Cargo.toml does not exist'),
    studioMissing: missing(process.env.EMUFORGE_IT_STUDIO_BUILD, 'studio build', 'studio/package.json does not exist'),
    runId: process.env.EMUFORGE_IT_RUN_ID || String(process.pid),
    emulatorTag: process.env.EMUFORGE_IT_RUN_ID ? `it-${process.env.EMUFORGE_IT_RUN_ID}` : 'latest',
    productImage: process.env.EMUFORGE_IT_PRODUCT_IMAGE ?? '',
    emulatorImage: process.env.EMUFORGE_IT_EMULATOR_IMAGE ?? '',
    productMissing: missing(
      process.env.EMUFORGE_IT_PRODUCT_BUILD,
      'product build',
      'docker-compose.yml does not exist',
    ),
    emulatorVersion: process.env.EMUFORGE_IT_EMULATOR_VERSION ?? '',
    emulatorCommit: process.env.EMUFORGE_IT_EMULATOR_COMMIT ?? '',
  };
  return cached;
}
