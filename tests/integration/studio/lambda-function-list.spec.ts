// The Lambda function list ("Event Functions") in the built app served by `bun run serve`, in front of a real engine
// started for that Studio and the run's emulator (test-criteria.md, issue 84, Flow checks; requirement R4, R6.1, R8):
// what the emulator holds, read again on every opening and refresh, the filter that matches the start of a name,
// and the actions and where they lead.
//
// `studio.lambda-function-list-shows-what-the-emulator-holds`, `studio.lambda-function-list-rereads-on-open-and-refresh`,
// `studio.lambda-function-list-filter-matches-the-start-of-a-name`,
// `studio.lambda-function-list-actions-lead-to-their-routes`.
//
// Issue 467 rewrote one step of `studio.lambda-function-list-shows-what-the-emulator-holds` (its test-criteria.md,
// "Flow checks, changed"; requirement R9, rule 1): what the notice, the `h1`'s description and the page say of where
// the functions are. Readers of those: `support/screen-rules.ts`.
//
// Other checks make functions on the run's emulator at the same time, so each check names its functions with its own
// prefix `<p>` and compares the screen with a direct `ListFunctions` under the filter `<p>`. Words and readers:
// `support/lambda-list.ts`; direct calls and the functions a check makes: `support/lambda.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, crumbLink, crumbs, endpointPattern, expectLine } from './support/aws-area';
import { ACTION, addressOf, expectNoScreenYet, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import {
  deleteFunctionDirect,
  endpointOf,
  functionNamesDirect,
  LambdaSeeded,
  listFunctionsDirect,
} from './support/lambda';
import {
  applyFilter,
  CLEAR_FILTER,
  CREATE,
  CREATE_PATH,
  CRUMBS,
  expectedRow,
  expectNames,
  functionPath,
  FUNCTIONS_PATH,
  H1,
  LAMBDA_PATH,
  LIST_DESCRIPTION,
  listHeading,
  ListFunctionsRecord,
  matchesText,
  NO_MATCHES,
  noMatchSentence,
  openList,
  REFRESH,
  screen,
  SERVICE_LABEL,
  shownNames,
  shownRows,
  TAB_ROUTES,
  tokenTexts,
} from './support/lambda-list';
import { Lines } from './support/lines';
import { checkPrefix, SEOUL } from './support/s3';
import { NOTICE_BODY, noticeBody, pageHeader, timesOnPage } from './support/screen-rules';

const AWS = 'Amazon Web Services';

/** The list's frame at `path`: the address and the `h1` "Event Functions". */
async function expectListAt(page: Page, path: string): Promise<void> {
  await expect(page).toHaveURL(addressOf(path));
  await expect(listHeading(page), `the h1 "${H1}"`).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------

test.describe(() => {
  // "Last modified" is written in the zone the check sets on its browser context.
  test.use({ timezoneId: SEOUL.timeZone });

  test('studio.lambda-function-list-shows-what-the-emulator-holds', async ({ ctx, page }) => {
    const stack = await startStack(ctx);
    const port = stack.emulatorPort;
    const lines = new Lines(ctx);
    const p = checkPrefix(ctx, 'lfl-shows');
    const seeded = new LambdaSeeded(ctx, port, p);
    await seeded.function(`${p}-node`, {
      runtime: 'nodejs22.x',
      description: `Made by ${p} for the list`,
    });
    await seeded.function(`${p}-py`, {
      runtime: 'python3.13',
      architecture: 'arm64',
    });
    await seeded.function(`${p}-durable`, { durable: true });
    const s = screen(page);

    await lines.line(
      'With three functions made directly (one `nodejs22.x` with a description, one `python3.13` on `arm64`, one durable), apply the filter `<p>` → three rows in the order a direct `ListFunctions` returns them, each with the name, description, package type, runtime name, type ("Durable" for the third, "Standard" for the others) and last modified time that the direct answer gives',
      async () => {
        await openList(page);
        await applyFilter(page, p);
        const direct = await listFunctionsDirect(ctx, port, p);
        ctx.log(
          `direct: ${JSON.stringify(direct.map((f) => ({ name: f.FunctionName, description: f.Description, packageType: f.PackageType, runtime: f.Runtime, durable: f.DurableConfig !== undefined, lastModified: f.LastModified })))}`,
        );
        expect(
          [...direct.map((f) => f.FunctionName)].sort(),
          'a direct ListFunctions lists the three functions',
        ).toEqual([`${p}-durable`, `${p}-node`, `${p}-py`]);
        expect(
          direct.find((f) => f.FunctionName === `${p}-durable`)?.DurableConfig,
          'the direct answer carries DurableConfig for the durable function',
        ).toBeDefined();
        const expected = direct.map((f) => expectedRow(f, SEOUL));
        await expect
          .poll(() => shownRows(page), {
            message: 'the rows: name, description, package type, runtime, type, last modified',
          })
          .toEqual(expected);
        expect(
          expected.map((r) => r.type),
          'the types of the rows in the direct order',
        ).toEqual(direct.map((f) => (f.FunctionName === `${p}-durable` ? 'Durable' : 'Standard')));
      },
    );

    // Issue 467 (requirement R9, rule 1) replaced "the notice … names the endpoint the emulator line shows" with the
    // notice's body of R3, the description under the `h1` and the endpoint drawn once.
    await lines.line(
      'The crumbs read EmuForge, AWS, Lambda, Event Functions; the notice reads "These functions are in your local emulator" with the body of R3; under the `h1`: "The filter matches the start of a name and is case-sensitive."; the endpoint the emulator line shows is on the page once; closing the notice and choosing the (i) control brings it back',
      async () => {
        await expectListAt(page, FUNCTIONS_PATH);
        await expect.poll(() => crumbs(page), { message: 'the crumbs' }).toEqual(CRUMBS);
        await expectLine(page, connectedAt(port));
        await expect(s.notice, 'the notice').toBeVisible();
        await expect.poll(() => noticeBody(page), { message: "the notice's body" }).toBe(NOTICE_BODY);
        await expect
          .poll(async () => (await pageHeader(page))?.description ?? null, { message: 'the description under the h1' })
          .toBe(LIST_DESCRIPTION);
        expect(await timesOnPage(page, endpointPattern(port)), `how often ${endpointOf(port)} is on the page`).toBe(1);
        await s.noticeClose.click(ACTION);
        await expect(s.notice, 'the notice once closed').toHaveCount(0);
        await s.about.click(ACTION);
        await expect(s.notice, 'the notice once the (i) control is chosen').toBeVisible();
        await expect.poll(() => noticeBody(page), { message: "the notice's body once brought back" }).toBe(NOTICE_BODY);
      },
    );

    await lines.line('Open `/aws/lambda` → the same screen, and the address stays `/aws/lambda`', async () => {
      await page.goto(LAMBDA_PATH);
      await expectListAt(page, LAMBDA_PATH);
      await expect(s.action(REFRESH), `"${REFRESH}"`).toBeVisible();
      await expect(s.filter, 'the filter').toBeVisible();
      await expect.poll(() => crumbs(page), { message: 'the crumbs' }).toEqual(CRUMBS);
      await expect(page).toHaveURL(addressOf(LAMBDA_PATH));
    });

    lines.end();
  });
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-list-rereads-on-open-and-refresh', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-reread');
  const seeded = new LambdaSeeded(ctx, port, p);
  await seeded.function(`${p}-first`);
  const late = `${p}-late`;
  const record = ListFunctionsRecord.attach(ctx, context, stack.engine.url);

  await lines.line(
    'With the list shown under the filter `<p>`, make a function `<p>-late` directly, leave for `/aws` and come back, apply the filter → the row is there',
    async () => {
      await openList(page);
      await applyFilter(page, p);
      await expectNames(page, [`${p}-first`], 'the rows under the filter <p>');
      await seeded.function(late);
      await crumbLink(page, 'AWS').click(ACTION);
      await expect(heading(page, AWS)).toBeVisible();
      const n = record.answered();
      await page.goBack();
      await expect(listHeading(page)).toBeVisible();
      await record.answeredAfter(n, 'coming back sent a ListFunctions the engine answered');
      await applyFilter(page, p);
      const direct = await functionNamesDirect(ctx, port, p);
      expect(direct, 'a direct ListFunctions lists <p>-late').toContain(late);
      await expectNames(page, direct, 'the rows under the filter <p> after coming back');
    },
  );

  await lines.line('Delete it directly and choose "Refresh" → the row is gone', async () => {
    // The Given: the function of the line before exists and the list is shown under the filter, whether or not
    // that line held.
    if (!(await functionNamesDirect(ctx, port, p)).includes(late)) await seeded.function(late);
    if ((await tokenTexts(page)).length === 0) await applyFilter(page, p);
    const deleted = await deleteFunctionDirect(ctx, port, late);
    expect('error' in deleted ? deleted.error : deleted.status, `direct DeleteFunction ${late}`).toBe(204);
    const n = record.answered();
    await screen(page).action(REFRESH).click(ACTION);
    await record.answeredAfter(n, 'the refresh sent a ListFunctions the engine answered');
    const direct = await functionNamesDirect(ctx, port, p);
    expect(direct, 'a direct ListFunctions no longer lists <p>-late').toEqual([`${p}-first`]);
    await expectNames(page, direct, 'the rows under the filter <p> after "Refresh"');
  });

  record.log();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-list-filter-matches-the-start-of-a-name', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-filter');
  const seeded = new LambdaSeeded(ctx, port, p);
  const made = [`${p}-ab-`, `${p}-abb`, `${p}-abc`, `${p}-abc-x`, `${p}-abd`, `${p}-Abc`];
  for (const name of made) await seeded.function(name);
  const s = screen(page);
  await openList(page);

  /** The direct `ListFunctions` names that start with `text`, in its order. */
  const startingWith = async (text: string) => functionNamesDirect(ctx, port, text);

  await lines.line(
    'With `<p>-ab-`, `<p>-abb`, `<p>-abc`, `<p>-abc-x`, `<p>-abd` and `<p>-Abc` made directly, apply the filter `<p>-abc` → `<p>-abc`, `<p>-abc-x` and "2 matches"; a direct `ListFunctions` holds the others',
    async () => {
      const all = await startingWith(p);
      expect([...all].sort(), 'a direct ListFunctions holds the six functions').toEqual([...made].sort());
      await applyFilter(page, `${p}-abc`);
      await expectNames(page, [`${p}-abc`, `${p}-abc-x`], 'the rows under the filter <p>-abc');
      await expect(s.resultsCount, 'the count beside the filter').toHaveText(matchesText(2));
      await expect(s.resultsCount).toBeVisible();
    },
  );

  await lines.line(
    'Apply `<p>-ab-` → the one row `<p>-ab-` and "1 match"; apply `<p>-a` → the five lower-case names and not `<p>-Abc`',
    async () => {
      await applyFilter(page, `${p}-ab-`);
      await expectNames(page, [`${p}-ab-`], 'the rows under the filter <p>-ab-');
      await expect(s.resultsCount, 'the count beside the filter').toHaveText(matchesText(1));
      await expect(s.resultsCount).toBeVisible();
      expect(await tokenTexts(page), 'the filter holds one token').toHaveLength(1);
      await applyFilter(page, `${p}-a`);
      const lower = await startingWith(`${p}-a`);
      expect(lower, 'a direct ListFunctions: the names that start with <p>-a').toHaveLength(5);
      expect(lower, 'a direct ListFunctions: <p>-Abc does not start with <p>-a').not.toContain(`${p}-Abc`);
      await expectNames(page, lower, 'the rows under the filter <p>-a');
      await expect(s.resultsCount, 'the count beside the filter').toHaveText(matchesText(5));
      await expect(s.resultsCount).toBeVisible();
      expect(await tokenTexts(page), 'the filter holds one token').toHaveLength(1);
    },
  );

  await lines.line('Apply `<p>-zz` → "No matches"; "Clear filter" → the unfiltered list', async () => {
    await applyFilter(page, `${p}-zz`);
    await expect(s.empty.getByText(NO_MATCHES, { exact: true }), `"${NO_MATCHES}"`).toBeVisible();
    await expect(s.empty.getByText(noMatchSentence(`${p}-zz`), { exact: true })).toBeVisible();
    await s.empty.getByRole('button', { name: CLEAR_FILTER, exact: true }).click(ACTION);
    await expect.poll(() => tokenTexts(page), { message: 'the filter holds no token' }).toEqual([]);
    // The run's emulator holds at least this check's six functions, so the unfiltered list has rows.
    await expect
      .poll(async () => (await shownNames(page)).length, {
        message: 'rows are shown',
      })
      .toBeGreaterThan(0);
    await expect(s.empty.getByText(NO_MATCHES, { exact: true })).toHaveCount(0);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-list-actions-lead-to-their-routes', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-actions');
  const one = `${p}-one`;
  const seeded = new LambdaSeeded(ctx, port, p);
  await seeded.function(one);
  const s = screen(page);

  /** The list under the filter `<p>`, with `one` as its only row. */
  async function listed(): Promise<void> {
    await expect(listHeading(page)).toBeVisible();
    if ((await tokenTexts(page)).length === 0) await applyFilter(page, p);
    await expectNames(page, [one], 'the rows under the filter <p>');
  }

  await lines.line(
    '"Create Event Function" → `/aws/lambda/functions/create` with `h1` "Create Event Function", no document reload',
    async () => {
      await openList(page);
      await markPage(page);
      await s.create.click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_PATH));
      await expect(heading(page, CREATE), `the h1 "${CREATE}"`).toBeVisible();
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  await lines.line(
    'A function\'s name → `/aws/lambda/functions/function/<name>` with `h1` the name; each of the tabs "Test", "Monitor", "Configuration", "Aliases", "Versions" → its route of R8 and the "no screen yet" page of AWS Lambda',
    async () => {
      await openList(page);
      await listed();
      await markPage(page);
      await s.nameLink(one).click(ACTION);
      await expect(page).toHaveURL(addressOf(functionPath(one)));
      await expect(heading(page, one), `the h1 "${one}"`).toBeVisible();
      for (const { tab, segment } of TAB_ROUTES) {
        const main = page.getByRole('main');
        await main
          .getByRole('tab', { name: tab, exact: true })
          .or(main.getByRole('link', { name: tab, exact: true }))
          .first()
          .click(ACTION);
        await expectNoScreenYet(page, SERVICE_LABEL, `${functionPath(one)}/${segment}`);
        await page.goBack();
        await expect(page).toHaveURL(addressOf(functionPath(one)));
        await expect(heading(page, one), `the h1 "${one}" after Back`).toBeVisible();
      }
      expect(await stillSamePage(page), 'no document was loaded').toBe(true);
    },
  );

  lines.end();
});
