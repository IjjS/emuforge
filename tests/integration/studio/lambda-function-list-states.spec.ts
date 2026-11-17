// The Lambda function list's states in the built app served by `bun run serve`, in front of a real engine and a real
// emulator (test-criteria.md, issue 84, Flow checks; requirement R4.4, R4.5, R10): an emulator without functions,
// pages that follow the emulator's markers, and the loading state while the list's request is held back.
//
// `studio.lambda-function-list-empty-emulator-says-no-functions`, `studio.lambda-function-list-pages-follow-the-emulator`,
// `studio.lambda-function-list-shows-loading-until-the-answer`.
//
// The checks that need the whole list (empty, paging) start their own emulator; the loading check makes its function
// on the run's emulator with its own prefix `<p>`. The loading check holds the request in the browser
// (`ListFunctionsHold`); nothing answers it but the engine. Words and readers: `support/lambda-list.ts`; direct
// calls: `support/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION } from './support/frame';
import { deleteFunctionDirect, functionNamesDirect, LambdaSeeded, listFunctionsPage } from './support/lambda';
import {
  counter,
  CREATE,
  expectNames,
  H1,
  headingText,
  ListFunctionsHold,
  LOADING,
  NO_FUNCTIONS,
  openList,
  REFRESH,
  screen,
  setPageSize,
  shownNames,
} from './support/lambda-list';
import { Lines } from './support/lines';
import { checkPrefix } from './support/s3';

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-list-empty-emulator-says-no-functions', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-empty');
  const seeded = new LambdaSeeded(ctx, port, p);
  const s = screen(page);

  await lines.line(
    'Open the list on an emulator without functions → "No functions", the button "Create Event Function" in the table, `h1` "Event Functions (0)"; a direct `ListFunctions` returns none',
    async () => {
      await openList(page);
      await expect(s.empty.getByText(NO_FUNCTIONS, { exact: true }), `"${NO_FUNCTIONS}"`).toBeVisible();
      await expect(
        s.empty
          .getByRole('button', { name: CREATE, exact: true })
          .or(s.empty.getByRole('link', { name: CREATE, exact: true })),
        `"${CREATE}" in the table`,
      ).toBeVisible();
      await expect.poll(() => headingText(page), { message: 'the h1' }).toBe(`${H1} (0)`);
      expect(await functionNamesDirect(ctx, port), 'a direct ListFunctions').toEqual([]);
    },
  );

  await lines.line('Make one function directly, choose "Refresh" → one row and "(1)"', async () => {
    await seeded.function(`${p}-only`);
    await s.action(REFRESH).click(ACTION);
    await expectNames(page, [`${p}-only`], 'the rows after "Refresh"');
    await expect.poll(() => counter(page), { message: 'the counter' }).toBe('1');
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-list-pages-follow-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx, { ownEmulator: true });
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-pages');
  const seeded = new LambdaSeeded(ctx, port, p);
  const made = Array.from({ length: 12 }, (_, i) => `${p}-${String(i + 1).padStart(2, '0')}`);
  for (const name of made) await seeded.function(name);
  const s = screen(page);

  /** Deletes `name` directly; the check's Given needs it gone. */
  const remove = async (name: string) => {
    const answer = await deleteFunctionDirect(ctx, port, name);
    expect('error' in answer ? answer.error : answer.status, `direct DeleteFunction ${name}`).toBe(204);
  };

  await lines.line(
    'With 12 functions made directly and page size 10 → 10 rows, the counter "(10+)", "Next page" enabled; "Next page" → the other 2, in the order a direct `ListFunctions` with `MaxItems` 10 and the first page\'s `NextMarker` returns, and "(12)"',
    async () => {
      const first = await listFunctionsPage(ctx, port, { maxItems: 10 });
      expect(first.nextMarker, 'a direct ListFunctions with MaxItems 10 of 12 carries a NextMarker').not.toBeNull();
      const second = await listFunctionsPage(ctx, port, {
        maxItems: 10,
        marker: first.nextMarker ?? undefined,
      });
      const firstNames = first.functions.map((f) => f.FunctionName);
      const secondNames = second.functions.map((f) => f.FunctionName);
      expect([...firstNames, ...secondNames].sort(), 'the two direct pages hold the twelve').toEqual([...made].sort());
      await openList(page);
      await setPageSize(page, 10);
      await expectNames(page, firstNames, 'the rows with the page size 10');
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('10+');
      await expect(s.nextPage, '"Next page" on page 1 of 12').toBeEnabled();
      await s.nextPage.click(ACTION);
      await expectNames(page, secondNames, 'the rows of page 2');
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('12');
    },
  );

  await lines.line(
    'With exactly 10 functions and page size 10 → 10 rows, "(10)", "Next page" disabled (a direct `ListFunctions` with `MaxItems` 10 returns no `NextMarker`)',
    async () => {
      for (const name of made.slice(10)) await remove(name);
      const direct = await listFunctionsPage(ctx, port, { maxItems: 10 });
      expect(direct.functions, 'a direct ListFunctions with MaxItems 10 lists ten').toHaveLength(10);
      expect(direct.nextMarker, 'a direct ListFunctions with MaxItems 10 of 10 carries no NextMarker').toBeNull();
      await openList(page);
      await setPageSize(page, 10);
      await expectNames(
        page,
        direct.functions.map((f) => f.FunctionName),
        'the rows with the page size 10',
      );
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('10');
      await expect(s.nextPage, '"Next page" with exactly one full page').toBeDisabled();
    },
  );

  await lines.line(
    'On page 1 of 12, delete the last two directly and choose "Next page" → page 1 stays, "Next page" is disabled and the counter reads "(10)"',
    async () => {
      // The Given: twelve functions again.
      const held = await functionNamesDirect(ctx, port, p);
      for (const name of made) if (!held.includes(name)) await seeded.function(name);
      const first = await listFunctionsPage(ctx, port, { maxItems: 10 });
      const firstNames = first.functions.map((f) => f.FunctionName);
      expect(first.nextMarker, 'a direct ListFunctions with MaxItems 10 of 12 carries a NextMarker').not.toBeNull();
      await openList(page);
      await setPageSize(page, 10);
      await expectNames(page, firstNames, 'page 1 of 12');
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('10+');
      const all = await functionNamesDirect(ctx, port, p);
      for (const name of all.slice(10)) await remove(name);
      expect(await functionNamesDirect(ctx, port, p), 'a direct ListFunctions after the delete').toEqual(firstNames);
      await s.nextPage.click(ACTION);
      await expect(s.nextPage, '"Next page" once the later page came back empty').toBeDisabled();
      await expect.poll(() => counter(page), { message: 'the counter' }).toBe('10');
      await expectNames(page, firstNames, 'page 1 stays');
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-list-shows-loading-until-the-answer', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfl-loading');
  const seeded = new LambdaSeeded(ctx, stack.emulatorPort, p);
  await seeded.function(`${p}-a`);
  const s = screen(page);
  const hold = await ListFunctionsHold.attach(ctx, context, page, stack.engine.url);

  await lines.line(
    'Open the function list with the `ListFunctions` request held back (delayed, not answered by the check) → "Loading functions", no counter after the heading, and the filter disabled',
    async () => {
      await openList(page);
      await expect
        .poll(() => hold.count(), {
          message: 'a ListFunctions request is held',
        })
        .toBeGreaterThan(0);
      await expect(s.table.getByText(LOADING, { exact: true }), `"${LOADING}"`).toBeVisible();
      expect(await headingText(page), 'the h1, without a counter').toBe(H1);
      await expect(s.filter, 'the filter while loading').toBeDisabled();
    },
  );

  await lines.line('Let the request go → the rows or "No functions", a counter, and the filter enabled', async () => {
    await hold.release();
    await expect
      .poll(
        async () =>
          (await shownNames(page)).length > 0 || (await s.empty.getByText(NO_FUNCTIONS, { exact: true }).count()) > 0,
        { message: 'rows or "No functions" are shown' },
      )
      .toBe(true);
    await expect.poll(() => counter(page), { message: 'the counter' }).not.toBeNull();
    await expect(s.filter, 'the filter once loaded').toBeEnabled();
  });

  await hold.stop();
  lines.end();
});
