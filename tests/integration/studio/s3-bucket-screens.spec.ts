// The four screens of a bucket together, in the built app served by `bun run serve`, in front of a real engine started
// for that Studio and the run's emulator (test-criteria.md, issue 256, Flow checks; requirement R5.5, R11.2, R12): a
// bucket the emulator does not hold is "Bucket not found" on each screen, and the screens talk only to Studio's origin
// and the engine, keep nothing of a bucket in browser storage and show the emulator's values as text.
//
// `studio.s3-bucket-screens-of-a-missing-bucket-say-not-found`, `studio.s3-bucket-screens-talk-only-to-the-engine`.
//
// Each check names its buckets with its own prefix `<p>` and reads them back directly by name; every bucket is made or
// tracked by `Seeded`, so it is emptied and removed when the check ends. Words and readers:
// `support/s3-bucket-actions.ts` and `support/s3-bucket-page.ts`; direct calls and `Seeded`: `support/s3.ts`.

import type { Page } from '@playwright/test';

import { emulatorDir, EnvError, expect, readEmulatorFiles, startStack, test } from './support';
import { areaImages } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { BUCKETS_PATH, bucketNamesDirect, checkPrefix, H1, listBucketsDirect, Seeded } from './support/s3';
import {
  bucketPath,
  createdItem,
  expectBucketPage,
  expectSections,
  form,
  openBucketPage,
  openForm,
  REFRESH,
  SECTIONS,
  shownSectionTitles,
  WEBSITE,
} from './support/s3-bucket-page';
import {
  deletedItem,
  deletePage,
  deletePath,
  emptiedResult,
  emptyPath,
  expectFlash,
  expectPageShows,
  GENERAL_PURPOSE_BUCKETS,
  NOT_FOUND,
  notFoundSentence,
  openDeletePage,
  openEmptyPage,
  pageControl,
  startEmptying,
} from './support/s3-bucket-actions';
import { Traffic } from './support/traffic';

/** Waits for the bucket list. */
async function expectList(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf(BUCKETS_PATH));
  await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
}

/** The three screens that read one bucket, by the route of `name`, with the `h1` each keeps (R4.3, R5.5). */
const SCREENS: { screen: string; path: (name: string) => string; h1: (name: string) => string }[] = [
  { screen: "the bucket's page", path: bucketPath, h1: (name) => name },
  { screen: 'the empty page', path: emptyPath, h1: () => 'Empty bucket' },
  { screen: 'the delete page', path: deletePath, h1: () => 'Delete bucket' },
];

