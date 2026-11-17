// The five rules every AWS screen follows, on Lambda's three screens, in the built app served by `bun run serve`, in
// front of a real engine and the run's emulator (test-criteria.md, issue 467, "Flow checks, new"; requirement R3 to
// R6): the page says where the functions are once, the form states the name's rules before a submit, a value taken
// elsewhere has a copy control, and a long value breaks where it can be read.
//
// `studio.lambda-screens-say-where-once`, `studio.lambda-function-create-states-the-name-rules`,
// `studio.lambda-function-page-copies-arn-and-url`, `studio.lambda-values-break-where-they-can-be-read`.
//
// Other checks make functions on the run's emulator at the same time, so each check names its functions with its own
// prefix `<p>` and reads its own functions by name; the list is read under the filter `<p>`. The check of how values
// break needs a name of 24 characters that starts with `<p>`, so its prefix is `shortPrefix`. The readers of the
// rules (drawn lines, the clipboard, how often a text is on the page, the header, a field's texts):
// `support/screen-rules.ts`; Lambda's words and readers: `support/lambda-list.ts`, `support/lambda-page.ts`.

import type { Locator, Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, emulatorLine, endpointPattern, expectLine, LINE_LABEL } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import {
  endpointOf,
  functionUrlDirect,
  getFunctionDirect,
  LambdaSeeded,
  type FunctionConfiguration,
} from './support/lambda';
import {
  applyFilter,
  CREATE_PATH,
  expectNames,
  functionPath,
  openList,
  runtimeText,
  screen,
  TABLE,
} from './support/lambda-list';
import {
  createForm,
  FUNCTION_ARN,
  FUNCTION_NAME,
  FUNCTION_URL,
  NAME_TOO_LONG,
  openCreateForm,
  openFunction,
  OVERVIEW,
  pairValue,
} from './support/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix, scrollsSideways } from './support/s3';
import {
  breakAfterProblems,
  breakAtSpacesProblems,
  clipboardText,
  copiedText,
  copyControl,
  drawnLines,
  fieldTexts,
  grantClipboard,
  nameOfLength,
  oneLineProblems,
  pageHeader,
  selectAndCopy,
  setClipboard,
  shortPrefix,
  timesOnPage,
  topOf,
  whereWords,
} from './support/screen-rules';

/** The constraint text under "Function name" (R4). */
const NAME_RULE = '1 to 64 characters: letters (A-Z, a-z), digits, hyphens (-) and underscores (_).';

/** How long the form may take from "Create Event Function" to the function's page (three requests in order). */
const CREATE_BOUND_MS = 20_000;

/** The measures of R11 at 390 by 844, light, the notice open. */
const FIRST_ROW_AT_MOST = 730;
const TAB_LIST_AT_MOST = 800;

async function sizeTo(page: Page, width: number): Promise<void> {
  await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
}

