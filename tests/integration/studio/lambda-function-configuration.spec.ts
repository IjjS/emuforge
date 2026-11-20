// Changing a Lambda function's configuration from its page in the built app, in front of a real engine and the
// run's emulator (issue 516, test-criteria.md, "Integration"; requirement "Configuration (task 5)", "Code"): what
// the emulator holds is shown, each "Edit" dialog's "Save" reaches the emulator and takes effect at the next invoke,
// and a change the emulator refuses stays in its dialog and changes nothing.
// The rows of "Environment variables" are in one order, by key (issue 570, R1), whatever order they were typed in.
//
// `studio.lambda-configuration-edits-reach-the-emulator`.
//
// Every function is the check's own code, made directly under the check's prefix `<p>`. Words and readers:
// `services/lambda/lambda-tasks.ts`; direct calls: `services/lambda/lambda.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import {
  getFunctionDirect,
  LambdaSeeded,
  updateDescriptionDirect,
  type Caller,
  type FunctionConfiguration,
} from './services/lambda/lambda';
import { flashTexts, functionPath } from './services/lambda/lambda-list';
import {
  DESCRIPTION,
  EXECUTION_ROLE,
  functionPage,
  HANDLER,
  pairValue,
  RUNTIME,
  RUNTIME_SETTINGS,
} from './services/lambda/lambda-page';
import {
  ADD_VARIABLE,
  echoZip,
  EDIT_GENERAL,
  EDIT_RUNTIME,
  EDIT_VARIABLES,
  envZip,
  GENERAL,
  generalSavedText,
  invokeWith,
  NO_VARIABLES,
  openEdit,
  openOnTest,
  OTHER_HANDLER,
  outputText,
  PYTHON,
  PYTHON_HANDLER,
  REMOVE,
  RESPONSE,
  runtimeSavedText,
  shownVariables,
  toCode,
  toConfiguration,
  toTest,
  variablesSavedText,
} from './services/lambda/lambda-tasks';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

/** The configuration a direct `GetFunction name` reports. */
async function configurationDirect(caller: Caller, port: number, name: string): Promise<FunctionConfiguration> {
  const read = await getFunctionDirect(caller, port, name);
  expect(read.found, `a direct GetFunction ${name}`).toBe(true);
  if (!read.found) throw new Error('unreachable');
  return read.configuration;
}

/** The variables the emulator reports for `name`. */
async function variablesDirect(caller: Caller, port: number, name: string): Promise<Record<string, string>> {
  return (await configurationDirect(caller, port, name)).Environment?.Variables ?? {};
}

/** Waits until the Flashbar holds `text`. */
async function expectFlash(page: Page, text: string): Promise<void> {
  await expect
    .poll(async () => (await flashTexts(page)).some((t) => t.includes(text)), {
      message: `the Flashbar item "${text}"`,
    })
    .toBe(true);
}

