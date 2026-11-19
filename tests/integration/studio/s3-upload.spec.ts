// The Upload page and "Create folder" (issue 480, task 3) in the built app served by `bun run serve`, in front of a
// real engine and the run's emulator (test-criteria.md, Integration): files are put in a folder, one `PutObject` up
// to 8 MiB and in parts above; the emulator's refusal is shown, and a refused multipart upload is aborted; "Create
// folder" puts the empty object of a new folder and refuses one that already exists.
//
// `studio.s3-upload-puts-files-in-a-folder`, `studio.s3-upload-shows-the-emulator-refusal`,
// `studio.s3-upload-in-parts-aborts-on-refusal`, `studio.s3-create-folder`.
//
// "The test's client" is the check's own signed requests to the emulator. Every bucket carries the check's prefix
// `<p>`. The files are given to the page's picker from memory. Words, parts and `ListMultipartUploads`:
// `services/s3/s3-upload.ts`; the object calls: `services/s3/s3-object-page.ts`; the Objects tab:
// `services/s3/s3-objects.ts`; `Seeded`: `services/s3/s3.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import { objectKeysDirect, Seeded } from './services/s3/s3';
import { flashTexts, openObjectsTab } from './services/s3/s3-bucket-page';
import { getObjectDirect, headObjectDirect, putObjectWith } from './services/s3/s3-object-page';
import { expectKeys, objectsAddress, objectsTab } from './services/s3/s3-objects';
import {
  addFiles,
  BUCKET_LIMIT,
  createFolder,
  fileRows,
  folderCreated,
  folderExists,
  MIB,
  multipartUploadsDirect,
  partRefusalDirect,
  putRefusalDirect,
  randomFile,
  refusalPattern,
  uploadAddress,
  uploadedText,
  uploadLink,
  uploadPage,
} from './services/s3/s3-upload';

/** Puts four objects of 15 MiB (60 MiB) into `bucket` with the test's client. */
async function fill(ctx: Parameters<typeof putObjectWith>[0], port: number, bucket: string): Promise<void> {
  for (let i = 0; i < 4; i++) {
    await putObjectWith(ctx, port, bucket, `fill/${String(i)}.bin`, randomFile('fill', 15 * MIB).buffer);
  }
}

test('studio.s3-upload-puts-files-in-a-folder', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'upload-put');
  const name = `${p}-up`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  const note = { name: 'note.txt', mimeType: 'text/plain', buffer: Buffer.from('twenty bytes of text') };
  const blob = randomFile('blob.bin', 20 * MIB);
  expect(note.buffer.length, 'note.txt holds 20 bytes').toBe(20);

  await lines.line(
    'From the Objects tab at `logs/` (made by "Create folder"), "Upload", add both, "Upload" → each row reads "Uploaded" and the page says "Uploaded 2 of 2 files."; the emulator holds `logs/note.txt` (`text/plain`, 20 bytes) and `logs/blob.bin` (20971520 bytes, an ETag ending in `-3`), and `GetObject` of each returns the file\'s bytes; "Go to `<p>-up`" → the tab at `logs/` lists both',
    async () => {
      await openObjectsTab(page, name);
      const folder = createFolder(page);
      await folder.open.click(ACTION);
      await folder.name.fill('logs');
      await folder.create.click(ACTION);
      await expectKeys(page, ['logs/'], 'the folder made');
      await objectsTab(page).keyLink('logs/').click(ACTION);
      await expect(page).toHaveURL(addressOf(objectsAddress(name, 'logs/')));
      await uploadLink(page).click(ACTION);
      await expect(page).toHaveURL(addressOf(uploadAddress(name, 'logs/')));
      await addFiles(page, [note, blob]);
      await uploadPage(page).upload.click(ACTION);
      await expect
        .poll(() => fileRows(page), { message: 'the rows', timeout: 60_000 })
        .toEqual([
          { name: 'note.txt', status: 'Uploaded' },
          { name: 'blob.bin', status: 'Uploaded' },
        ]);
      await expect.poll(() => flashTexts(page), { message: 'the flash', ...ACTION }).toContain(uploadedText(2, 2));

      const noteHead = await headObjectDirect(ctx, port, name, 'logs/note.txt');
      const blobHead = await headObjectDirect(ctx, port, name, 'logs/blob.bin');
      ctx.log(`direct HeadObject: ${JSON.stringify({ noteHead, blobHead })}`);
      expect(noteHead['content-type'], 'logs/note.txt: its type').toBe('text/plain');
      expect(noteHead['content-length'], 'logs/note.txt: its size').toBe('20');
      expect(blobHead['content-length'], 'logs/blob.bin: its size').toBe('20971520');
      expect(blobHead.etag, 'logs/blob.bin: an ETag of three parts').toMatch(/-3"?$/);
      expect((await getObjectDirect(ctx, port, name, 'logs/note.txt')).equals(note.buffer), 'note.txt bytes').toBe(
        true,
      );
      expect((await getObjectDirect(ctx, port, name, 'logs/blob.bin')).equals(blob.buffer), 'blob.bin bytes').toBe(
        true,
      );

      await uploadPage(page).goTo(name).click(ACTION);
      await expect(page).toHaveURL(addressOf(objectsAddress(name, 'logs/')));
      await expectKeys(page, ['blob.bin', 'note.txt'], 'the tab at logs/');
    },
  );

  lines.end();
});

