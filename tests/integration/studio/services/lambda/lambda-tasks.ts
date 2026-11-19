// The tasks a developer does on a Lambda function's page and on the create form, as a user meets them (issue 516,
// test-criteria.md, "Integration"): the tab "Test" (the event, "Invoke", "Result"), the tab "Code" (the package, the
// upload of a .zip file, "Runtime settings"), the tab "Configuration" (its two sections and their dialogs), "Delete"
// in the page's header, and the code choice of "Create Event Function". Used by the `lambda-function-invoke`,
// `-code`, `-configuration`, `-delete-page` and `-create-zip` checks.
//
// - The check's own code: each a zip archive of one stored file the check writes (`storedZip` of
//   `services/lambda/lambda.ts`), never Studio's starter code.
// - Readers return what is drawn: the outcome's words, the text of "Response" and "Log tail" as shown, a section's
//   pairs (`pairValue` of `lambda-page.ts`), the rows of "Environment variables".
// - `Sent`: the page's Lambda requests to the engine by their path's end, from Playwright's request events; it only
//   listens. A check asserts with it that nothing was sent.
//
// Every value a check compares with comes from the run: names from the check's own prefix, the rest from a direct
// answer of the emulator.

import type { BrowserContext, Locator, Page } from '@playwright/test';

import { expect } from '../../support/check';
import { ACTION } from '../../support/frame';
import { storedZip } from './lambda';
import { functionPage, openFunction } from './lambda-page';

// ---------------------------------------------------------------------------------------------------------------
// The check's own code.
// ---------------------------------------------------------------------------------------------------------------

/** The Python runtime of the check's own functions, and the name the screens show for it. */
export const PYTHON = { id: 'python3.13', label: 'Python 3.13' };
export const PYTHON_FILE = 'lambda_function.py';
export const PYTHON_HANDLER = 'lambda_function.lambda_handler';
/** The second handler of the echo archive, which returns `"other"`. */
export const OTHER_HANDLER = 'lambda_function.other';

/** A Python function's archive: one file `lambda_function.py` holding `text`. */
export function pythonZip(text: string): Buffer {
  return storedZip(PYTHON_FILE, text);
}

/**
 * "echo": prints `echo-line <the event's "tag">` and returns `{"got": <the event>, "version": <version>}`; its
 * second handler `other` returns `"other"`.
 */
export function echoZip(version: 'v1' | 'v2'): Buffer {
  return pythonZip(
    [
      'def lambda_handler(event, context):',
      '    tag = event.get("tag") if isinstance(event, dict) else None',
      '    print("echo-line " + str(tag))',
      `    return {"got": event, "version": "${version}"}`,
      '',
      '',
      'def other(event, context):',
      '    return "other"',
      '',
    ].join('\n'),
  );
}

/** "node echo" (Node.js 22.x, `index.handler`): returns `{"got": <the event>}`. */
export const NODE_ECHO = {
  runtime: 'nodejs22.x',
  handler: 'index.handler',
  zip: () => storedZip('index.mjs', 'export const handler = async (event) => ({ got: event });\n'),
};

/** "raises": raises an error with `message`. */
export function raisesZip(message: string): Buffer {
  return pythonZip(`def lambda_handler(event, context):\n    raise Exception(${JSON.stringify(message)})\n`);
}

/** "slow": sleeps 3 seconds; made with a timeout of 1 second. */
export function slowZip(): Buffer {
  return pythonZip('import time\n\n\ndef lambda_handler(event, context):\n    time.sleep(3)\n    return "slept"\n');
}

/** The text "markup" prints and returns. */
export const MARKUP = '<img src=x onerror=alert(1)>';
export function markupZip(): Buffer {
  return pythonZip(
    `def lambda_handler(event, context):\n    print(${JSON.stringify(MARKUP)})\n    return ${JSON.stringify(MARKUP)}\n`,
  );
}

/** "env": returns the value of the environment variable `GREETING`. */
export function envZip(): Buffer {
  return pythonZip('import os\n\n\ndef lambda_handler(event, context):\n    return os.environ.get("GREETING")\n');
}

/** A file a check hands to a file field. */
export interface ChosenFile {
  name: string;
  mimeType: string;
  buffer: Buffer;
}

export function zipFile(name: string, buffer: Buffer): ChosenFile {
  return { name, mimeType: 'application/zip', buffer };
}

/** `notes.zip`: plain text under a .zip name, which is no archive. */
export function notAnArchiveFile(): ChosenFile {
  return zipFile('notes.zip', Buffer.from('These are notes, not an archive.\n', 'utf8'));
}

/** `big.zip`: a real archive of one stored file of 13 MB, past what the emulator takes in one request. */
export function bigZipFile(): ChosenFile {
  return zipFile('big.zip', storedZip('big.txt', 'a'.repeat(13 * 1024 * 1024)));
}

