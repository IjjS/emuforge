// A Lambda function's page in the built app served by `bun run serve`, in front of a real engine started for that
// Studio and the run's emulator (test-criteria.md, issue 84, Flow checks; requirement R5, R6.1): what the emulator
// holds for a function, read again on "Refresh", and the page of a function the emulator does not hold.
//
// `studio.lambda-function-page-shows-the-function`, `studio.lambda-function-page-of-a-missing-function-says-not-found`.
//
// Other checks make functions on the run's emulator at the same time, so every function here is named under the
// check's prefix `<p>`. Words and readers: `support/lambda-page.ts` and `support/lambda-list.ts`; direct calls:
// `support/lambda.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import {
  deleteFunctionDirect,
  functionUrlDirect,
  getFunctionDirect,
  LambdaSeeded,
  updateDescriptionDirect,
} from './services/lambda/lambda';
import { functionPath, FUNCTIONS_PATH, listHeading, runtimeText } from './services/lambda/lambda-list';
import {
  ARCHITECTURE,
  contentLink,
  DESCRIPTION,
  EVENT_FUNCTIONS,
  FUNCTION_ARN,
  FUNCTION_URL,
  functionPage,
  HANDLER,
  isLinkInMain,
  LAST_MODIFIED,
  NOT_FOUND,
  openFunction,
  OVERVIEW,
  pairFirstLine,
  PAGE_TABS,
  pairValue,
  RUNTIME,
  RUNTIME_SETTINGS,
  tabNames,
} from './services/lambda/lambda-page';
import { Lines } from './support/lines';
import { checkPrefix, creationDateText, SEOUL } from './support/service-screens';

// "Last modified" is written in the zone the check sets on its browser context (R4.2).
test.use({ timezoneId: SEOUL.timeZone });