test('studio.lambda-configuration-edits-reach-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfg-edits');
  const seeded = new LambdaSeeded(ctx, port, p);
  const env = `${p}-env`;
  const echo = `${p}-echo`;
  const made = await seeded.function(env, {
    runtime: PYTHON.id,
    description: 'first',
    memorySize: 128,
    timeout: 3,
    environment: { GREETING: 'hello-1' },
    code: { zip: envZip(), handler: PYTHON_HANDLER },
  });
  await seeded.function(echo, { runtime: PYTHON.id, code: { zip: echoZip('v2'), handler: PYTHON_HANDLER } });
  const general = async () => ({
    description: await pairValue(page, GENERAL, DESCRIPTION),
    memory: await pairValue(page, GENERAL, 'Memory'),
    timeout: await pairValue(page, GENERAL, 'Timeout'),
  });

  await lines.line(
    'S2 of env, the tab "Configuration" → the address ends `?tab=configuration`; "General configuration" shows "first", "128 MB", "3 seconds" and the role\'s ARN the emulator reports; "Environment variables" shows `GREETING` and `hello-1`',
    async () => {
      await openOnTest(page, env);
      await toConfiguration(page, env);
      await expect(page).toHaveURL(addressOf(`${functionPath(env)}?tab=configuration`));
      await expect
        .poll(async () => ({ ...(await general()), role: await pairValue(page, GENERAL, EXECUTION_ROLE) }), {
          message: `"${GENERAL}" of ${env}`,
        })
        .toEqual({ description: 'first', memory: '128 MB', timeout: '3 seconds', role: made.Role });
      expect(await shownVariables(page), 'the rows of "Environment variables"').toEqual([['GREETING', 'hello-1']]);
    },
  );

  await lines.line(
    '"Edit" of "General configuration": description `second`, memory 256, timeout 1, "Save" → "General configuration of {name} saved."; the section shows "second", "256 MB", "1 second"; the emulator reports the same three values',
    async () => {
      await openOnTest(page, env);
      await toConfiguration(page, env);
      const d = await openEdit(page, EDIT_GENERAL);
      await d.field('Description').fill('second', ACTION);
      await d.field('Memory (MB)').fill('256', ACTION);
      await d.field('Timeout (seconds)').fill('1', ACTION);
      await d.save.click(ACTION);
      await expect(d.dialog, `the dialog "${EDIT_GENERAL}" closes`).toHaveCount(0);
      await expectFlash(page, generalSavedText(env));
      await expect
        .poll(general, { message: `"${GENERAL}" after "Save"` })
        .toEqual({ description: 'second', memory: '256 MB', timeout: '1 second' });
      const c = await configurationDirect(ctx, port, env);
      expect(
        { description: c.Description, memory: c.MemorySize, timeout: c.Timeout },
        'what the emulator reports',
      ).toEqual({ description: 'second', memory: 256, timeout: 1 });
    },
  );

  await lines.line(
    '"Edit" of "Environment variables": `GREETING` to `hello-2`, "Add variable" `EXTRA` = `x`, "Save" → "Environment variables of {name} saved."; the section shows `EXTRA` `x`, then `GREETING` `hello-2`; the emulator reports exactly those two; on "Test", "Invoke" → the response holds `hello-2`',
    async () => {
      await openOnTest(page, env);
      await toConfiguration(page, env);
      // An update of the line before may still be in progress: "Edit" is available once the function is ready.
      await expect(page.getByRole('main').getByRole('button', { name: EDIT_VARIABLES, exact: true })).toBeEnabled({
        timeout: 20_000,
      });
      const d = await openEdit(page, EDIT_VARIABLES);
      await d.boxes('Value').first().fill('hello-2', ACTION);
      await d.dialog.getByRole('button', { name: ADD_VARIABLE, exact: true }).click(ACTION);
      await d.boxes('Key').nth(1).fill('EXTRA', ACTION);
      await d.boxes('Value').nth(1).fill('x', ACTION);
      await d.save.click(ACTION);
      await expect(d.dialog, `the dialog "${EDIT_VARIABLES}" closes`).toHaveCount(0);
      await expectFlash(page, variablesSavedText(env));
      await expect
        .poll(() => shownVariables(page), { message: 'the rows of "Environment variables"' })
        .toEqual([
          ['EXTRA', 'x'],
          ['GREETING', 'hello-2'],
        ]);
      expect(await variablesDirect(ctx, port, env), 'the variables the emulator reports').toEqual({
        GREETING: 'hello-2',
        EXTRA: 'x',
      });
      await toTest(page, env);
      await expect
        .poll(
          async () => {
            await invokeWith(page, env);
            return outputText(page, RESPONSE);
          },
          { message: `"${RESPONSE}" after the save`, timeout: 30_000 },
        )
        .toContain('hello-2');
    },
  );

  await lines.line(
    '"Edit" of "Environment variables": "Add variable" `AWS_REGION` = `x`, "Save" → the dialog stays open with `InvalidParameterValueException` and the emulator\'s message, the rows as typed; "Cancel"; the emulator reports the two variables of the line before',
    async () => {
      const before = await variablesDirect(ctx, port, env);
      await openOnTest(page, env);
      await toConfiguration(page, env);
      await expect(page.getByRole('main').getByRole('button', { name: EDIT_VARIABLES, exact: true })).toBeEnabled({
        timeout: 20_000,
      });
      const d = await openEdit(page, EDIT_VARIABLES);
      const rows = Object.keys(before).length;
      await d.dialog.getByRole('button', { name: ADD_VARIABLE, exact: true }).click(ACTION);
      await d.boxes('Key').nth(rows).fill('AWS_REGION', ACTION);
      await d.boxes('Value').nth(rows).fill('x', ACTION);
      const refused = page.waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).pathname === `/2015-03-31/functions/${env}/configuration`,
        { timeout: 20_000 },
      );
      await d.save.click(ACTION);
      const answer = await refused;
      const body = (await answer.json().catch(() => ({}))) as { message?: string; Message?: string };
      const message = body.message ?? body.Message ?? '';
      ctx.log(`the emulator refused the variables: ${String(answer.status())} ${message}`);
      expect(message, "the emulator's message names the reserved keys").toContain('reserved keys');
      await expect(d.dialog.getByText('InvalidParameterValueException').first(), 'the code as it came').toBeVisible();
      await expect(d.dialog, "the emulator's message as it came").toContainText(message);
      await expect(d.boxes('Key').nth(rows), 'the row as typed').toHaveValue('AWS_REGION');
      await expect(d.boxes('Value').nth(rows), 'the row as typed').toHaveValue('x');
      await d.cancel.click(ACTION);
      await expect(d.dialog, `the dialog "${EDIT_VARIABLES}" closes`).toHaveCount(0);
      expect(await variablesDirect(ctx, port, env), 'the variables the emulator reports').toEqual(before);
    },
  );

  await lines.line(
    '"Edit" of "Environment variables": "Remove" on both rows, "Save" → "No environment variables"; the emulator reports none',
    async () => {
      await openOnTest(page, env);
      await toConfiguration(page, env);
      await expect(page.getByRole('main').getByRole('button', { name: EDIT_VARIABLES, exact: true })).toBeEnabled({
        timeout: 20_000,
      });
      const d = await openEdit(page, EDIT_VARIABLES);
      const remove = d.dialog.getByRole('button', { name: REMOVE });
      for (let left = await remove.count(); left > 0; left = await remove.count()) {
        await remove.first().click(ACTION);
        await expect(remove, `"${REMOVE}" buttons after one row is removed`).toHaveCount(left - 1);
      }
      await d.save.click(ACTION);
      await expect(d.dialog, `the dialog "${EDIT_VARIABLES}" closes`).toHaveCount(0);
      await expect(page.getByRole('main').getByText(NO_VARIABLES, { exact: true }), `"${NO_VARIABLES}"`).toBeVisible();
      expect(await variablesDirect(ctx, port, env), 'the variables the emulator reports').toEqual({});
    },
  );

  await lines.line('The description changed directly to `third`, "Refresh" → "third"', async () => {
    await openOnTest(page, env);
    await toConfiguration(page, env);
    // A direct change during an update of the lines before is refused by the emulator: wait for it to be done.
    await expect
      .poll(async () => (await configurationDirect(ctx, port, env)).LastUpdateStatus, {
        message: `the last update of ${env} is done`,
        timeout: 20_000,
      })
      .toBe('Successful');
    await updateDescriptionDirect(ctx, port, env, 'third');
    await functionPage(page, env).refresh.click(ACTION);
    await expect
      .poll(() => pairValue(page, GENERAL, DESCRIPTION), { message: 'the description after "Refresh"' })
      .toBe('third');
  });

  await lines.line(
    'S2 of echo v2, "Code", "Edit" of "Runtime settings": runtime "Python 3.12", handler `lambda_function.other`, "Save" → "Runtime settings of {name} saved."; "Runtime settings" shows "Python 3.12" and the handler; the emulator reports `python3.12` and the handler; on "Test", "Invoke" → the response holds `"other"`',
    async () => {
      await openOnTest(page, echo);
      await toCode(page, echo);
      const d = await openEdit(page, EDIT_RUNTIME);
      await d.dialog.getByRole('button', { name: /^Runtime(\s|$)/ }).click(ACTION);
      await page.getByRole('option', { name: /^Python 3\.12(\s|$)/ }).first().click(ACTION);
      await d.field(HANDLER).fill(OTHER_HANDLER, ACTION);
      await d.save.click(ACTION);
      await expect(d.dialog, `the dialog "${EDIT_RUNTIME}" closes`).toHaveCount(0);
      await expectFlash(page, runtimeSavedText(echo));
      await expect
        .poll(
          async () => ({
            runtime: await pairValue(page, RUNTIME_SETTINGS, RUNTIME),
            handler: await pairValue(page, RUNTIME_SETTINGS, HANDLER),
          }),
          { message: `"${RUNTIME_SETTINGS}" after "Save"` },
        )
        .toEqual({ runtime: 'Python 3.12', handler: OTHER_HANDLER });
      const c = await configurationDirect(ctx, port, echo);
      expect({ runtime: c.Runtime, handler: c.Handler }, 'what the emulator reports').toEqual({
        runtime: 'python3.12',
        handler: OTHER_HANDLER,
      });
      await toTest(page, echo);
      await expect
        .poll(
          async () => {
            await invokeWith(page, echo);
            return outputText(page, RESPONSE);
          },
          { message: `"${RESPONSE}" after the save`, timeout: 30_000 },
        )
        .toBe('"other"');
    },
  );

  lines.end();
});
