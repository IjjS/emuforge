// The seeded state of the IAM role screens' structure score and captures (issue 82, requirement R12), made in the
// emulator of a given port with the direct calls of `iam.ts`:
//
// - `structure-role`: trusted by `lambda.amazonaws.com`, the description below, the AWS managed policy
//   `ReadOnlyAccess` attached, the inline policy `structure-inline` and the tag `purpose` = `structure-score`;
// - `structure-admin`: trusted by the emulator's own account (`arn:aws:iam::<account>:root`, the account of a direct
//   `GetUser`), no policy.
//
// The `pm` runs it at `final`, from the repository root, against the emulator of the run that serves the build being
// scored, before `pm-structure` opens the specs under `studio/references/console/iam/`:
//
//   NODE_PATH=studio/node_modules bun tests/integration/studio/support/iam-seed-structure.ts --port <emulator port>
//
// The role list is scored once against a fresh emulator before this runs (its empty run) and once after (its seeded
// run); a role's page and "Create role" are scored seeded only. Requests go to `127.0.0.1:<port>` only, signed with
// that emulator's own files under `$HOME/.aws/emulator/<port>/`, TLS verified against its `ca.pem`; nothing else of
// the environment is read. It prints one line per call (the action, the role and the outcome) and never a key. Run
// again on an emulator that holds the seed, it changes nothing: a role that exists is not made again and the other
// calls set what they set. It removes nothing; a restarted emulator holds no role (requirement R2).
// A script only: no check imports it. Exit code 0 when the seed is in place, 1 when a call failed, 2 for a wrong argument.

import {
  accountTrust,
  callerUserDirect,
  getRoleAnswer,
  IamSeeded,
  LAMBDA_TRUST,
  READ_ONLY_ACCESS,
  type Caller,
} from "./iam";
import { redact } from "./secrets";

/** The names and values of the seed (R12); `role-detail.yaml`'s route names `STRUCTURE_ROLE`. */
const STRUCTURE_ROLE = "structure-role";
const STRUCTURE_ADMIN = "structure-admin";
const STRUCTURE_INLINE = "structure-inline";
const STRUCTURE_DESCRIPTION = "Role of the structure score seed";
const STRUCTURE_TAG = { key: "purpose", value: "structure-score" };

function portArgument(argv: string[]): number | null {
  const at = argv.indexOf("--port");
  const value = at >= 0 ? argv[at + 1] : undefined;
  if (value === undefined || !/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? port : null;
}

/** Makes the seed in the emulator on `port`; each line of what it does goes to `caller.log`. */
async function seedStructure(caller: Caller, port: number): Promise<void> {
  const seed = new IamSeeded(caller, port);
  const account = (await callerUserDirect(caller, port)).account;
  if (!(await getRoleAnswer(caller, port, STRUCTURE_ROLE)).ok) {
    await seed.role(STRUCTURE_ROLE, {
      trust: LAMBDA_TRUST,
      description: STRUCTURE_DESCRIPTION,
    });
  }
  await seed.attach(STRUCTURE_ROLE, READ_ONLY_ACCESS);
  await seed.inline(STRUCTURE_ROLE, STRUCTURE_INLINE);
  await seed.tag(STRUCTURE_ROLE, [STRUCTURE_TAG]);
  if (!(await getRoleAnswer(caller, port, STRUCTURE_ADMIN)).ok) {
    await seed.role(STRUCTURE_ADMIN, { trust: accountTrust(account) });
  }
}

async function main(): Promise<number> {
  const port = portArgument(process.argv.slice(2));
  if (port === null) {
    console.error("usage: iam-seed-structure.ts --port <emulator port>");
    return 2;
  }
  const home = process.env.HOME;
  if (home === undefined || home === "") {
    console.error(
      "HOME is not set: the emulator files are under $HOME/.aws/emulator/<port>/",
    );
    return 2;
  }
  const caller: Caller = { home, log: (line) => console.log(redact(line)) };
  try {
    await seedStructure(caller, port);
  } catch (e) {
    console.error(
      redact(
        `the seed is not in place: ${e instanceof Error ? e.message : String(e)}`,
      ),
    );
    return 1;
  }
  console.log(
    `seeded ${STRUCTURE_ROLE} and ${STRUCTURE_ADMIN} in the emulator on 127.0.0.1:${String(port)}`,
  );
  return 0;
}

void main().then((code) => process.exit(code));
