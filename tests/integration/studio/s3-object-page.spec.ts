// An object's page (issue 480, task 2) in the built app served by `bun run serve`, in front of a real engine and the
// run's emulator (test-criteria.md, Integration): it shows what the object holds and saves its bytes; it says so when
// the object is gone.
//
// `studio.s3-object-page-shows-what-the-object-holds`, `studio.s3-object-page-of-an-object-that-is-gone`.
//
// "The test's client" is the check's own signed requests to the emulator, standing for the developer's app or the AWS
// CLI. Every bucket carries the check's prefix `<p>`. Words, readers and direct calls of the page:
// `services/s3/s3-object-page.ts`; of the Objects tab: `services/s3/s3-objects.ts`; `Seeded`: `services/s3/s3.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix, SEOUL } from './support/service-screens';
import { Seeded } from './services/s3/s3';
import { expectBucketPage, OBJECTS, openObjectsTab } from './services/s3/s3-bucket-page';
import {
  download,
  entryRows,
  expectedOverview,
  getObjectDirect,
  goTo,
  headObjectDirect,
  NO_PREVIEW,
  noObject,
  objectAddress,
  objectPage,
  OVERVIEW,
  putObjectWith,
  sectionPairs,
  TAGS,
  truncatedText,
  USER_METADATA,
  deleteObjectDirect,
} from './services/s3/s3-object-page';
import { crumbsShown, objectsAddress, objectsTab } from './services/s3/s3-objects';

/** `length` bytes of JSON text. */
function jsonOf(length: number): string {
  const start = '{"app":"emuforge","pad":"';
  const end = '"}\n';
  return `${start}${'x'.repeat(length - start.length - end.length)}${end}`;
}

/** `length` bytes that are not UTF-8: every byte from 0x80 to 0xff, over and over. */
function notUtf8(length: number): Buffer {
  return Buffer.from(Array.from({ length }, (_, i) => 0x80 + (i % 0x80)));
}

/** `length` bytes of ASCII lines, each naming its number. */
function logOf(length: number): string {
  let text = '';
  for (let i = 0; text.length < length; i++) text += `line ${String(i).padStart(6, '0')} of the check's log\n`;
  return text.slice(0, length);
}

