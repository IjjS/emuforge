// The seeded state of the Lambda screens' structure score and captures (issue 84, requirement R12), made in the
// emulator on a given port with the direct calls of `lambda.ts`:
//
// - the role `structure-role`;
// - the function `structure-function`: `nodejs22.x`, `x86_64`, the description "Seeded for the structure score",
//   a function URL;
// - the function `structure-report`: `python3.13`, `arm64`, no description;
// - both functions `Active` before the script ends.
//
// The `pm` runs it from the checkout's root against the emulator of a run, before `pm-structure` scores the specs
// under `studio/references/console/lambda/`:
//
//   NODE_PATH=studio/node_modules bun tests/integration/studio/support/lambda-seed-structure.ts --port <emulator port>
//
// It talks only to `https://127.0.0.1:<port>`, signs with that emulator's own files under
// `$HOME/.aws/emulator/<port>/`, verifies TLS against its `ca.pem` and prints no key: each line it prints is an
// operation, a name and the emulator's status. What already exists is kept, so a second run changes nothing. It exits
// 0 once the seeded state holds, 1 otherwise.

import {
  createFunctionDirect,
  createFunctionUrlDirect,
  createRoleDirect,
  functionConfigurationDirect,
  functionUrlDirect,
  getRoleDirect,
  roleArnOf,
  shownDirect,
  waitForState,
  type Caller,
  type FunctionOptions,
} from './lambda';
import { redact } from './secrets';

const ROLE = 'structure-role';

const FUNCTIONS: {
  name: string;
  options: Omit<FunctionOptions, 'role'>;
  url: boolean;
}[] = [
  {
    name: 'structure-function',
    options: {
      runtime: 'nodejs22.x',
      architecture: 'x86_64',
      description: 'Seeded for the structure score',
    },
    url: true,
  },
  {
    name: 'structure-report',
    options: { runtime: 'python3.13', architecture: 'arm64' },
    url: false,
  },
];

function portArgument(argv: string[]): number {
  const at = argv.indexOf('--port');
  const port = at < 0 ? NaN : Number(argv[at + 1]);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('usage: lambda-seed-structure.ts --port <emulator port>');
  }
  return port;
}

async function seed(caller: Caller, port: number): Promise<void> {
  let roleArn = (await getRoleDirect(caller, port, ROLE))?.arn ?? null;
  if (roleArn === null) {
    const made = await createRoleDirect(caller, port, ROLE);
    if ('error' in made || made.status !== 200) throw new Error(`CreateRole ${ROLE}: ${shownDirect(made)}`);
    roleArn = roleArnOf(made.body);
  }
  for (const { name, options, url } of FUNCTIONS) {
    if ((await functionConfigurationDirect(caller, port, name)) === null) {
      const made = await createFunctionDirect(caller, port, name, {
        ...options,
        role: roleArn,
      });
      if ('error' in made || made.status !== 201) throw new Error(`CreateFunction ${name}: ${shownDirect(made)}`);
    }
    const state = await waitForState(caller, port, name);
    if (state !== 'Active') throw new Error(`${name} is ${String(state)}, not Active`);
    if (url && (await functionUrlDirect(caller, port, name)) === null) {
      const made = await createFunctionUrlDirect(caller, port, name);
      if ('error' in made || made.status !== 201) {
        throw new Error(`CreateFunctionUrlConfig ${name}: ${shownDirect(made)}`);
      }
    }
  }
}

const caller: Caller = {
  home: process.env.HOME ?? '',
  log: (line: string) => console.log(redact(line)),
};

try {
  if (caller.home === '') throw new Error('HOME is not set');
  const port = portArgument(process.argv.slice(2));
  await seed(caller, port);
  console.log(`seeded ${ROLE}, ${FUNCTIONS.map((f) => f.name).join(', ')} on 127.0.0.1:${String(port)}`);
} catch (e) {
  console.error(redact(`lambda-seed-structure: ${(e as Error).message}`));
  process.exit(1);
}