test('studio.s3-upload-shows-the-emulator-refusal', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'upload-full');
  const name = `${p}-full`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await fill(ctx, port, name);
  const file = randomFile('eight.bin', 8 * MIB);

  await lines.line(
    'Upload the file → its row reads "Failed:" with the emulator\'s message naming the 67108864 bytes the bucket keeps, the page says "Uploaded 0 of 1 files.", and the emulator holds no object of the file\'s name',
    async () => {
      await page.goto(uploadAddress(name));
      await addFiles(page, [file]);
      await uploadPage(page).upload.click(ACTION);
      await expect
        .poll(async () => (await fileRows(page))[0]?.status ?? '', { message: 'the row', timeout: 60_000 })
        .toMatch(/^Failed:/);
      const status = (await fileRows(page))[0]?.status ?? '';
      ctx.log(`the row: ${status}`);
      await expect.poll(() => flashTexts(page), { message: 'the flash', ...ACTION }).toContain(uploadedText(0, 1));
      expect(await objectKeysDirect(ctx, port, name), `a direct ListObjectsV2 of ${name}`).not.toContain(file.name);
      // The emulator's own words for the same file in one PutObject, read now: "storing … would leave the bucket".
      const message = await putRefusalDirect(ctx, port, name, file.name, file.buffer, file.mimeType);
      ctx.log(`direct PutObject refused: ${message}`);
      expect(message, 'the direct refusal names the limit').toContain(String(BUCKET_LIMIT));
      expect(status, "the row: the emulator's message of a single PutObject").toMatch(refusalPattern(message));
    },
  );

  lines.end();
});

test('studio.s3-upload-in-parts-aborts-on-refusal', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'upload-fullm');
  const name = `${p}-fullm`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await fill(ctx, port, name);
  const file = randomFile('twelve.bin', 12 * MIB);

  await lines.line(
    'Upload the file → its row reads "Failed:" with the emulator\'s message that recording a part would leave the bucket past the 67108864 bytes it keeps (`UploadPart` refuses, requirement "Sizes"); the emulator holds no object of the file\'s name, and `ListMultipartUploads` of the test\'s client lists no upload for its key',
    async () => {
      await page.goto(uploadAddress(name));
      await addFiles(page, [file]);
      await uploadPage(page).upload.click(ACTION);
      await expect
        .poll(async () => (await fileRows(page))[0]?.status ?? '', { message: 'the row', timeout: 60_000 })
        .toMatch(/^Failed:/);
      const status = (await fileRows(page))[0]?.status ?? '';
      ctx.log(`the row: ${status}`);
      expect(await objectKeysDirect(ctx, port, name), `a direct ListObjectsV2 of ${name}`).not.toContain(file.name);
      await expect
        .poll(() => multipartUploadsDirect(ctx, port, name), {
          message: `a direct ListMultipartUploads of ${name}`,
          ...ACTION,
        })
        .not.toContain(file.name);
      // The emulator's own words for the file's first 8 MiB part, read now: "recording part 1 would leave the bucket".
      const message = await partRefusalDirect(
        ctx,
        port,
        name,
        file.name,
        file.buffer.subarray(0, 8 * MIB),
        file.mimeType,
      );
      ctx.log(`direct UploadPart refused: ${message}`);
      expect(message, 'the direct refusal names the limit').toContain(String(BUCKET_LIMIT));
      expect(status, "the row: the emulator's message of a part").toMatch(refusalPattern(message));
      expect(await multipartUploadsDirect(ctx, port, name), 'no upload left after the direct one').not.toContain(
        file.name,
      );
    },
  );

  lines.end();
});

test('studio.s3-create-folder', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'create-folder');
  const name = `${p}-f`;
  const seeded = new Seeded(ctx, port);
  await seeded.bucket(name);
  await seeded.object(name, 'logs/a.txt', 'under logs, no logs/ object');
  const folder = createFolder(page);

  await lines.line(
    '"Create folder" named `reports` → "Folder `reports` created." and `reports/` is a row; the emulator holds the empty object `reports/`',
    async () => {
      await openObjectsTab(page, name);
      await expectKeys(page, ['logs/'], 'the rows at the root');
      await folder.open.click(ACTION);
      await folder.name.fill('reports');
      await folder.create.click(ACTION);
      await expect
        .poll(() => flashTexts(page), { message: 'the flash', ...ACTION })
        .toContain(folderCreated('reports'));
      await expectKeys(page, ['logs/', 'reports/'], 'the rows after "Create folder"');
      expect(await objectKeysDirect(ctx, port, name), `a direct ListObjectsV2 of ${name}`).toContain('reports/');
      const head = await headObjectDirect(ctx, port, name, 'reports/');
      expect(head['content-length'], 'reports/ is empty').toBe('0');
    },
  );

  await lines.line(
    '"Create folder" named `logs` → "A folder `logs` already exists here." and the emulator holds no object `logs/`',
    async () => {
      await openObjectsTab(page, name);
      await expectKeys(page, ['logs/', 'reports/'], 'the rows at the root');
      await folder.open.click(ACTION);
      await folder.name.fill('logs');
      await folder.create.click(ACTION);
      await expect(folder.dialog.getByText(folderExists('logs'), { exact: true })).toBeVisible(ACTION);
      expect(await objectKeysDirect(ctx, port, name), `a direct ListObjectsV2 of ${name}`).not.toContain('logs/');
    },
  );

  lines.end();
});
