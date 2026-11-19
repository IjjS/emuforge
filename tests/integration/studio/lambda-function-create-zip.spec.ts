// Creating a Lambda function from a developer's own .zip file in the built app, in front of a real engine and the
// run's emulator (issue 516, test-criteria.md, "Integration"; requirement "S3 (task 4)"): the runtimes the form
// offers, a function made from an uploaded archive with the handler typed, what the form refuses before it sends
// anything, and starter code for runtimes the form did not offer before.
//
// `studio.lambda-function-create-from-a-zip-file`.
//
// Every function and role is named under the check's prefix `<p>`. Words and readers:
// `services/lambda/lambda-tasks.ts`, `services/lambda/lambda-page.ts`; direct calls: `services/lambda/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import {
  functionNamesDirect,
  getFunctionDirect,
  invokeDirect,
  isGreeting,
  LambdaSeeded,
  waitForState,
} from './services/lambda/lambda';
import { functionPath } from './services/lambda/lambda-list';
import {
  createForm,
  fillForm,
  messageUnder,
  openCreateForm,
  optionLabels,
  RUNTIMES,
  runtimeOf,
} from './services/lambda/lambda-page';
import {
  CHOOSE_ZIP,
  chooseFile,
  echoZip,
  ENTER_HANDLER,
  FILE,
  HANDLER_FIELD,
  invokeWith,
  notAnArchiveFile,
  notAnArchiveText,
  OTHER_HANDLER,
  outputText,
  PYTHON,
  RESPONSE,
  resultText,
  Sent,
  STARTER_CODE,
  SUCCEEDED,
  testTab,
  UPLOAD_ZIP,
  zipFile,
} from './services/lambda/lambda-tasks';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

/** How long the form may take from "Create Event Function" to the function's page. */
const CREATE_BOUND_MS = 30_000;

