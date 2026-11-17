// The four screens of a bucket while the emulator or the engine stops and starts again, in the built app served by
// `bun run serve` (test-criteria.md, issue 256, Flow checks; requirement R11): the read of a page shows the emulator
// line's status for the state and reads again by itself once connected; an action reports the failure above its
// buttons and keeps what was typed.
//
// `studio.s3-bucket-screens-follow-emulator-stop-and-restart`, `studio.s3-bucket-screens-say-when-the-engine-stops-answering`.
//
// The emulator check has its own emulator (`own-emulator`): it stops and restarts it, and a restarted emulator holds
// no bucket (R2). The engine check uses the run's emulator and stops only the engine it started; its buckets carry its
// own prefix `<p>`. "Within two connection checks" is the emulator line's bound (`LINE_CHANGE_BOUND_MS`). The
// engine's message is the one its answer carried (`EngineAnswers`). Words and readers: `support/s3-bucket-actions.ts`
// and `support/s3-bucket-page.ts`; direct calls and `Seeded`: `support/s3.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { connectedAt, engineNotAnswering, expectLine, LINE_CHANGE_BOUND_MS, notStartedOn } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { markPage, stillSamePage } from './support/home';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { BUCKETS_PATH, bucketNamesDirect, H1, Seeded } from './services/s3/s3';
import {
  bucketPath,
  createdItem,
  expectBucketPage,
  form,
  formState,
  openBucketPage,
  openForm,
  REFRESH,
  SECTIONS,
  shownSectionTitles,
} from './services/s3/s3-bucket-page';
import {
  CONNECTION_STATUS,
  deletedCount,
  deletePage,
  deletePath,
  EMULATOR_DID_NOT_ANSWER,
  emptyPage,
  emptyPath,
  engineDidNotAnswer,
  EngineAnswers,
  expectAbove,
  expectFlash,
  expectPageShows,
  NOT_FOUND,
  NOT_READ,
  openDeletePage,
  openEmptyPage,
  pageControl,
  RETRY,
} from './services/s3/s3-bucket-actions';

/** How long a screen may take to read again by itself once the connection is back: the line's bound, twice. */
const BACK_BOUND_MS = 2 * LINE_CHANGE_BOUND_MS;

/** Waits for the bucket list. */
async function expectList(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf(BUCKETS_PATH));
  await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
}

/**
 * Waits until the page itself shows `status` (the line's words for the state), "The bucket could not be read." and
 * "Retry", and, with `connectionStatus`, its own link "Connection status".
 */