/** The value of the key-value pair labelled `label` in the page's main: the `dd` after the `dt` that is the label. */
function pairValueElement(page: Page, label: string): Locator {
  return page
    .getByRole('main')
    .locator('dt')
    .filter({ hasText: new RegExp(`^\\s*${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) })
    .first()
    .locator('xpath=following-sibling::dd[1]');
}

/**
 * The cell of the row `name` under the column `column` of the list. The row's cells are counted as the heading counts
 * them, `td` and `th` alike, since the name cell is the row header (a `th`).
 */
function cellOf(page: Page, name: string, column: number): Locator {
  return page
    .locator(TABLE)
    .locator('tbody tr')
    .filter({ has: page.getByRole('link', { name, exact: true }) })
    .locator('td, th')
    .nth(column);
}

/** The list's column headings, in order, white space collapsed. */
async function columnHeadings(page: Page): Promise<string[]> {
  return (await page.locator(TABLE).locator('thead tr').first().locator('th').allInnerTexts()).map((t) =>
    t.replace(/\s+/g, ' ').trim(),
  );
}

/** The top of the list's first data row in the document: a body row of the table that is not hidden. */
async function firstRowTop(page: Page): Promise<number | null> {
  return page
    .locator(TABLE)
    .first()
    .evaluate(
      (root) => {
        const table = [...root.querySelectorAll('table')].find(
          (t) => t.tBodies.length > 0 && !t.closest('[aria-hidden="true"]'),
        );
        const row = table ? [...table.tBodies[0].rows].find((r) => r.cells.length > 1) : undefined;
        return row ? row.getBoundingClientRect().top + window.scrollY : null;
      },
      undefined,
      ACTION,
    );
}

/**
 * Opens the page of `fn` and waits until it is read whole: the tab "Code", its ARN, and its URL as the emulator holds
 * it (`url`, or "-" without one). The `h1` and the tabs show before the URL is read.
 */
async function openRead(page: Page, fn: FunctionConfiguration, url: string | null): Promise<void> {
  await openFunction(page, fn.FunctionName);
  await expect
    .poll(() => pairValue(page, OVERVIEW, FUNCTION_ARN), { message: `"${FUNCTION_ARN}" of ${fn.FunctionName}` })
    .toContain(fn.FunctionArn);
  await expect
    .poll(() => pairValue(page, OVERVIEW, FUNCTION_URL), { message: `"${FUNCTION_URL}" of ${fn.FunctionName}` })
    .toContain(url ?? '-');
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-screens-say-where-once', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lsr-where');
  const seeded = new LambdaSeeded(ctx, port, p);
  const first = await seeded.function(`${p}-a`);
  await seeded.function(`${p}-b`);
  const endpoint = endpointPattern(port);
  const s = screen(page);

  /** The list, connected, with its rows read. */
  async function listRead(): Promise<void> {
    await openList(page);
    await expectLine(page, connectedAt(port), 20_000);
    await expect
      .poll(async () => (await firstRowTop(page)) !== null, { message: 'the list shows its rows' })
      .toBe(true);
  }

  const screens: { name: string; open: () => Promise<void> }[] = [
    { name: 'the list', open: listRead },
    {
      name: "a function's page",
      open: async () => {
        await openRead(page, first, null);
        await expectLine(page, connectedAt(port), 20_000);
      },
    },
    {
      name: 'the create form',
      open: async () => {
        await openCreateForm(page);
        await expectLine(page, connectedAt(port), 20_000);
        await expect(createForm(page).name, `"${FUNCTION_NAME}"`).toBeVisible();
      },
    },
  ];

  await lines.line(
    'Open the list, a function\'s page and the create form, connected → on each the endpoint the emulator line shows is on the page once and the header holds neither "AWS account" nor "local emulator"',
    async () => {
      const found: string[] = [];
      for (const screenOf of screens) {
        await screenOf.open();
        const times = await timesOnPage(page, endpoint);
        if (times !== 1) found.push(`${screenOf.name}: ${endpointOf(port)} is on the page ${String(times)} times`);
        const header = await pageHeader(page);
        ctx.log(`${screenOf.name}: header ${JSON.stringify(header)}`);
        for (const words of whereWords(header)) found.push(`${screenOf.name}: the header holds "${words}"`);
      }
      expect(found).toEqual([]);
    },
  );

  await lines.line(
    'Close the notice on the list → the page still shows "Local emulator, not AWS" and the endpoint, once',
    async () => {
      await listRead();
      await expect(s.notice, 'the notice').toBeVisible();
      await s.noticeClose.click(ACTION);
      await expect(s.notice, 'the notice once closed').toHaveCount(0);
      await expect(emulatorLine(page), `the emulator line "${LINE_LABEL}"`).toBeVisible();
      expect(await timesOnPage(page, LINE_LABEL), `how often "${LINE_LABEL}" is on the page`).toBe(1);
      expect(await timesOnPage(page, endpoint), `how often ${endpointOf(port)} is on the page`).toBe(1);
    },
  );

  await lines.line(
    'The list with two functions made directly, the notice open → the first row begins at y 730 or above — 390 wide, light',
    async () => {
      await sizeTo(page, 390);
      await page.emulateMedia({ colorScheme: 'light' });
      await listRead();
      await expect(s.notice, 'the notice is open').toBeVisible();
      const top = await firstRowTop(page);
      ctx.log(`the first row begins at y ${String(top)}`);
      expect(top, 'the top of the first row').not.toBeNull();
      expect(top ?? Infinity, 'the top of the first row').toBeLessThanOrEqual(FIRST_ROW_AT_MOST);
    },
  );

  await lines.line(
    'The page of a function made directly, the notice open → the tab list begins at y 800 or above — 390 wide, light',
    async () => {
      await sizeTo(page, 390);
      await page.emulateMedia({ colorScheme: 'light' });
      await openRead(page, first, null);
      await expectLine(page, connectedAt(port), 20_000);
      await expect(s.notice, 'the notice is open').toBeVisible();
      const top = await topOf(page.getByRole('main').getByRole('tablist'));
      ctx.log(`the tab list begins at y ${String(top)}`);
      expect(top, 'the top of the tab list').not.toBeNull();
      expect(top ?? Infinity, 'the top of the tab list').toBeLessThanOrEqual(TAB_LIST_AT_MOST);
    },
  );

  await sizeTo(page, 1280);
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-create-states-the-name-rules', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lsr-name');
  // Deletes every function and role under `<p>` when the check ends, those Studio made included.
  new LambdaSeeded(ctx, port, p);
  const f = createForm(page);

  await lines.line(
    'Open the form → under "Function name": "1 to 64 characters: letters (A-Z, a-z), digits, hyphens (-) and underscores (_)."; no message is shown',
    async () => {
      await openCreateForm(page);
      await expect(f.name, `"${FUNCTION_NAME}"`).toBeVisible();
      const texts = await fieldTexts(page, FUNCTION_NAME);
      ctx.log(`"${FUNCTION_NAME}": ${JSON.stringify(texts)}`);
      expect(texts, `what "${FUNCTION_NAME}" shows under it`).toEqual({
        fields: 1,
        constraint: NAME_RULE,
        error: null,
      });
    },
  );

  await lines.line(
    'A name of 64 characters starting with `<p>` that holds an upper-case letter, a digit, `-` and `_`, "Create Event Function" → the function\'s page; a direct `GetFunction` returns that name',
    async () => {
      const name = nameOfLength(`${p}-A1_-`, 64);
      expect(name.length, 'the name is 64 characters long').toBe(64);
      await openCreateForm(page);
      await f.name.fill(name, ACTION);
      await f.create.click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(name)), { timeout: CREATE_BOUND_MS });
      await expect(heading(page, name), `the h1 "${name}"`).toBeVisible();
      const read = await getFunctionDirect(ctx, port, name);
      expect(read.found ? read.configuration.FunctionName : read.errorType, `a direct GetFunction ${name}`).toBe(name);
    },
  );

  await lines.line(
    'A name of 65 characters, "Create Event Function" → the message about the length under the field beside the constraint text; a direct `GetFunction` of it answers that it does not exist',
    async () => {
      const name = nameOfLength(`${p}-long-`, 65);
      expect(name.length, 'the name is 65 characters long').toBe(65);
      await openCreateForm(page);
      await f.name.fill(name, ACTION);
      await f.create.click(ACTION);
      await expect
        .poll(() => fieldTexts(page, FUNCTION_NAME), { message: `what "${FUNCTION_NAME}" shows under it` })
        .toEqual({ fields: 1, constraint: NAME_RULE, error: NAME_TOO_LONG });
      await expect(page, 'the form stays').toHaveURL(addressOf(CREATE_PATH));
      const read = await getFunctionDirect(ctx, port, name);
      expect(read.found ? 'found' : read.errorType, `a direct GetFunction ${name}`).toBe('ResourceNotFoundException');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-page-copies-arn-and-url', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lsr-copy');
  const seeded = new LambdaSeeded(ctx, port, p);
  const withUrl = await seeded.function(`${p}-url`, { url: true });
  const plain = await seeded.function(`${p}-plain`);
  await grantClipboard(context, stack.studio.origin);
  const url = await functionUrlDirect(ctx, port, withUrl.FunctionName);
  expect(url, `a direct GetFunctionUrlConfig ${withUrl.FunctionName} gives a URL`).not.toBeNull();
  // Every request of the page to the function's URL: copying it is only displaying it.
  const toUrl: string[] = [];
  context.on('request', (request) => {
    if (url !== null && request.url().startsWith(url)) toUrl.push(`${request.method()} ${request.url()}`);
  });
  const main = page.getByRole('main');
  const copy = (label: string) => main.getByRole('button', { name: copyControl(label), exact: true });

  await lines.line(
    'On the page of a function made directly with a function URL, press "Copy Function ARN" → "Function ARN copied" is shown and the clipboard\'s text equals the `FunctionArn` a direct `GetFunction` returns',
    async () => {
      const read = await getFunctionDirect(ctx, port, withUrl.FunctionName);
      expect(read.found, `a direct GetFunction ${withUrl.FunctionName}`).toBe(true);
      const arn = read.found ? read.configuration.FunctionArn : '';
      await openRead(page, withUrl, url);
      await setClipboard(page, 'before');
      await copy(FUNCTION_ARN).click(ACTION);
      await expect(page.getByText(copiedText(FUNCTION_ARN), { exact: true }).first()).toBeVisible();
      await expect.poll(() => clipboardText(page), { message: "the clipboard's text" }).toBe(arn);
    },
  );

  await lines.line(
    'Press "Copy Function URL" → "Function URL copied" and the clipboard\'s text equals the `FunctionUrl` a direct `GetFunctionUrlConfig` returns; the page sent no request to that URL',
    async () => {
      const direct = await functionUrlDirect(ctx, port, withUrl.FunctionName);
      if (!addressOf(functionPath(withUrl.FunctionName)).test(page.url())) await openRead(page, withUrl, url);
      await setClipboard(page, 'before');
      await copy(FUNCTION_URL).click(ACTION);
      await expect(page.getByText(copiedText(FUNCTION_URL), { exact: true }).first()).toBeVisible();
      await expect.poll(() => clipboardText(page), { message: "the clipboard's text" }).toBe(direct);
      expect(toUrl, "the page's requests to the function's URL").toEqual([]);
    },
  );

  await lines.line(
    'On the page of a function made directly without a URL → "Copy Function ARN" is there and no "Copy Function URL"',
    async () => {
      await openRead(page, plain, null);
      await expect(copy(FUNCTION_ARN), `"${copyControl(FUNCTION_ARN)}"`).toBeVisible();
      await expect(copy(FUNCTION_URL), `"${copyControl(FUNCTION_URL)}"`).toHaveCount(0);
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-values-break-where-they-can-be-read', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = shortPrefix(ctx, 'lv');
  const seeded = new LambdaSeeded(ctx, port, p);
  const name = nameOfLength(`${p}-`, 24);
  // At least 120 characters, in words of at most 10.
  const words = ['kept', 'to', 'see', 'where', 'a', 'long', 'text', 'breaks', 'in', 'the', 'list'];
  let description = '';
  for (let i = 0; description.length < 120; i++)
    description += `${description === '' ? '' : ' '}${words[i % words.length]}`;
  const fn = await seeded.function(name, { url: true, description });
  const url = await functionUrlDirect(ctx, port, name);
  await grantClipboard(context, stack.studio.origin);

  await lines.line(
    'On the page of a function made directly with a function URL, its name 24 characters starting with `<p>` → "Function ARN" is drawn on more than one line and every line of it but the last ends with `:`; "Function URL" is drawn on more than one line and every line of it but the last ends with `:` or `/` — 390 wide',
    async () => {
      expect(name.length, 'the name is 24 characters long').toBe(24);
      expect(url, `a direct GetFunctionUrlConfig ${name} gives a URL`).not.toBeNull();
      await sizeTo(page, 390);
      await openRead(page, fn, url);
      const arn = await drawnLines(pairValueElement(page, FUNCTION_ARN), fn.FunctionArn);
      const shownUrl = await drawnLines(pairValueElement(page, FUNCTION_URL), url ?? '');
      ctx.log(`"${FUNCTION_ARN}" drawn ${JSON.stringify(arn)}; "${FUNCTION_URL}" drawn ${JSON.stringify(shownUrl)}`);
      expect([
        ...breakAfterProblems(arn, [':'], `"${FUNCTION_ARN}"`),
        ...breakAfterProblems(shownUrl, [':', '/'], `"${FUNCTION_URL}"`),
      ]).toEqual([]);
    },
  );

  /** The list under the filter `<p>`, its one row the function; the cells' places by the column headings. */
  async function listOfOne(): Promise<Record<string, Locator>> {
    await openList(page);
    await expectLine(page, connectedAt(port), 20_000);
    await applyFilter(page, p);
    await expectNames(page, [name], 'the rows under the filter <p>');
    const headings = await columnHeadings(page);
    const at = (column: string) => headings.findIndex((h) => h === column);
    return {
      name: cellOf(page, name, at('Function name')),
      description: cellOf(page, name, at('Description')),
      packageType: cellOf(page, name, at('Package type')),
      runtime: cellOf(page, name, at('Runtime')),
      type: cellOf(page, name, at('Type')),
    };
  }

  await lines.line(
    'The list under the filter `<p>`, with that function made with a description of at least 120 characters in words of at most 10 → the name is on one line, each of "Zip", the runtime\'s name and "Standard" is on one line, and the description breaks only at spaces; the page does not scroll sideways — 1280 and 390 wide',
    async () => {
      expect(description.length, 'the description is at least 120 characters long').toBeGreaterThanOrEqual(120);
      const runtime = runtimeText(fn.Runtime);
      const found: string[] = [];
      for (const width of [1280, 390]) {
        await sizeTo(page, width);
        const cells = await listOfOne();
        const at = `${String(width)} wide`;
        found.push(
          ...oneLineProblems(await drawnLines(cells.name, name), `${at}: the name`),
          ...oneLineProblems(await drawnLines(cells.packageType, 'Zip'), `${at}: "Zip"`),
          ...oneLineProblems(await drawnLines(cells.runtime, runtime), `${at}: "${runtime}"`),
          ...oneLineProblems(await drawnLines(cells.type, 'Standard'), `${at}: "Standard"`),
          ...breakAtSpacesProblems(
            await drawnLines(cells.description, description),
            description,
            `${at}: the description`,
          ),
        );
        if (await scrollsSideways(page)) found.push(`${at}: the page scrolls sideways`);
      }
      await sizeTo(page, 1280);
      expect(found).toEqual([]);
    },
  );

  await lines.line('The same list → the description is drawn on more than one line — 390 wide', async () => {
    await sizeTo(page, 390);
    const cells = await listOfOne();
    const drawn = await drawnLines(cells.description, description);
    ctx.log(`the description drawn ${JSON.stringify(drawn)}`);
    expect(drawn, 'the description is shown').not.toBeNull();
    expect(drawn?.lines.length ?? 0, 'the lines the description is drawn on').toBeGreaterThan(1);
    await sizeTo(page, 1280);
  });

  await lines.line(
    "Select the function's ARN on its page and copy the selection → the clipboard's text equals the ARN a direct `GetFunction` returns — 390 wide",
    async () => {
      const read = await getFunctionDirect(ctx, port, name);
      expect(read.found, `a direct GetFunction ${name}`).toBe(true);
      const arn = read.found ? read.configuration.FunctionArn : '';
      await sizeTo(page, 390);
      await openRead(page, fn, url);
      await setClipboard(page, 'before');
      expect(await selectAndCopy(page, pairValueElement(page, FUNCTION_ARN), arn), 'the ARN is shown to select').toBe(
        true,
      );
      await expect.poll(() => clipboardText(page), { message: "the clipboard's text" }).toBe(arn);
      await sizeTo(page, 1280);
    },
  );

  lines.end();
});