test('studio.lambda-function-page-shows-the-function', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfp-shows');
  const seeded = new LambdaSeeded(ctx, port, p);
  const withUrl = `${p}-url`;
  const withoutUrl = `${p}-plain`;
  await seeded.function(withUrl, {
    runtime: 'nodejs22.x',
    architecture: 'arm64',
    description: `Made by ${p} for its page`,
    url: true,
  });
  await seeded.function(withoutUrl);

  await lines.line(
    // Issue 516 (test-criteria.md, "Rewritten lines of checks on `main`"; the pm's decision of 2026-11-19).
    'With a function made directly (`nodejs22.x`, `arm64`, a description, a function URL) → its page shows the description, last modified time, ARN and URL (as text, not a link) that the emulator reports, and exactly the tabs "Test", "Code", "Monitor", "Configuration", "Versions and aliases", "Event sources"; on "Code" the runtime\'s name, the handler and the architecture the emulator reports',
    async () => {
      const read = await getFunctionDirect(ctx, port, withUrl);
      expect(read.found, `a direct GetFunction ${withUrl}`).toBe(true);
      if (!read.found) return;
      const c = read.configuration;
      const url = await functionUrlDirect(ctx, port, withUrl);
      expect(url, `a direct GetFunctionUrlConfig ${withUrl} returns a URL`).not.toBeNull();
      ctx.log(
        `direct: ${JSON.stringify({ description: c.Description, lastModified: c.LastModified, arn: c.FunctionArn, url, runtime: c.Runtime, handler: c.Handler, architectures: c.Architectures })}`,
      );
      await openFunction(page, withUrl);
      expect(await tabNames(page), 'the tabs of the page').toEqual(PAGE_TABS);
      await functionPage(page, withUrl).tab('Code').click(ACTION);
      await expect(functionPage(page, withUrl).section(RUNTIME_SETTINGS), `"${RUNTIME_SETTINGS}"`).toBeVisible();
      const expected = {
        description: c.Description ?? '-',
        lastModified: creationDateText(c.LastModified, SEOUL),
        arn: c.FunctionArn,
        url: url ?? '',
        runtime: runtimeText(c.Runtime),
        handler: c.Handler ?? '-',
        architecture: (c.Architectures ?? []).join(', '),
      };
      await expect
        .poll(
          async () => ({
            description: await pairFirstLine(page, OVERVIEW, DESCRIPTION),
            lastModified: await pairValue(page, OVERVIEW, LAST_MODIFIED),
            arn: await pairValue(page, OVERVIEW, FUNCTION_ARN),
            url: await pairValue(page, OVERVIEW, FUNCTION_URL),
            runtime: await pairValue(page, RUNTIME_SETTINGS, RUNTIME),
            handler: await pairValue(page, RUNTIME_SETTINGS, HANDLER),
            architecture: await pairValue(page, RUNTIME_SETTINGS, ARCHITECTURE),
          }),
          { message: `"${OVERVIEW}" and "${RUNTIME_SETTINGS}" of ${withUrl}` },
        )
        .toEqual(expected);
      expect(await isLinkInMain(page, url ?? ''), `the function URL ${String(url)} is a link`).toBe(false);
    },
  );

  await lines.line('A function without a URL → "Function URL" reads "-"', async () => {
    expect(await functionUrlDirect(ctx, port, withoutUrl), `a direct GetFunctionUrlConfig ${withoutUrl}`).toBeNull();
    await openFunction(page, withoutUrl);
    await expect
      .poll(() => pairValue(page, OVERVIEW, FUNCTION_URL), { message: `"${FUNCTION_URL}" of ${withoutUrl}` })
      .toBe('-');
  });

  await lines.line('Update its description directly and choose "Refresh" → the new description', async () => {
    await openFunction(page, withUrl);
    await expect
      .poll(() => pairFirstLine(page, OVERVIEW, DESCRIPTION), { message: 'the description before the update' })
      .toBe(`Made by ${p} for its page`);
    const updated = `Updated by ${p} directly`;
    await updateDescriptionDirect(ctx, port, withUrl, updated);
    await functionPage(page, withUrl).refresh.click(ACTION);
    await expect
      .poll(() => pairFirstLine(page, OVERVIEW, DESCRIPTION), { message: 'the description after "Refresh"' })
      .toBe(updated);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.lambda-function-page-of-a-missing-function-says-not-found', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'lfp-missing');
  const seeded = new LambdaSeeded(ctx, port, p);

  await lines.line(
    'Open `/aws/lambda/functions/function/<p>-missing` → `h1` `<p>-missing`, "Function not found", no tabs; the link "Event Functions" leads to the list',
    async () => {
      const missing = `${p}-missing`;
      const read = await getFunctionDirect(ctx, port, missing);
      expect(read.found ? 'found' : read.errorType, `a direct GetFunction ${missing}`).toBe(
        'ResourceNotFoundException',
      );
      await openFunction(page, missing);
      const f = functionPage(page, missing);
      await expect(f.notFound, `"${NOT_FOUND}"`).toBeVisible();
      await expect(f.notFoundSentence, 'the sentence of R5.6').toBeVisible();
      expect(await f.tabs.count(), 'tabs on the page').toBe(0);
      const link = await contentLink(page, EVENT_FUNCTIONS);
      expect(link, `the link "${EVENT_FUNCTIONS}" of the content`).not.toBeNull();
      if (link === null) return;
      await link.click(ACTION);
      await expect(page).toHaveURL(addressOf(FUNCTIONS_PATH));
      await expect(listHeading(page), 'the list').toBeVisible();
    },
  );

  await lines.line(
    'On a function\'s page, delete the function directly and choose "Refresh" → "Function not found"',
    async () => {
      const gone = `${p}-gone`;
      await seeded.function(gone);
      await openFunction(page, gone);
      const f = functionPage(page, gone);
      await expect(f.tab('Code'), 'the page of the function, before the delete').toBeVisible();
      const deleted = await deleteFunctionDirect(ctx, port, gone);
      expect('error' in deleted ? deleted.error : deleted.status, `direct DeleteFunction ${gone}`).toBe(204);
      await f.refresh.click(ACTION);
      await expect(f.notFound, `"${NOT_FOUND}" after "Refresh"`).toBeVisible();
      await expect(page).toHaveURL(addressOf(functionPath(gone)));
    },
  );

  lines.end();
});