// ---------------------------------------------------------------------------------------------------------------
// The page's own requests.
// ---------------------------------------------------------------------------------------------------------------

/** The Lambda requests the page sent to the engine, as `METHOD path`. */
export class Sent {
  readonly requests: string[] = [];

  static attach(context: BrowserContext, engineOrigin: string): Sent {
    const sent = new Sent();
    context.on('request', (request) => {
      const url = new URL(request.url());
      if (url.origin === engineOrigin && !url.pathname.startsWith('/__emuforge/')) {
        sent.requests.push(`${request.method()} ${url.pathname}`);
      }
    });
    return sent;
  }

  /** How many `Invoke` requests were sent for `name`. */
  invokes(name: string): number {
    return this.requests.filter((r) => r === `POST /2015-03-31/functions/${name}/invocations`).length;
  }

  /** How many `UpdateFunctionCode` requests were sent for `name`. */
  codeUpdates(name: string): number {
    return this.requests.filter((r) => r === `PUT /2015-03-31/functions/${name}/code`).length;
  }

  /** How many `CreateFunction` requests were sent. */
  creates(): number {
    return this.requests.filter((r) => r === 'POST /2015-03-31/functions').length;
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The tabs.
// ---------------------------------------------------------------------------------------------------------------

/** Chooses the tab `tab` of the page of `name` and waits for the section `section` it shows. */
export async function chooseTab(page: Page, name: string, tab: string, section: string): Promise<void> {
  const f = functionPage(page, name);
  await f.tab(tab).click(ACTION);
  await expect(f.tab(tab), `the tab "${tab}", selected`).toHaveAttribute('aria-selected', 'true');
  await expect(f.section(section), `the section "${section}" of "${tab}"`).toBeVisible();
}

export const toTest = (page: Page, name: string) => chooseTab(page, name, 'Test', EVENT);
export const toCode = (page: Page, name: string) => chooseTab(page, name, 'Code', PACKAGE);
export const toConfiguration = (page: Page, name: string) => chooseTab(page, name, 'Configuration', GENERAL);

// ---------------------------------------------------------------------------------------------------------------
// "Test".
// ---------------------------------------------------------------------------------------------------------------

export const EVENT = 'Event';
export const EVENT_JSON = 'Event JSON';
export const INVOKE = 'Invoke';
export const RESULT = 'Result';
export const NOT_INVOKED = 'Not invoked yet';
export const NOT_JSON = 'Enter the event as one JSON value.';
export const SUCCEEDED = 'Succeeded';
export const FUNCTION_ERROR = 'The function returned an error';
export const REFUSED = 'The invocation was refused';
export const RESPONSE = 'Response';
export const LOG_TAIL = 'Log tail';

/** The parts of "Test" a check acts on. */
export function testTab(page: Page) {
  const main = page.getByRole('main');
  return {
    event: main.getByLabel(EVENT_JSON, { exact: true }),
    invoke: main.getByRole('button', { name: INVOKE, exact: true }),
    notInvoked: main.getByText(NOT_INVOKED, { exact: true }),
    notJson: main.getByText(NOT_JSON, { exact: true }),
  };
}

/**
 * The text drawn under the heading `title` ("Response", "Log tail") of "Result", as shown, its line breaks kept;
 * `null` when "Result" shows no such block.
 */
export async function outputText(page: Page, title: string): Promise<string | null> {
  return page.evaluate((wanted) => {
    const main = document.querySelector('main, [role="main"]');
    if (!main) return null;
    const heading = [...main.querySelectorAll('h3')].find((h) => h.innerText.trim() === wanted);
    if (!heading) return null;
    for (let at = heading.parentElement; at && at !== main; at = at.parentElement) {
      const code = at.querySelector('code');
      if (code) return code.innerText;
    }
    return null;
  }, title);
}

/** The words of "Result" as shown: the whole text of the section, white space collapsed. */
export async function resultText(page: Page): Promise<string> {
  return page.evaluate((title) => {
    const main = document.querySelector('main, [role="main"]');
    const heading = main ? [...main.querySelectorAll('h2')].find((h) => h.innerText.trim() === title) : undefined;
    if (!heading) return '';
    // The section is the nearest element around its title that holds more than the title.
    for (let at = heading.parentElement; at && at !== main; at = at.parentElement) {
      const text = at.innerText.replace(/\s+/g, ' ').trim();
      if (text !== title) return text;
    }
    return '';
  }, RESULT);
}

/**
 * Types `event` (when given) into "Event JSON", chooses "Invoke" and waits for the emulator's answer to reach the
 * page: the engine's response to the invoke, then "Invoke" available again.
 */
export async function invokeWith(page: Page, name: string, event?: string): Promise<void> {
  const t = testTab(page);
  if (event !== undefined) await t.event.fill(event, ACTION);
  const answered = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `/2015-03-31/functions/${name}/invocations`,
    { timeout: 60_000 },
  );
  await t.invoke.click(ACTION);
  await answered;
  await expect(t.invoke, `"${INVOKE}" available again`).toBeEnabled();
}

// ---------------------------------------------------------------------------------------------------------------
// "Code".
// ---------------------------------------------------------------------------------------------------------------

export const PACKAGE = 'Package';
export const CODE_SIZE = 'Code size';
export const SHA_256 = 'SHA-256';
export const UPLOAD = 'Upload';
export const FILE = 'File';
export const CHOOSE_ZIP = 'Choose a .zip file.';
export const EDIT_RUNTIME = 'Edit runtime settings';
export const SAVE = 'Save';

export function notAnArchiveText(file: string): string {
  return `${file} is not a .zip archive.`;
}
export function tooLargeText(file: string): string {
  return `The emulator refused ${file} as too large.`;
}
export function uploadedText(name: string): string {
  return `Code uploaded to ${name}.`;
}
export function runtimeSavedText(name: string): string {
  return `Runtime settings of ${name} saved.`;
}
export function codeSizeText(bytes: number): string {
  return `${String(bytes)} bytes`;
}

/** The file field of the page's main (the one a user's file chooser fills) and "Upload". */
export function upload(page: Page) {
  const main = page.getByRole('main');
  return {
    input: main.locator('input[type="file"]'),
    upload: main.getByRole('button', { name: UPLOAD, exact: true }),
  };
}

/** Chooses `file` in the file field, as the file chooser would. */
export async function chooseFile(page: Page, file: ChosenFile): Promise<void> {
  await upload(page).input.setInputFiles(file);
  await expect(page.getByRole('main').getByText(file.name).first(), `the chosen file ${file.name}`).toBeVisible();
}

/** A dialog of the page by its title, with its "Save" and "Cancel". */
export function editDialog(page: Page, title: string) {
  const dialog = page.getByRole('dialog', { name: title });
  return {
    dialog,
    save: dialog.getByRole('button', { name: SAVE, exact: true }),
    cancel: dialog.getByRole('button', { name: 'Cancel', exact: true }),
    field: (label: string): Locator => dialog.getByLabel(label, { exact: true }),
    /** The text boxes named `label`, one per row of a dialog with rows ("Key", "Value"), in the rows' order. */
    boxes: (label: string): Locator => dialog.getByRole('textbox', { name: label, exact: true }),
  };
}

/** Opens the dialog `title` with the button of that name in the page's main. */
export async function openEdit(page: Page, title: string) {
  await page.getByRole('main').getByRole('button', { name: title, exact: true }).click(ACTION);
  const d = editDialog(page, title);
  await expect(d.dialog, `the dialog "${title}"`).toBeVisible();
  return d;
}

// ---------------------------------------------------------------------------------------------------------------
// "Configuration".
// ---------------------------------------------------------------------------------------------------------------

export const GENERAL = 'General configuration';
export const VARIABLES = 'Environment variables';
export const EDIT_GENERAL = 'Edit general configuration';
export const EDIT_VARIABLES = 'Edit environment variables';
export const NO_VARIABLES = 'No environment variables';
export const ADD_VARIABLE = 'Add variable';
export const REMOVE = 'Remove';

export function generalSavedText(name: string): string {
  return `General configuration of ${name} saved.`;
}
export function variablesSavedText(name: string): string {
  return `Environment variables of ${name} saved.`;
}

/** The rows of "Environment variables" as shown: each key and value, in order; `[]` when the table is empty. */
export async function shownVariables(page: Page): Promise<[string, string][]> {
  return page.evaluate((title) => {
    const norm = (s: string) => s.replace(/\s+/g, ' ').trim();
    const main = document.querySelector('main, [role="main"]');
    const heading = main ? [...main.querySelectorAll('h2')].find((h) => norm(h.innerText) === title) : undefined;
    if (!heading) return [];
    for (let at = heading.parentElement; at && at !== main; at = at.parentElement) {
      const table = at.querySelector('table');
      if (!table) continue;
      return [...table.querySelectorAll('tbody tr')]
        .map((row) => [...row.querySelectorAll('td')].map((cell) => norm(cell.innerText)))
        .filter((cells) => cells.length === 2)
        .map((cells) => [cells[0], cells[1]] as [string, string]);
    }
    return [];
  }, VARIABLES);
}

// ---------------------------------------------------------------------------------------------------------------
// "Create Event Function": the code choice.
// ---------------------------------------------------------------------------------------------------------------

export const STARTER_CODE = 'Starter code';
export const UPLOAD_ZIP = 'Upload a .zip file';
export const HANDLER_FIELD = 'Handler';
export const ENTER_HANDLER = 'Enter a handler.';

/** Opens the page of `name` on "Test" and waits for the event field. */
export async function openOnTest(page: Page, name: string): Promise<void> {
  await openFunction(page, name);
  await expect(testTab(page).event, `"${EVENT_JSON}" of ${name}`).toBeVisible();
}