test.describe(() => {
  // "Last modified" reads in the zone the check sets on its browser context.
  test.use({ timezoneId: SEOUL.timeZone, acceptDownloads: true });

  test('studio.s3-object-page-shows-what-the-object-holds', async ({ ctx, page }) => {
    const stack = await startStack(ctx);
    const port = stack.emulatorPort;
    const lines = new Lines(ctx);
    const p = checkPrefix(ctx, 'object-holds');
    const name = `${p}-obj`;
    const seeded = new Seeded(ctx, port);
    await seeded.bucket(name);
    const app = jsonOf(300);
    const big = logOf(200 * 1024);
    await putObjectWith(ctx, port, name, 'cfg/app.json', app, {
      contentType: 'application/json',
      metadata: { owner: 'ci' },
      tags: { env: 'dev' },
    });
    await putObjectWith(ctx, port, name, 'img.png', notUtf8(2048), { contentType: 'image/png' });
    await putObjectWith(ctx, port, name, 'big.log', big, { contentType: 'text/plain' });
    const shown = objectPage(page);

    /** From the Objects tab at `prefix`, the row `row` → the object's page for `key`. */
    async function openFromTab(prefix: string, row: string, key: string): Promise<void> {
      await openObjectsTab(page, name, prefix);
      await objectsTab(page).keyLink(row).click(ACTION);
      await expect(page).toHaveURL(addressOf(objectAddress(name, key)));
      await expect(shown.section(OVERVIEW), `"${OVERVIEW}"`).toBeVisible(ACTION);
    }

    await lines.line(
      "Choose `app.json` in `cfg/` → the crumbs end `<p>-obj` > `cfg` > `app.json`; the address is `/aws/s3/buckets/<p>-obj/object?key=cfg%2Fapp.json`; Key, Size, Content type, Last modified, ETag and Storage class read as `HeadObject` reports them; S3 URI `s3://<p>-obj/cfg/app.json`; user metadata `owner` = `ci`; tag `env` = `dev`; the preview is the body's text",
      async () => {
        await openFromTab('cfg/', 'app.json', 'cfg/app.json');
        expect(objectAddress(name, 'cfg/app.json'), 'the address').toBe(
          `/aws/s3/buckets/${name}/object?key=cfg%2Fapp.json`,
        );
        await expect
          .poll(async () => (await crumbsShown(page)).slice(-3), { message: 'the last three crumbs', ...ACTION })
          .toEqual([
            { text: name, link: true },
            { text: 'cfg', link: true },
            { text: 'app.json', link: false },
          ]);
        const head = await headObjectDirect(ctx, port, name, 'cfg/app.json');
        ctx.log(`direct HeadObject: ${JSON.stringify(head)}`);
        const expected = expectedOverview(name, 'cfg/app.json', head, SEOUL);
        expect(expected['Content type'], 'the direct answer: the type put').toBe('application/json');
        expect(expected.Size, 'the direct answer: 300 bytes').toBe('300 bytes');
        await expect
          .poll(
            async () => {
              const pairs = await sectionPairs(page, OVERVIEW);
              return Object.fromEntries(Object.keys(expected).map((label) => [label, pairs[label]]));
            },
            { message: `"${OVERVIEW}"`, ...ACTION },
          )
          .toEqual(expected);
        await expect
          .poll(() => entryRows(page, USER_METADATA), { message: `"${USER_METADATA}"`, ...ACTION })
          .toEqual([['owner', 'ci']]);
        await expect.poll(() => entryRows(page, TAGS), { message: `"${TAGS}"`, ...ACTION }).toEqual([['env', 'dev']]);
        await expect.poll(() => shown.preview.textContent(), { message: 'the preview', ...ACTION }).toBe(app);
      },
    );

    await lines.line(
      '"Download" → the browser saves a file named `app.json` whose bytes equal `GetObject`\'s',
      async () => {
        await openFromTab('cfg/', 'app.json', 'cfg/app.json');
        const saved = await download(page);
        const direct = await getObjectDirect(ctx, port, name, 'cfg/app.json');
        expect(saved.name, 'the file name').toBe('app.json');
        expect(saved.bytes.equals(direct), "the bytes equal GetObject's").toBe(true);
      },
    );

    await lines.line(
      'Open `img.png` → "No preview for this type. Download the object to open it."; "Download" → a file `img.png` with the same bytes as `GetObject`\'s',
      async () => {
        await openFromTab('', 'img.png', 'img.png');
        await expect(page.getByRole('main').getByText(NO_PREVIEW, { exact: true })).toBeVisible(ACTION);
        const saved = await download(page);
        const direct = await getObjectDirect(ctx, port, name, 'img.png');
        expect(direct.length, 'the direct answer: 2 KiB').toBe(2048);
        expect(saved.name, 'the file name').toBe('img.png');
        expect(saved.bytes.equals(direct), "the bytes equal GetObject's").toBe(true);
      },
    );

    await lines.line(
      'Open `big.log` → the preview is the first 65536 bytes\' text and "Showing the first 64 KiB of" the size',
      async () => {
        await openFromTab('', 'big.log', 'big.log');
        await expect(
          page.getByRole('main').getByText(truncatedText(big.length), { exact: true }),
          `"${truncatedText(big.length)}"`,
        ).toBeVisible(ACTION);
        await expect
          .poll(() => shown.preview.textContent(), { message: 'the preview', ...ACTION })
          .toBe(big.slice(0, 65536));
      },
    );

    lines.end();
  });
});

test('studio.s3-object-page-of-an-object-that-is-gone', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'object-gone');
  const name = `${p}-og`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await seeded.object(name, 'x.txt', 'gone soon');
  const shown = objectPage(page);

  await lines.line(
    'Open its page, delete the key with the test\'s client, "Refresh" → "No object `x.txt`" with "Go to `<p>-og`", which leads to the Objects tab',
    async () => {
      await page.goto(objectAddress(name, 'x.txt'));
      await expect(shown.section(OVERVIEW), `"${OVERVIEW}"`).toBeVisible(ACTION);
      await deleteObjectDirect(ctx, port, name, 'x.txt');
      await shown.refresh.click(ACTION);
      await expect(page.getByRole('main').getByText(noObject('x.txt'), { exact: true })).toBeVisible(ACTION);
      const back = page.getByRole('main').getByRole('link', { name: goTo(name), exact: true });
      await expect(back, `"${goTo(name)}"`).toBeVisible();
      await back.click(ACTION);
      await expect(page).toHaveURL(addressOf(objectsAddress(name)));
      await expectBucketPage(page, name, OBJECTS);
    },
  );

  lines.end();
});
