// The order of a Lambda function's environment variables on its page in the built app, in front of a real engine
// and the run's emulator (issue 570, test-criteria.md, "Integration"; requirement R1 to R3): the emulator answers
// `Environment.Variables`, a map, in another order with each answer, and Studio lists the variables in one order,
// ascending by key, compared by UTF-16 code unit, on the tab "Configuration" and when the editor opens.
//
// `studio.lambda-environment-variables-are-listed-by-key`.
//
// The function is the check's own code, made directly under the check's prefix `<p>`. Words and readers:
// `services/lambda/lambda-tasks.ts`; direct calls: `services/lambda/lambda.ts`. What shows that a later read has
// arrived is a value only that read holds (`MID`), never a time.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { getFunctionDirect, LambdaSeeded, updateVariablesDirect, type Caller } from './services/lambda/lambda';
import { flashTexts } from './services/lambda/lambda-list';
import { functionPage } from './services/lambda/lambda-page';
import {
  ADD_VARIABLE,
  EDIT_VARIABLES,
  editorKeys,
  envZip,
  openEdit,
  openOnTest,
  PYTHON,
  PYTHON_HANDLER,
  shownVariables,
  toConfiguration,
  variablesSavedText,
} from './services/lambda/lambda-tasks';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';

/** The six keys in the order of R1: upper case, then `_`, then lower case. */
const BY_KEY = ['BETA', 'MID', 'ZETA', '_under', 'alpha', 'beta2'];

/** The six variables, `MID` with the value `mid`, written in the order of `keys`. */
function six(keys: readonly string[], mid: string): Record<string, string> {
  const values: Record<string, string> = { ZETA: '1', alpha: '2', MID: mid, BETA: '4', _under: '5', beta2: '6' };
  return Object.fromEntries(keys.map((key) => [key, values[key] ?? '']));
}

/** The rows the tab shows for the six with `MID` = `mid`: in the order of R1. */
function rowsOf(mid: string): [string, string][] {
  const values = six(BY_KEY, mid);
  return BY_KEY.map((key) => [key, values[key] ?? '']);
}

/** What a direct `GetFunction name` reports: its variables and the status of its last update. */
async function reportedDirect(caller: Caller, port: number, name: string) {
  const read = await getFunctionDirect(caller, port, name);
  expect(read.found, `a direct GetFunction ${name}`).toBe(true);
  if (!read.found) throw new Error('unreachable');
  return {
    variables: read.configuration.Environment?.Variables ?? {},
    lastUpdate: read.configuration.LastUpdateStatus,
  };
}

/** Sets the six directly in the order of `keys` with `MID` = `mid`, once the function's last update is done. */
async function setDirect(
  caller: Caller,
  port: number,
  name: string,
  keys: readonly string[],
  mid: string,
): Promise<void> {
  // A direct change during an update is refused by the emulator: wait for the last one to be done.
  await expect
    .poll(async () => (await reportedDirect(caller, port, name)).lastUpdate, {
      message: `the last update of ${name} is done`,
      timeout: 20_000,
    })
    .toBe('Successful');
  await updateVariablesDirect(caller, port, name, six(keys, mid));
}

/** Waits until the rows of "Environment variables" are `rows`, in that order. */
async function expectRows(page: Page, rows: [string, string][], when: string): Promise<void> {
  await expect.poll(() => shownVariables(page), { message: `the rows of "Environment variables" ${when}` }).toEqual(rows);
}

test('studio.lambda-environment-variables-are-listed-by-key', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfg-vars');
  const seeded = new LambdaSeeded(ctx, port, p);
  const name = `${p}-six`;
  await seeded.function(name, {
    runtime: PYTHON.id,
    environment: six(['ZETA', 'alpha', 'MID', 'BETA', '_under', 'beta2'], '3'),
    code: { zip: envZip(), handler: PYTHON_HANDLER },
  });

  await lines.line(
    'S2, the tab "Configuration" → the rows of "Environment variables" are `BETA` `4`, `MID` `3`, `ZETA` `1`, `_under` `5`, `alpha` `2`, `beta2` `6`, in that order',
    async () => {
      await openOnTest(page, name);
      await toConfiguration(page, name);
      await expectRows(page, rowsOf('3'), 'as the tab opens');
    },
  );

  await lines.line(
    'The six set directly again, sent in another order, with `MID`=`3b`; "Refresh" → the same six rows in the same places, `MID` now `3b`; once more with `MID`=`3c` and a third order sent, "Refresh" → the same places, `MID` `3c`',
    async () => {
      await setDirect(ctx, port, name, ['MID', 'beta2', 'ZETA', '_under', 'BETA', 'alpha'], '3b');
      await functionPage(page, name).refresh.click(ACTION);
      await expectRows(page, rowsOf('3b'), 'after the first "Refresh"');
      await setDirect(ctx, port, name, ['alpha', '_under', 'beta2', 'BETA', 'ZETA', 'MID'], '3c');
      await functionPage(page, name).refresh.click(ACTION);
      await expectRows(page, rowsOf('3c'), 'after the second "Refresh"');
    },
  );

  await lines.line(
    '"Edit" of "Environment variables" → the editor\'s rows are the six in the same order; "Add variable" `AAA` = `0` → it is the editor\'s last row; "Save" → "Environment variables of {name} saved."; the section\'s rows are `AAA` `0` first, then the six in their order; the emulator reports exactly those seven variables',
    async () => {
      // The direct update of the line before may still be in progress: "Edit" is available once the function is ready.
      await expect(page.getByRole('main').getByRole('button', { name: EDIT_VARIABLES, exact: true })).toBeEnabled({
        timeout: 20_000,
      });
      const d = await openEdit(page, EDIT_VARIABLES);
      expect(await editorKeys(d.boxes('Key')), "the editor's rows as it opens").toEqual(BY_KEY);
      await d.dialog.getByRole('button', { name: ADD_VARIABLE, exact: true }).click(ACTION);
      await expect(d.boxes('Key'), 'a seventh row').toHaveCount(BY_KEY.length + 1);
      await d.boxes('Key').last().fill('AAA', ACTION);
      await d.boxes('Value').last().fill('0', ACTION);
      expect(await editorKeys(d.boxes('Key')), "the editor's rows with the added one").toEqual([...BY_KEY, 'AAA']);
      await d.save.click(ACTION);
      await expect(d.dialog, `the dialog "${EDIT_VARIABLES}" closes`).toHaveCount(0);
      await expect
        .poll(async () => (await flashTexts(page)).some((text) => text.includes(variablesSavedText(name))), {
          message: `the Flashbar item "${variablesSavedText(name)}"`,
        })
        .toBe(true);
      await expectRows(page, [['AAA', '0'], ...rowsOf('3c')], 'after "Save"');
      expect((await reportedDirect(ctx, port, name)).variables, 'the variables the emulator reports').toEqual({
        ...six(BY_KEY, '3c'),
        AAA: '0',
      });
    },
  );

  lines.end();
});
