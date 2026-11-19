// Changing a Lambda function's code from its page in the built app, in front of a real engine and the run's
// emulator (issue 516, test-criteria.md, "Integration"; requirement "Code (tasks 3, 5)"): a .zip file a developer
// uploads becomes the function's code in the emulator, and a file Studio or the emulator refuses leaves the code as
// it was.
//
// `studio.lambda-upload-zip-changes-the-code`, `studio.lambda-upload-refusals-leave-the-code`.
//
// Every function is the check's own code, made directly under the check's prefix `<p>`. Words and readers:
// `services/lambda/lambda-tasks.ts`; direct calls: `services/lambda/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { getFunctionDirect, invokeDirect, LambdaSeeded, type Caller } from './services/lambda/lambda';
import { flashTexts, functionPath, runtimeText } from './services/lambda/lambda-list';
import { ARCHITECTURE, HANDLER, pairValue, RUNTIME, RUNTIME_SETTINGS } from './services/lambda/lambda-page';
import {
  bigZipFile,
  CHOOSE_ZIP,
  chooseFile,
  CODE_SIZE,
  codeSizeText,
  echoZip,
  invokeWith,
  LOG_TAIL,
  notAnArchiveFile,
  notAnArchiveText,
  openOnTest,
  outputText,
  PACKAGE,
  PYTHON,
  PYTHON_HANDLER,
  RESPONSE,
  Sent,
  SHA_256,
  testTab,
  toCode,
  tooLargeText,
  toTest,
  upload,
  uploadedText,
  zipFile,
} from './services/lambda/lambda-tasks';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

/** The code size and SHA-256 a direct `GetFunction name` reports. */
async function packageDirect(caller: Caller, port: number, name: string): Promise<{ size: number; sha: string }> {
  const read = await getFunctionDirect(caller, port, name);
  expect(read.found, `a direct GetFunction ${name}`).toBe(true);
  if (!read.found) throw new Error('unreachable');
  return { size: Number(read.configuration.CodeSize), sha: String(read.configuration.CodeSha256) };
}

/** The version the function `name` answers a direct `Invoke` with. */
async function versionDirect(caller: Caller, port: number, name: string): Promise<unknown> {
  const invoked = await invokeDirect(caller, port, name, {});
  expect(invoked.status, `a direct Invoke ${name}`).toBe(200);
  return (JSON.parse(invoked.payload) as { version?: unknown }).version;
}