/** Waits until the page shows "Bucket not found" for `name`, with its sentence and the link to the list. */
async function expectNotFound(page: Page, name: string, where: string): Promise<void> {
  await expectPageShows(page, NOT_FOUND, `${where}: "${NOT_FOUND}"`);
  await expectPageShows(page, notFoundSentence(name), `${where}: the sentence with the name`);
  await expect(
    pageControl(page, GENERAL_PURPOSE_BUCKETS),
    `${where}: the link "${GENERAL_PURPOSE_BUCKETS}"`,
  ).toBeVisible();
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-bucket-screens-of-a-missing-bucket-say-not-found', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'screens-missing');
  const seeded = new Seeded(ctx, port);

  await lines.line(
    'Open the page, the empty page and the delete page of a name the emulator does not hold → each shows "Bucket not found" with the name and the link "General purpose buckets", which opens the list',
    async () => {
      const missing = `${p}-never`;
      expect(await bucketNamesDirect(ctx, port, missing), `a direct ListBuckets under ${missing}`).not.toContain(
        missing,
      );
      for (const s of SCREENS) {
        await page.goto(s.path(missing));
        await expect(heading(page, s.h1(missing)), `${s.screen}: its h1`).toBeVisible();
        await expectNotFound(page, missing, s.screen);
        await pageControl(page, GENERAL_PURPOSE_BUCKETS).click(ACTION);
        await expectList(page);
      }
    },
  );

  await lines.line(
    'With a bucket\'s page shown, delete the bucket directly and choose "Refresh" → "Bucket not found"',
    async () => {
      const name = `${p}-deleted`;
      await seeded.bucket(name);
      await openBucketPage(page, name);
      await expect
        .poll(async () => (await shownSectionTitles(page)).length, { message: 'the sections are shown' })
        .toBe(SECTIONS.length);
      await seeded.remove(name);
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets under ${name}`).not.toContain(name);
      await page.getByRole('button', { name: REFRESH, exact: true }).click(ACTION);
      await expectNotFound(page, name, 'the page after "Refresh"');
    },
  );

  await lines.line(
    'A name that is the start of an existing bucket\'s name (`<p>-ab` beside `<p>-abc`) → "Bucket not found"',
    async () => {
      const [short, long] = [`${p}-ab`, `${p}-abc`];
      await seeded.bucket(long);
      const direct = await bucketNamesDirect(ctx, port, short);
      expect(direct, `a direct ListBuckets under ${short}`).toContain(long);
      expect(direct, `a direct ListBuckets under ${short}`).not.toContain(short);
      for (const s of SCREENS) {
        await page.goto(s.path(short));
        await expect(heading(page, s.h1(short)), `${s.screen}: its h1`).toBeVisible();
        await expectNotFound(page, short, `${s.screen} of ${short}`);
      }
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

/** A text that would be markup if it were not shown as text (R12). */
const MARKUP = '<img src=x onerror=alert(1)>';

/** An address of an AWS host: anything under `amazonaws.com`, `aws.amazon.com` or `amazonaws.com.cn`. */
const AWS_HOST = /(^|[^a-z0-9-])([a-z0-9-]+\.)*(amazonaws\.com(\.cn)?|aws\.amazon\.com)/i;

test('studio.s3-bucket-screens-talk-only-to-the-engine', async ({ ctx, page, context }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'screens-safe');
  const seeded = new Seeded(ctx, port);
  const dialogs: string[] = [];
  page.on('dialog', (dialog) => {
    dialogs.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss().catch(() => undefined);
  });

  await lines.line(
    "Open a bucket's page, create a bucket, empty one and delete one → every request of the page went to Studio's origin or the engine on `127.0.0.1`; none carried an emulator key; no stored value of Studio's origin holds a bucket name, an ARN or an object key",
    async () => {
      const [viewed, made, emptied, deleted] = [`${p}-viewed`, `${p}-made`, `${p}-emptied`, `${p}-deleted`];
      const key = `${p}-object-key.txt`;
      await seeded.bucket(viewed);
      seeded.track(made);
      await seeded.bucket(emptied);
      await seeded.object(emptied, key, 'body');
      await seeded.bucket(deleted);
      const arns = (await listBucketsDirect(ctx, port, p)).map((b) => b.arn).filter((a): a is string => a !== null);
      expect(arns.length, 'the ARNs of the buckets, directly').toBeGreaterThan(0);
      const files = readEmulatorFiles(emulatorDir(ctx.home, port));
      if (!files) throw new EnvError(`the emulator files under ${emulatorDir(ctx.home, port)} are incomplete`);
      const traffic = Traffic.attach(ctx, context, page);

      await openBucketPage(page, viewed);
      await expect
        .poll(async () => (await shownSectionTitles(page)).length, { message: 'the sections are shown' })
        .toBe(SECTIONS.length);
      await openForm(page);
      await form(page).name.fill(made, ACTION);
      await form(page).create.click(ACTION);
      await expectList(page);
      await expectFlash(page, 'success', createdItem(made));
      await openEmptyPage(page, emptied);
      await startEmptying(page, emptied);
      await expectPageShows(page, emptiedResult(emptied, 1), 'the emptying finished', 30_000);
      await openDeletePage(page, deleted);
      await deletePage(page).field.fill(deleted, ACTION);
      await deletePage(page).delete.click(ACTION);
      await expectList(page);
      await expectFlash(page, 'success', deletedItem(deleted));
      await traffic.settle();
      ctx.log(`the page made ${String(traffic.requests.length)} requests`);

      expect(new URL(stack.engine.url).hostname, "the engine's host").toBe('127.0.0.1');
      const allowed = [stack.studio.origin, stack.engine.url];
      const elsewhere = traffic.requests
        .map((r) => new URL(r.url))
        .filter((u) => u.protocol !== 'data:' && u.protocol !== 'blob:' && !allowed.includes(u.origin))
        .map((u) => u.origin + u.pathname);
      expect(elsewhere, `requests to anything but ${allowed.join(' and ')}`).toEqual([]);

      // Only which secret and where is reported, never the value.
      const secrets: [string, string][] = [
        ['access key id', files.accessKeyId],
        ['secret access key', files.secretAccessKey],
      ];
      const carried: string[] = [];
      for (const r of traffic.requests) {
        const parts = [r.url, r.postData ?? '', ...Object.entries(r.headers).map(([k, v]) => `${k}: ${v}`)];
        for (const [what, value] of secrets) {
          if (parts.some((part) => part.includes(value)))
            carried.push(`${what} in ${r.method} ${new URL(r.url).pathname}`);
        }
      }
      expect(carried, 'requests that carried an emulator key').toEqual([]);

      const stored = await page.evaluate(async () => {
        const values: string[] = [];
        for (const s of [localStorage, sessionStorage]) {
          for (const [k, v] of Object.entries(s)) values.push(`${k}=${v}`);
        }
        for (const info of await indexedDB.databases()) {
          if (!info.name) continue;
          const db = await new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(info.name!);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          for (const store of db.objectStoreNames) {
            const rows = await new Promise<unknown[]>((resolve, reject) => {
              const request = db.transaction(store, 'readonly').objectStore(store).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            for (const row of rows) values.push(`${info.name}/${store}: ${JSON.stringify(row)}`);
          }
          db.close();
        }
        values.push(`cookies=${document.cookie}`);
        return values;
      });
      const wanted = [viewed, made, emptied, deleted, key, ...arns];
      expect(
        stored.filter((v) => wanted.some((w) => v.includes(w))).map((v) => v.split('=')[0]),
        'stored values that hold a bucket name, an ARN or an object key',
      ).toEqual([]);
    },
  );

  await lines.line(
    'A bucket made directly with the tag value `<img src=x onerror=alert(1)>` and a website index document of the same text → both are shown as text on its page, the page holds no image made from them and no dialog opened',
    async () => {
      // PM decision of 2026-11-17 21:55 (decisions-needed 12, option a): the emulator refuses a tag value with `<`
      // (400 `InvalidTag`, as AWS does), so the tag part of the Given is dropped; the website index document of that
      // text, which it stores, carries the case alone.
      const name = `${p}-markup`;
      await seeded.bucket(name);
      await seeded.configure(name, { website: { indexDocument: MARKUP } });
      dialogs.length = 0;
      await openBucketPage(page, name);
      await expectSections(page, { [WEBSITE]: { fields: { 'Index document': MARKUP } } }, 'the index document as text');
      expect(await page.locator('img[src="x"]').count(), 'images made from the text').toBe(0);
      expect(await areaImages(page), 'images inside the area').toEqual([]);
      expect(dialogs, 'dialogs opened').toEqual([]);
    },
  );

  await lines.line('A bucket with a website configuration → its page shows no address of an AWS host', async () => {
    const name = `${p}-site`;
    await seeded.bucket(name);
    await seeded.configure(name, { website: { indexDocument: 'index.html', errorDocument: 'error.html' } });
    await openBucketPage(page, name);
    await expectBucketPage(page, name);
    await expectSections(
      page,
      { [WEBSITE]: { fields: { [WEBSITE]: 'Enabled', 'Index document': 'index.html' } } },
      'the website section',
    );
    const shown = await page.evaluate(() => ({
      text: document.body.innerText,
      links: [...document.querySelectorAll('a[href]')].map((a) => (a as HTMLAnchorElement).href),
    }));
    const found = [
      ...shown.text.split('\n').filter((l) => AWS_HOST.test(l)),
      ...shown.links.filter((h) => AWS_HOST.test(new URL(h).hostname)),
    ];
    expect(found, 'addresses of an AWS host on the page').toEqual([]);
  });

  lines.end();
});
