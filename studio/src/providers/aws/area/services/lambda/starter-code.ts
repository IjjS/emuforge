import { offeredRuntime } from './runtimes';

// The starter code "Create Event Function" creates a function with (issue 84, requirement R6.2, R6.5; issue 516,
// design "Task 4"): one file per language, for each runtime of `runtimes.ts`, in the file and under the handler the
// user guide says the console creates (`getting-started`). Each handler is EmuForge's own and returns the greeting;
// nothing of the console's sample is copied. The texts are the ones the plan's probe created and invoked on the
// emulator (issue 84, `probe-4.log` §1).

/** The greeting every starter handler returns as its body, a JSON string. */
export const GREETING = 'Hello from EmuForge Studio!';

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

/** The starter code of an offered runtime, by its language; `undefined` for a runtime Studio does not offer. */
export function starterCode(runtime: string): StarterCode | undefined {
  const offered = offeredRuntime(runtime);
  if (offered === undefined) {
    return undefined;
  }
  return offered.language === 'nodejs' ? NODE : PYTHON;
}