test('studio.lambda-upload-zip-changes-the-code', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfc-upload');
  const seeded = new LambdaSeeded(ctx, port, p);
  const name = `${p}-echo`;
  const made = await seeded.function(name, {
    runtime: PYTHON.id,
    code: { zip: echoZip('v1'), handler: PYTHON_HANDLER },
  });
  const kept = `{"tag": "${p}-kept"}`;

  await lines.line(
    'S2, the tab "Code" → the address ends `?tab=code`; "Package" shows the code size (in bytes) and the SHA-256 the emulator reports for the function; "Runtime settings" shows "Python 3.13", the handler and the architecture',
    async () => {
      const direct = await packageDirect(ctx, port, name);
      await openOnTest(page, name);
      await toCode(page, name);
      await expect(page).toHaveURL(addressOf(`${functionPath(name)}?tab=code`));
      await expect
        .poll(
          async () => ({
            size: await pairValue(page, PACKAGE, CODE_SIZE),
            sha: await pairValue(page, PACKAGE, SHA_256),
            runtime: await pairValue(page, RUNTIME_SETTINGS, RUNTIME),
            handler: await pairValue(page, RUNTIME_SETTINGS, HANDLER),
            architecture: await pairValue(page, RUNTIME_SETTINGS, ARCHITECTURE),
          }),
          { message: `"${PACKAGE}" and "${RUNTIME_SETTINGS}" of ${name}` },
        )
        .toEqual({
          size: codeSizeText(direct.size),
          sha: direct.sha,
          runtime: runtimeText(made.Runtime),
          handler: PYTHON_HANDLER,
          architecture: (made.Architectures ?? []).join(', '),
        });
      expect(runtimeText(made.Runtime), 'the runtime as the screens name it').toBe(PYTHON.label);
    },
  );

  await lines.line(
    'On "Test" type the event `{"tag": "<prefix>-kept"}` and "Invoke" (the response holds `"v1"`); go to "Code", choose the file echo v2 and "Upload" → the Flashbar says "Code uploaded to {name}."; "Package" shows a new SHA-256 and code size, the ones the emulator then reports; the file field is empty',
    async () => {
      const before = await packageDirect(ctx, port, name);
      await openOnTest(page, name);
      await invokeWith(page, name, kept);
      await expect.poll(() => outputText(page, RESPONSE), { message: `"${RESPONSE}" before the upload` }).toContain(
        '"v1"',
      );
      await toCode(page, name);
      const file = zipFile('echo-v2.zip', echoZip('v2'));
      await chooseFile(page, file);
      await upload(page).upload.click(ACTION);
      await expect
        .poll(async () => (await flashTexts(page)).some((t) => t.includes(uploadedText(name))), {
          message: `the Flashbar item "${uploadedText(name)}"`,
        })
        .toBe(true);
      await expect
        .poll(() => pairValue(page, PACKAGE, SHA_256), { message: `"${SHA_256}" after the upload`, timeout: 20_000 })
        .not.toBe(before.sha);
      const after = await packageDirect(ctx, port, name);
      expect(after.sha, 'the emulator reports another SHA-256').not.toBe(before.sha);
      await expect
        .poll(
          async () => ({ size: await pairValue(page, PACKAGE, CODE_SIZE), sha: await pairValue(page, PACKAGE, SHA_256) }),
          { message: `"${PACKAGE}" shows what the emulator reports` },
        )
        .toEqual({ size: codeSizeText(after.size), sha: after.sha });
      await expect(page.getByRole('main').getByText(file.name), 'the file field, emptied').toHaveCount(0);
    },
  );

  await lines.line(
    'Back on "Test" → the event text `{"tag": "<prefix>-kept"}` and the result with `"v1"` are still there; "Invoke" → the response holds `"v2"`',
    async () => {
      await toTest(page, name);
      await expect(testTab(page).event, 'the event text, kept').toHaveValue(kept);
      expect(await outputText(page, RESPONSE), `"${RESPONSE}" of the invoke before the upload`).toContain('"v1"');
      expect(await outputText(page, LOG_TAIL), `"${LOG_TAIL}" of the invoke before the upload`).toContain(
        `echo-line ${p}-kept`,
      );
      // The emulator runs the new code once its update is done; the page's "Invoke" is asked until then.
      await expect
        .poll(
          async () => {
            await invokeWith(page, name);
            return outputText(page, RESPONSE);
          },
          { message: `"${RESPONSE}" after the upload`, timeout: 30_000 },
        )
        .toContain('"v2"');
    },
  );

  await lines.line('The emulator reports: a direct invoke of the function returns `"v2"`', async () => {
    await expect.poll(() => versionDirect(ctx, port, name), { message: `a direct Invoke ${name}` }).toBe('v2');
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-upload-refusals-leave-the-code', async ({ ctx, page, context }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfc-refused');
  const seeded = new LambdaSeeded(ctx, port, p);
  const sent = Sent.attach(context, stack.engine.url);
  const name = `${p}-echo`;
  await seeded.function(name, { runtime: PYTHON.id, code: { zip: echoZip('v1'), handler: PYTHON_HANDLER } });
  const start = await packageDirect(ctx, port, name);
  const main = page.getByRole('main');

  await lines.line(
    'On "Code", "Upload" with no file chosen → "Choose a .zip file."; no request to change the code left the page',
    async () => {
      await openOnTest(page, name);
      await toCode(page, name);
      await upload(page).upload.click(ACTION);
      await expect(main.getByText(CHOOSE_ZIP, { exact: true }), `"${CHOOSE_ZIP}"`).toBeVisible();
      expect(sent.codeUpdates(name), `UpdateFunctionCode requests for ${name}`).toBe(0);
    },
  );

  await lines.line(
    'A file `notes.zip` whose content is plain text, "Upload" → "notes.zip is not a .zip archive."; no request to change the code left the page',
    async () => {
      await openOnTest(page, name);
      await toCode(page, name);
      const file = notAnArchiveFile();
      await chooseFile(page, file);
      await upload(page).upload.click(ACTION);
      await expect(main.getByText(notAnArchiveText(file.name), { exact: true }), 'the message at the field').toBeVisible();
      expect(sent.codeUpdates(name), `UpdateFunctionCode requests for ${name}`).toBe(0);
    },
  );

  await lines.line(
    'A file `big.zip`, a real archive of 13 MB the check writes, "Upload" → "The emulator refused big.zip as too large." with the status as it came; the file stays chosen',
    async () => {
      await openOnTest(page, name);
      await toCode(page, name);
      const file = bigZipFile();
      await chooseFile(page, file);
      const answered = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).pathname === `/2015-03-31/functions/${name}/code`,
        { timeout: 120_000 },
      );
      await upload(page).upload.click(ACTION);
      const status = (await answered).status();
      ctx.log(`the engine answered the upload of ${file.name} with ${String(status)}`);
      const message = main.getByText(tooLargeText(file.name));
      await expect(message.first(), `"${tooLargeText(file.name)}"`).toBeVisible({ timeout: 30_000 });
      // The status as it came, beside the sentence: the number the engine's answer carried.
      const field = await message.first().evaluate((el) => (el.parentElement ?? el).innerText.replace(/\s+/g, ' '));
      expect(field, 'the status beside the sentence').toContain(String(status));
      // The file field's own entry: an element whose whole text is the file's name, which the sentence above (it
      // holds the name too) is not.
      const chosen = main.getByText(file.name, { exact: true });
      await expect(chosen, 'the file, still chosen in the field').toHaveCount(1);
      await expect(chosen, 'the file, still chosen in the field').toBeVisible();
      expect(
        await chosen.evaluate((el, sentence) => !(el.textContent ?? '').includes(sentence), tooLargeText(file.name)),
        'the field\'s entry is not the sentence',
      ).toBe(true);
      expect(sent.codeUpdates(name), `UpdateFunctionCode requests for ${name}`).toBe(1);
    },
  );

  await lines.line(
    'The emulator reports the SHA-256 it had at the start, and a direct invoke returns `"v1"`',
    async () => {
      expect(await packageDirect(ctx, port, name), `the package of ${name}`).toEqual(start);
      expect(await versionDirect(ctx, port, name), `a direct Invoke ${name}`).toBe('v1');
    },
  );

  lines.end();
});