test('studio.lambda-function-create-from-a-zip-file', async ({ ctx, page, context }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfz-create');
  const seeded = new LambdaSeeded(ctx, port, p);
  const sent = Sent.attach(context, stack.engine.url);
  const roleName = `${p}-role`;
  const roleArn = await seeded.role(roleName);
  const f = createForm(page);
  const handler = page.getByRole('main').getByLabel(HANDLER_FIELD, { exact: true });

  await lines.line(
    '"Create Event Function" → the runtimes offered are Node.js 24.x, 22.x, 20.x, 18.x and Python 3.14, 3.13, 3.12, 3.11, 3.10, 3.9, and "Code" is on "Starter code"',
    async () => {
      await openCreateForm(page);
      await f.runtime.click(ACTION);
      await expect.poll(() => optionLabels(page), { message: 'the options of "Runtime"' }).toEqual(
        RUNTIMES.map((r) => r.label),
      );
      expect(
        RUNTIMES.map((r) => r.label),
        'the ten of the requirement',
      ).toEqual([
        'Node.js 24.x',
        'Node.js 22.x',
        'Node.js 20.x',
        'Node.js 18.x',
        'Python 3.14',
        'Python 3.13',
        'Python 3.12',
        'Python 3.11',
        'Python 3.10',
        'Python 3.9',
      ]);
      await page.keyboard.press('Escape');
      await expect(f.radio(STARTER_CODE), `"${STARTER_CODE}"`).toBeChecked();
      await expect(f.radio(UPLOAD_ZIP), `"${UPLOAD_ZIP}"`).not.toBeChecked();
    },
  );

  await lines.line(
    'Name `<p>-zip`, "Python 3.13", "Use another role" with that role, "Upload a .zip file", the file echo v2, handler `lambda_function.other`, "Create Event Function" → S2 of `<p>-zip` on "Test"; the emulator reports the function with runtime `python3.13`, handler `lambda_function.other` and that role; "Invoke" → "Succeeded" and the response holds `"other"`',
    async () => {
      const name = `${p}-zip`;
      await openCreateForm(page);
      await fillForm(page, { name, runtime: PYTHON.label, role: roleName });
      await f.radio(UPLOAD_ZIP).check(ACTION);
      await expect(handler, `"${HANDLER_FIELD}", empty as the choice opens it`).toHaveValue('');
      await chooseFile(page, zipFile('echo-v2.zip', echoZip('v2')));
      await handler.fill(OTHER_HANDLER, ACTION);
      await f.create.click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: CREATE_BOUND_MS });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      await expect(testTab(page).event, 'the tab "Test" of the new function').toBeVisible();
      const read = await getFunctionDirect(ctx, port, name);
      expect(read.found, `a direct GetFunction ${name}`).toBe(true);
      if (!read.found) return;
      expect(
        { runtime: read.configuration.Runtime, handler: read.configuration.Handler, role: read.configuration.Role },
        'what the emulator reports',
      ).toEqual({ runtime: PYTHON.id, handler: OTHER_HANDLER, role: roleArn });
      expect(await waitForState(ctx, port, name), `the state of ${name}`).toBe('Active');
      await invokeWith(page, name);
      await expect.poll(() => resultText(page), { message: 'the outcome' }).toContain(SUCCEEDED);
      expect(await outputText(page, RESPONSE), `"${RESPONSE}"`).toBe('"other"');
    },
  );

  await lines.line(
    '"Upload a .zip file" with a name, no file and no handler → "Choose a .zip file." and "Enter a handler."; with the file `notes.zip` (plain text) and a handler → "notes.zip is not a .zip archive."; the emulator reports no function of either name',
    async () => {
      const empty = `${p}-nofile`;
      const notes = `${p}-notes`;
      const creates = sent.creates();
      await openCreateForm(page);
      await fillForm(page, { name: empty, runtime: PYTHON.label, role: roleName });
      await f.radio(UPLOAD_ZIP).check(ACTION);
      await f.create.click(ACTION);
      await expect
        .poll(
          async () => ({
            file: await messageUnder(page, FILE, CHOOSE_ZIP),
            handler: await messageUnder(page, HANDLER_FIELD, ENTER_HANDLER),
          }),
          { message: `"${CHOOSE_ZIP}" under "${FILE}" and "${ENTER_HANDLER}" under "${HANDLER_FIELD}"` },
        )
        .toEqual({ file: true, handler: true });

      await openCreateForm(page);
      await fillForm(page, { name: notes, runtime: PYTHON.label, role: roleName });
      await f.radio(UPLOAD_ZIP).check(ACTION);
      const file = notAnArchiveFile();
      await chooseFile(page, file);
      await handler.fill(OTHER_HANDLER, ACTION);
      await f.create.click(ACTION);
      await expect
        .poll(() => messageUnder(page, FILE, notAnArchiveText(file.name)), {
          message: `"${notAnArchiveText(file.name)}" under "${FILE}"`,
        })
        .toBe(true);
      expect(sent.creates(), 'CreateFunction requests the two forms sent').toBe(creates);
      const names = await functionNamesDirect(ctx, port, p);
      expect(
        names.filter((n) => n === empty || n === notes),
        'functions of either name in the emulator',
      ).toEqual([]);
    },
  );

  await lines.line(
    'With "Starter code", for each of "Node.js 20.x" and "Python 3.12" (runtimes `main` does not offer) → the function exists with that runtime, and a direct invoke returns the greeting',
    async () => {
      for (const label of ['Node.js 20.x', 'Python 3.12']) {
        const runtime = runtimeOf(label);
        const name = `${p}-${runtime.id.replace(/[^a-z0-9]/g, '')}`;
        await openCreateForm(page);
        await fillForm(page, { name, runtime: label, role: roleName });
        await expect(f.radio(STARTER_CODE), `"${STARTER_CODE}", as the form opens`).toBeChecked();
        await f.create.click(ACTION);
        await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: CREATE_BOUND_MS });
        const read = await getFunctionDirect(ctx, port, name);
        expect(read.found ? read.configuration.Runtime : read.errorType, `the runtime of ${name}`).toBe(runtime.id);
        expect(await waitForState(ctx, port, name), `the state of ${name}`).toBe('Active');
        const invoked = await invokeDirect(ctx, port, name);
        ctx.log(`a direct Invoke ${name} returned ${invoked.payload}`);
        expect(isGreeting(invoked.payload), `a direct Invoke ${name} returns the greeting`).toBe(true);
      }
    },
  );

  lines.end();
});
