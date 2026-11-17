// The starter code "Create Event Function" creates a function with (issue 84, requirement R6.2, R6.5): one file per
// runtime family, in the file and under the handler the user guide says the console creates (`getting-started`).
// Each handler is EmuForge's own and returns the greeting; nothing of the console's sample is copied. The texts are
// the ones the plan's probe created and invoked on the emulator for every runtime offered (`probe-4.log` §1).

/** The greeting every starter handler returns as its body, a JSON string. */
export const GREETING = 'Hello from EmuForge Studio!';

/** A runtime the create form offers: the console's name and the API's identifier. */
export interface OfferedRuntime {
  label: string;
  value: string;
}

/** The runtimes Studio has starter code for, in the order the form offers them; the first is chosen at start. */
export const RUNTIMES: readonly OfferedRuntime[] = [
  { label: 'Node.js 24.x', value: 'nodejs24.x' },
  { label: 'Node.js 22.x', value: 'nodejs22.x' },
  { label: 'Python 3.14', value: 'python3.14' },
  { label: 'Python 3.13', value: 'python3.13' },
];

/** The one file of a function's archive, and the handler that names it. */
export interface StarterCode {
  fileName: string;
  handler: string;
  text: string;
}

const NODE: StarterCode = {
  fileName: 'index.mjs',
  handler: 'index.handler',
  text: `export const handler = async () => ({ statusCode: 200, body: JSON.stringify(${JSON.stringify(GREETING)}) });\n`,
};

const PYTHON: StarterCode = {
  fileName: 'lambda_function.py',
  handler: 'lambda_function.lambda_handler',
  text: `import json


def lambda_handler(event, context):
    return {"statusCode": 200, "body": json.dumps(${JSON.stringify(GREETING)})}
`,
};

/** The starter code of an offered runtime, or `undefined` for a runtime the form does not offer. */
export function starterCode(runtime: string): StarterCode | undefined {
  if (!RUNTIMES.some(({ value }) => value === runtime)) {
    return undefined;
  }
  return runtime.startsWith('nodejs') ? NODE : PYTHON;
}