async function expectNotRead(page: Page, status: RegExp, where: string, connectionStatus: boolean): Promise<void> {
  await expectPageShows(page, status, `${where}: the line's status ${String(status)}`, LINE_CHANGE_BOUND_MS);
  await expectPageShows(page, NOT_READ, `${where}: "${NOT_READ}"`);
  await expect(page.getByRole('button', { name: RETRY, exact: true }), `${where}: "${RETRY}"`).toBeVisible();
  if (connectionStatus) {
    await expect(pageControl(page, CONNECTION_STATUS), `${where}: the page's "${CONNECTION_STATUS}"`).toBeVisible();
  }
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-screens-follow-emulator-stop-and-restart', async ({ ctx, page, context }) => {
  test.setTimeout(420_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const port = emulator.port;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'screens-restart');
  let seeded = new Seeded(ctx, port);
  const answers = EngineAnswers.attach(ctx, context, stack.engine.url);
  let running = true;

  const stop = async () => {
    if (!running) return;
    await emulator.stop();
    running = false;
  };
  /** Starts the emulator again (empty, with new keys); a new `Seeded`, since the buckets made before are gone. */
  const start = async () => {
    if (running) return;
    await emulator.startAgain();
    running = true;
    seeded = new Seeded(ctx, port);
  };

  await lines.line(
    'With a bucket\'s page shown, stop the emulator and choose "Refresh" → within two connection checks the page shows the emulator line\'s status for the state with "The bucket could not be read.", the link "Connection status" and "Retry"',
    async () => {
      await start();
      const name = `${p}-page`;
      await seeded.bucket(name);
      await openBucketPage(page, name);
      await markPage(page);
      await stop();
      await page.getByRole('button', { name: REFRESH, exact: true }).click(ACTION);
      await expectNotRead(page, notStartedOn(port), "the bucket's page", true);
      await expectLine(page, notStartedOn(port));
    },
  );

  await lines.line(
    'Start the emulator again → without a reload and without any action the page shows "Bucket not found" (the restarted emulator holds none; a direct `ListBuckets` agrees)',
    async () => {
      const name = `${p}-page`;
      if (running) {
        // The Given: the page of a bucket the stopped emulator held, in its failure state.
        await seeded.bucket(name);
        await openBucketPage(page, name);
        await markPage(page);
        await stop();
        await page.getByRole('button', { name: REFRESH, exact: true }).click(ACTION);
        await expectNotRead(page, notStartedOn(port), "the bucket's page", false);
      }
      await start();
      await expectPageShows(page, NOT_FOUND, `"${NOT_FOUND}" by itself`, BACK_BOUND_MS);
      expect(await bucketNamesDirect(ctx, port, name), 'a direct ListBuckets of the restarted emulator').not.toContain(
        name,
      );
      expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
    },
  );

  await lines.line(
    'With the emulator stopped, open the empty page and the delete page of a bucket it held → each shows the line\'s status with "The bucket could not be read."; start the emulator again → without a reload and without any action each shows "Bucket not found"',
    async () => {
      await start();
      const name = `${p}-held`;
      await seeded.bucket(name);
      await stop();
      const other = await context.newPage();
      try {
        await page.goto(emptyPath(name));
        await expect(heading(page, 'Empty bucket'), "the empty page's h1").toBeVisible();
        await other.goto(deletePath(name));
        await expect(heading(other, 'Delete bucket'), "the delete page's h1").toBeVisible();
        await expectNotRead(page, notStartedOn(port), 'the empty page', false);
        await expectNotRead(other, notStartedOn(port), 'the delete page', false);
        await markPage(page);
        await markPage(other);
        await start();
        await expectPageShows(page, NOT_FOUND, `the empty page: "${NOT_FOUND}" by itself`, BACK_BOUND_MS);
        await expectPageShows(other, NOT_FOUND, `the delete page: "${NOT_FOUND}" by itself`, BACK_BOUND_MS);
        expect(await stillSamePage(page), 'the empty page was not reloaded').toBe(true);
        expect(await stillSamePage(other), 'the delete page was not reloaded').toBe(true);
      } finally {
        await other.close();
      }
    },
  );

  await lines.line(
    'On a complete create form, stop the emulator and "Create bucket" → the form stays with every value and shows "The emulator did not answer" with the engine\'s message above the buttons; start the emulator, "Create bucket" → the list with the success item, and the bucket exists directly',
    async () => {
      await start();
      const name = `${p}-made`;
      const f = form(page);
      await openForm(page);
      await f.name.fill(name, ACTION);
      await f.versioning('Enable').check(ACTION);
      await f.addTag.click(ACTION);
      await f.key(0).fill('env', ACTION);
      await f.value(0).fill('check', ACTION);
      const filled = await formState(page);
      const tag = [await f.key(0).inputValue(ACTION), await f.value(0).inputValue(ACTION)];
      await stop();
      await f.create.click(ACTION);
      await expectAbove(page, EMULATOR_DID_NOT_ANSWER, f.create, `"${EMULATOR_DID_NOT_ANSWER}" above the buttons`);
      await answers.settle("the form's requests end");
      answers.log();
      const message = answers.latestMessage('EmulatorUnavailable');
      expect(message, "the engine's EmulatorUnavailable message").not.toBeNull();
      await expectPageShows(page, message!, "the engine's message");
      await expect(page).toHaveURL(addressOf('/aws/s3/bucket/create'));
      expect(await formState(page), 'the form keeps every value').toEqual(filled);
      expect([await f.key(0).inputValue(ACTION), await f.value(0).inputValue(ACTION)], 'the tag').toEqual(tag);
      await start();
      seeded.track(name);
      await expectLine(page, connectedAt(port), BACK_BOUND_MS);
      await f.create.click(ACTION);
      await expectList(page);
      await expectFlash(page, 'success', createdItem(name));
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets under ${name}`).toContain(name);
    },
  );

  await lines.line(
    'On the delete page of an empty bucket with the name typed, stop the emulator and "Delete bucket" → "The emulator did not answer" above the buttons and the name still typed',
    async () => {
      await start();
      const name = `${p}-delete`;
      await seeded.bucket(name);
      const d = deletePage(page);
      await openDeletePage(page, name);
      await d.field.fill(name, ACTION);
      await expect(d.delete, '"Delete bucket" with the name typed').toBeEnabled();
      await stop();
      await d.delete.click(ACTION);
      await expectAbove(page, EMULATOR_DID_NOT_ANSWER, d.delete, `"${EMULATOR_DID_NOT_ANSWER}" above the buttons`);
      await expect(d.field, 'the name still typed').toHaveValue(name);
    },
  );

  await lines.line(
    'On the empty page with the name typed, stop the emulator and "Empty" → the status shows "The emulator did not answer", "0 items deleted" and "Retry"',
    async () => {
      await start();
      const name = `${p}-empty`;
      await seeded.bucket(name);
      await seeded.object(name, 'one.txt', 'one');
      const e = emptyPage(page);
      await openEmptyPage(page, name);
      await e.field.fill(name, ACTION);
      await expect(e.empty, '"Empty" with the name typed').toBeEnabled();
      await stop();
      await e.empty.click(ACTION);
      await expect(e.statusH1, 'the status').toBeVisible();
      await expectPageShows(page, EMULATOR_DID_NOT_ANSWER, `"${EMULATOR_DID_NOT_ANSWER}" in the status`);
      await expectPageShows(page, deletedCount(0), `"${deletedCount(0)}"`);
      await expect(e.retry, `"${RETRY}"`).toBeVisible();
    },
  );

  await start();
  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-screens-say-when-the-engine-stops-answering', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const engine = stack.engine;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'screens-engine');
  const seeded = new Seeded(ctx, port);
  const name = `${p}-page`;
  await seeded.bucket(name);
  let running = true;

  const stop = async () => {
    if (!running) return;
    await engine.stop();
    running = false;
  };
  const start = async () => {
    if (running) return;
    await engine.startAgain();
    running = true;
  };

  await lines.line(
    'Stop the engine and choose "Refresh" on a bucket\'s page → within two connection checks the page shows "The EmuForge engine at `<engine origin>` is not answering", as the emulator line does, with "The bucket could not be read." and "Retry"',
    async () => {
      await openBucketPage(page, name);
      await markPage(page);
      await stop();
      await page.getByRole('button', { name: REFRESH, exact: true }).click(ACTION);
      await expectNotRead(page, engineNotAnswering(engine.url), "the bucket's page", false);
      await expectLine(page, engineNotAnswering(engine.url));
    },
  );

  await lines.line("Start the engine again → without a reload the page shows the bucket's sections", async () => {
    if (running) {
      // The Given: the bucket's page while the engine does not answer.
      await openBucketPage(page, name);
      await markPage(page);
      await stop();
      await page.getByRole('button', { name: REFRESH, exact: true }).click(ACTION);
    }
    await start();
    await expectLine(page, connectedAt(port), BACK_BOUND_MS);
    await expectBucketPage(page, name);
    await expect
      .poll(async () => [...(await shownSectionTitles(page))].sort(), {
        timeout: BACK_BOUND_MS,
        message: 'the sections shown',
      })
      .toEqual([...SECTIONS].sort());
    await expect(page).toHaveURL(addressOf(bucketPath(name)));
    expect(await stillSamePage(page), 'the document was not reloaded').toBe(true);
  });

  await lines.line(
    'On the delete page of an empty bucket with the name typed, stop the engine and "Delete bucket" → the sentence that the engine did not answer above the buttons; start the engine → the bucket still exists directly',
    async () => {
      await start();
      await expectLine(page, connectedAt(port), BACK_BOUND_MS).catch(() => undefined);
      const d = deletePage(page);
      await openDeletePage(page, name);
      await d.field.fill(name, ACTION);
      await expect(d.delete, '"Delete bucket" with the name typed').toBeEnabled();
      await stop();
      await d.delete.click(ACTION);
      await expectAbove(page, engineDidNotAnswer(engine.url), d.delete, 'the engine sentence above the buttons');
      await start();
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets under ${name}`).toContain(name);
    },
  );

  await start();
  lines.end();
});
