// "Create bucket" in the built app served by `bun run serve`, in front of a real engine started for that Studio and
// the run's emulator (test-criteria.md, issue 256, Flow checks; requirement R6, R9.3, R11.4): a bucket the form
// creates is in the emulator with every setting the form sent, what the form refuses creates nothing, and a double
// press, "Cancel" or leaving the form creates nothing more.
//
// `studio.s3-create-bucket-appears-in-the-emulator`, `studio.s3-create-bucket-stores-every-setting`,
// `studio.s3-create-bucket-refusals-create-nothing`, `studio.s3-create-bucket-repeated-and-abandoned`.
//
// Each check names its buckets with its own prefix `<p>` and reads them back directly by name; a bucket the form may
// make is tracked by `Seeded` so it is emptied and removed when the check ends, whatever the check found. The page's
// requests to the engine are listened to (`EngineRecord`), never changed. Words and readers:
// `support/s3-bucket-page.ts`; direct calls and `Seeded`: `support/s3.ts`.
//
// Issue 467 rewrote one step of `studio.s3-create-bucket-repeated-and-abandoned` (its test-criteria.md, "Flow checks,
// changed"; requirement R9, rule 5): what "Cancel" does once the form holds something. The dialog's words:
// `support/screen-rules.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { crumbLink } from './support/aws-area';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { appeared, checkPrefix, watchText } from './support/service-screens';
import {
  BUCKETS_PATH,
  bucketNamesDirect,
  bucketPropertiesDirect,
  CREATE,
  expectNames,
  filterFor,
  H1,
  listBucketsDirect,
  objectKeysDirect,
  openList,
  screen,
  Seeded,
} from './services/s3/s3';
import {
  CREATE_H1,
  CREATE_PATH,
  createdItem,
  DSSE_KMS,
  EngineRecord,
  expectFieldMessage,
  flashItem,
  flashTexts,
  form,
  FORM_AT_START,
  formState,
  type FormState,
  MESSAGES,
  openForm,
  SSE_KMS,
} from './services/s3/s3-bucket-page';
import { DISCARD, DISCARD_HEADING, discardDialog, KEEP_EDITING } from './support/screen-rules';

/** Waits for the bucket list after the form. */
async function expectList(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf(BUCKETS_PATH));
  await expect(heading(page, H1), `the bucket list's h1 "${H1}"`).toBeVisible();
}

/** The form is still shown, at its address. */
async function expectFormStays(page: Page): Promise<void> {
  await expect(page).toHaveURL(addressOf(CREATE_PATH));
  await expect(heading(page, CREATE_H1), `the form's h1 "${CREATE_H1}"`).toBeVisible();
}

/** Waits until the flash holds exactly the success item of `name`. */
async function expectSuccessAlone(page: Page, name: string): Promise<void> {
  await expect(flashItem(page, createdItem(name)), `the flash item "${createdItem(name)}"`).toBeVisible();
  await expect.poll(() => flashTexts(page), { message: 'the flash holds the success item alone' }).toHaveLength(1);
}

/**
 * The flash items shown on arrival at the list: once one is shown (bounded), every item's text; `[]` when none came.
 * The items are handed over with the route change, so they are all there with the first.
 */
async function flashOnArrival(page: Page): Promise<string[]> {
  await expect
    .poll(async () => (await flashTexts(page)).length, { message: 'a flash item on the list' })
    .toBeGreaterThan(0)
    .catch(() => undefined);
  return flashTexts(page);
}

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-create-bucket-appears-in-the-emulator', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'create-appears');
  const name = `${p}-plain`;
  const seeded = new Seeded(ctx, port);
  seeded.track(name);
  const f = form(page);

  await lines.line(
    'From the list, "Create bucket", type `<p>-plain`, "Create bucket" → the list is shown with "Bucket “<p>-plain” was created in the local emulator." and a row for it under the filter `<p>-plain`',
    async () => {
      await openList(page);
      await screen(page).action(CREATE).click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_PATH));
      await expect(f.h1, `the form's h1 "${CREATE_H1}"`).toBeVisible();
      await f.name.fill(name, ACTION);
      await f.create.click(ACTION);
      await expectList(page);
      await expect(flashItem(page, createdItem(name)), `the flash item "${createdItem(name)}"`).toBeVisible();
      await filterFor(page, name);
      await expectNames(page, [name], `the rows under the filter ${name}`);
    },
  );

  await lines.line(
    'Directly: the bucket exists in `us-east-1` with ownership `BucketOwnerEnforced`, all four public access settings on, no versioning status, no tags, SSE-S3 and no Object Lock',
    async () => {
      const bucket = (await listBucketsDirect(ctx, port, name)).find((b) => b.name === name);
      expect(bucket, `a direct ListBuckets lists ${name}`).toBeDefined();
      expect(bucket?.region, `the Region of ${name}`).toBe('us-east-1');
      const props = await bucketPropertiesDirect(ctx, port, name);
      ctx.log(`direct properties of ${name}: ${JSON.stringify(props)}`);
      expect(props.ownership, 'ownership').toBe('BucketOwnerEnforced');
      expect(props.publicAccessBlock, 'the public access settings').toEqual({
        BlockPublicAcls: true,
        IgnorePublicAcls: true,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      });
      expect(props.versioning, 'the versioning status').toBeNull();
      expect(props.tags, 'the tags').toBeNull();
      expect(props.encryption?.algorithm, 'the default encryption').toBe('AES256');
      expect(props.objectLock, 'Object Lock').toBeNull();
    },
  );

  await lines.line('Dismiss the flash item → it is gone', async () => {
    const item = flashItem(page, createdItem(name));
    await expect(item, `the flash item "${createdItem(name)}"`).toBeVisible();
    await item.getByRole('button', { name: 'Dismiss', exact: true }).click(ACTION);
    await expect(item, 'the dismissed item').toHaveCount(0);
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-create-bucket-stores-every-setting', async ({ ctx, page }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'create-every');
  const full = `${p}-full`;
  const lock = `${p}-lock`;
  const seeded = new Seeded(ctx, port);
  seeded.track(full);
  seeded.track(lock);
  const key = await seeded.kmsKey();
  const f = form(page);
  /** The flash items each creation ended on the list with. */
  const ended = new Map<string, string[]>();

  await lines.line(
    'Create `<p>-full` with "Object writer", two boxes unchecked, versioning "Enable", the tags `env`=`test` and `empty`= (no value), SSE-KMS with the ARN of a key made directly and "Bucket Key" "Disable" → directly: ownership `ObjectWriter`, those two settings off and the other two on, versioning `Enabled`, the two tags, `aws:kms` with that key and the bucket key off',
    async () => {
      await openForm(page);
      await f.name.fill(full, ACTION);
      await f.ownership('Object writer').check(ACTION);
      await f.block('BlockPublicAcls').uncheck(ACTION);
      await f.block('IgnorePublicAcls').uncheck(ACTION);
      await f.versioning('Enable').check(ACTION);
      await f.addTag.click(ACTION);
      await f.key(0).fill('env', ACTION);
      await f.value(0).fill('test', ACTION);
      await f.addTag.click(ACTION);
      await f.key(1).fill('empty', ACTION);
      await f.encryption(SSE_KMS).check(ACTION);
      await f.kmsKey.fill(key, ACTION);
      await f.bucketKey('Disable').check(ACTION);
      await f.create.click(ACTION);
      await expectList(page);
      ended.set(full, await flashOnArrival(page));
      const props = await bucketPropertiesDirect(ctx, port, full);
      ctx.log(`direct properties of ${full}: ${JSON.stringify(props)}`);
      expect(props.ownership, 'ownership').toBe('ObjectWriter');
      expect(props.publicAccessBlock, 'the public access settings').toEqual({
        BlockPublicAcls: false,
        IgnorePublicAcls: false,
        BlockPublicPolicy: true,
        RestrictPublicBuckets: true,
      });
      expect(props.versioning, 'the versioning status').toBe('Enabled');
      expect([...(props.tags ?? [])].sort(), 'the tags').toEqual([
        ['empty', ''],
        ['env', 'test'],
      ]);
      expect(props.encryption?.algorithm, 'the default encryption').toBe('aws:kms');
      expect(props.encryption?.keyId, 'the KMS key').toBe(key);
      expect(props.encryption?.bucketKey ?? false, 'the bucket key').toBe(false);
    },
  );

  await lines.line(
    'Create `<p>-lock` with Object Lock "Enable" and DSSE-KMS with the same key → directly: Object Lock enabled, versioning `Enabled`, `aws:kms:dsse` with that key',
    async () => {
      await openForm(page);
      await f.name.fill(lock, ACTION);
      await f.objectLock('Enable').check(ACTION);
      await f.encryption(DSSE_KMS).check(ACTION);
      await f.kmsKey.fill(key, ACTION);
      await f.create.click(ACTION);
      await expectList(page);
      ended.set(lock, await flashOnArrival(page));
      const props = await bucketPropertiesDirect(ctx, port, lock);
      ctx.log(`direct properties of ${lock}: ${JSON.stringify(props)}`);
      expect(props.objectLock?.enabled, 'Object Lock').toBe('Enabled');
      expect(props.versioning, 'the versioning status').toBe('Enabled');
      expect(props.encryption?.algorithm, 'the default encryption').toBe('aws:kms:dsse');
      expect(props.encryption?.keyId, 'the KMS key').toBe(key);
    },
  );

  await lines.line('Each ends on the list with the success item alone', async () => {
    for (const name of [full, lock]) {
      expect(
        ended.get(name) ?? '(the form did not end on the list)',
        `the flash on the list after creating ${name}`,
      ).toEqual([createdItem(name)]);
    }
  });

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-create-bucket-refusals-create-nothing', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'create-refuse');
  const seeded = new Seeded(ctx, port);
  const record = EngineRecord.attach(ctx, context, stack.engine.url);
  const f = form(page);

  /** "Create bucket" on the form as filled, and the form stays. */
  async function submit(): Promise<void> {
    await f.create.click(ACTION);
    await expectFormStays(page);
  }

  const names: [string, string][] = [
    ['', MESSAGES.emptyName],
    ['AB', MESSAGES.length],
    ['my_bucket', MESSAGES.characters],
    ['-abc', MESSAGES.ends],
    ['a..b', MESSAGES.periods],
    ['192.168.0.1', MESSAGES.ip],
    [`xn--${p}`, MESSAGES.begins('xn--')],
    [`${p}--x-s3`, MESSAGES.endsWith('--x-s3')],
  ];
  for (const [name] of names) if (name.startsWith(p) || name.endsWith(p)) seeded.track(name);

  await lines.line(
    '"Create bucket" with an empty name, `AB`, `my_bucket`, `-abc`, `a..b`, `192.168.0.1`, `xn--<p>`, `<p>--x-s3` in turn → each shows its message of R6.3 under "Bucket name" and the form stays; a direct `ListBuckets` under `<p>` returns none',
    async () => {
      await openForm(page);
      for (const [name, message] of names) {
        await f.name.fill(name, ACTION);
        await submit();
        await expectFieldMessage(f.name, message, `"Bucket name" with ${JSON.stringify(name)}`);
      }
      expect(await bucketNamesDirect(ctx, port, p), 'a direct ListBuckets under <p>').toEqual([]);
      expect(record.of('CreateBucket'), 'CreateBucket requests the page sent').toEqual([]);
    },
  );

  await lines.line(
    'A tag with an empty key, a key `aws:x`, the same key twice; SSE-KMS without a key → each shows its message and no bucket is made',
    async () => {
      const name = `${p}-tags`;
      seeded.track(name);
      /** No bucket of `name` in the emulator and no `CreateBucket` from the page, after `what`. */
      const nothingMade = async (what: string) => {
        expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets of ${name} after ${what}`).toEqual([]);
        expect(record.of('CreateBucket'), `CreateBucket requests after ${what}`).toEqual([]);
      };
      await openForm(page);
      await f.name.fill(name, ACTION);
      await f.addTag.click(ACTION);
      await submit();
      await expectFieldMessage(f.key(0), MESSAGES.emptyKey, 'a tag with an empty key');
      await nothingMade('an empty key');
      await f.key(0).fill('aws:x', ACTION);
      await submit();
      await expectFieldMessage(f.key(0), MESSAGES.awsKey, 'the key aws:x');
      await nothingMade('the key aws:x');
      await f.key(0).fill('env', ACTION);
      await f.addTag.click(ACTION);
      await f.key(1).fill('env', ACTION);
      await submit();
      await expectFieldMessage(f.key(1), MESSAGES.usedKey, 'the second tag with the key env');
      await nothingMade('the same key twice');
      await openForm(page);
      await f.name.fill(name, ACTION);
      await f.encryption(SSE_KMS).check(ACTION);
      await submit();
      await expectFieldMessage(f.kmsKey, MESSAGES.emptyKms, 'SSE-KMS without a key');
      await nothingMade('SSE-KMS without a key');
    },
  );

  await lines.line(
    'With `<p>-taken` made directly, holding an object and a tag, create `<p>-taken` with versioning "Enable" → "The emulator already holds a bucket named “<p>-taken”." under the field; directly, the bucket still holds its object and tag and has no versioning status',
    async () => {
      const taken = `${p}-taken`;
      await seeded.bucket(taken);
      await seeded.object(taken, 'kept.txt', 'kept');
      await seeded.configure(taken, { tags: [['keep', 'yes']] });
      await openForm(page);
      await f.name.fill(taken, ACTION);
      await f.versioning('Enable').check(ACTION);
      await submit();
      await expectFieldMessage(f.name, MESSAGES.taken(taken), `"Bucket name" with ${taken}`);
      record.log();
      expect(record.of('CreateBucket', taken), `CreateBucket of ${taken}`).toEqual([]);
      expect(await objectKeysDirect(ctx, port, taken), `the objects of ${taken}`).toEqual(['kept.txt']);
      const props = await bucketPropertiesDirect(ctx, port, taken);
      expect(props.tags, `the tags of ${taken}`).toEqual([['keep', 'yes']]);
      expect(props.versioning, `the versioning status of ${taken}`).toBeNull();
    },
  );

  lines.end();
});

// ---------------------------------------------------------------------------------------------------------------

test('studio.s3-create-bucket-repeated-and-abandoned', async ({ ctx, page, context }) => {
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'create-repeat');
  const seeded = new Seeded(ctx, port);
  const record = EngineRecord.attach(ctx, context, stack.engine.url);
  const f = form(page);

  /** Fills the form with `name` and a few settings changed. */
  async function fill(name: string): Promise<void> {
    await f.name.fill(name, ACTION);
    await f.ownership('Object writer').check(ACTION);
    await f.block('BlockPublicPolicy').uncheck(ACTION);
    await f.versioning('Enable').check(ACTION);
    await f.addTag.click(ACTION);
    await f.key(0).fill('env', ACTION);
    await f.encryption(SSE_KMS).check(ACTION);
    await f.kmsKey.fill('arn:aws:kms:us-east-1:000000000000:key/check', ACTION);
  }

  /** Waits until the form shows what it shows at start. */
  async function expectAtStart(what: string): Promise<void> {
    await expect(f.h1, `the form's h1 "${CREATE_H1}"`).toBeVisible();
    await expect.poll(() => formState(page), { message: `the form ${what}` }).toEqual(FORM_AT_START);
  }

  await lines.line(
    'Double click "Create bucket" on a valid form → one `CreateBucket` leaves the page, and the list shows one success item',
    async () => {
      const name = `${p}-double`;
      seeded.track(name);
      await openForm(page);
      await f.name.fill(name, ACTION);
      await f.create.dblclick(ACTION);
      await expectList(page);
      await expectSuccessAlone(page, name);
      record.log();
      expect(record.of('CreateBucket', name).length, `CreateBucket requests of ${name}`).toBe(1);
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets of ${name}`).toEqual([name]);
    },
  );

  // Issue 467 (requirement R9, rule 5) replaced the line 'Fill the form, choose "Cancel" → the list, and no bucket of
  // that name exists; "Create bucket" again → the form as at start' with the three lines below: "Cancel" asks once the
  // form holds something.
  const d = discardDialog(page);
  const cancelled = `${p}-cancel`;
  seeded.track(cancelled);

  /** The form's values as shown, with the texts typed into it. */
  async function filledState(): Promise<FormState & { tagKey: string | null; kmsKey: string | null }> {
    return {
      ...(await formState(page)),
      tagKey: (await f.keys.count()) > 0 ? await f.key(0).inputValue(ACTION) : null,
      kmsKey: (await f.kmsKey.count()) > 0 ? await f.kmsKey.inputValue(ACTION) : null,
    };
  }

  await lines.line('Open the form, "Cancel" → the list at once, no dialog', async () => {
    await openForm(page);
    await watchText(page, DISCARD_HEADING);
    await f.cancel.click(ACTION);
    await expectList(page);
    expect(await appeared(page, DISCARD_HEADING), `"${DISCARD_HEADING}" was shown`).toBe(false);
  });

  await lines.line(
    'Fill the form, "Cancel" → the dialog; "Keep editing" → the form with every value, focus on "Cancel"',
    async () => {
      await openForm(page);
      await fill(cancelled);
      const filled = await filledState();
      ctx.log(`the form filled: ${JSON.stringify(filled)}`);
      await f.cancel.click(ACTION);
      await expect(d.dialog, `the dialog "${DISCARD_HEADING}"`).toBeVisible();
      await expect(page, 'the form stays while the dialog is open').toHaveURL(addressOf(CREATE_PATH));
      await d.keepEditing.click(ACTION);
      await expect(d.dialog, `"${KEEP_EDITING}" closes the dialog`).toHaveCount(0);
      await expectFormStays(page);
      await expect.poll(() => filledState(), { message: `the form after "${KEEP_EDITING}"` }).toEqual(filled);
      await expect(f.cancel, `focus on "Cancel" after "${KEEP_EDITING}"`).toBeFocused();
    },
  );

  await lines.line(
    '"Cancel", "Discard" → the list, and a direct `ListBuckets` holds no bucket of that name; "Create bucket" again → the form as at start',
    async () => {
      // The Given: the form holds what was entered, whether or not the line before held.
      const holds =
        new URL(page.url()).pathname === CREATE_PATH && (await f.name.inputValue(ACTION).catch(() => '')) === cancelled;
      if (!holds) {
        await openForm(page);
        await fill(cancelled);
      }
      await f.cancel.click(ACTION);
      await expect(d.dialog, `the dialog "${DISCARD_HEADING}"`).toBeVisible();
      await d.discard.click(ACTION);
      await expect(d.dialog, `"${DISCARD}" closes the dialog`).toHaveCount(0);
      await expectList(page);
      expect(await bucketNamesDirect(ctx, port, cancelled), `a direct ListBuckets of ${cancelled}`).toEqual([]);
      expect(record.of('CreateBucket', cancelled), `CreateBucket requests of ${cancelled}`).toEqual([]);
      await screen(page).action(CREATE).click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_PATH));
      await expectAtStart('opened again after "Discard"');
    },
  );

  await lines.line(
    'Fill the form, open the list through the crumb "Buckets", go back in the browser → the form as at start, and nothing was created',
    async () => {
      const name = `${p}-left`;
      seeded.track(name);
      await openForm(page);
      await fill(name);
      await crumbLink(page, 'Buckets').click(ACTION);
      await expectList(page);
      await page.goBack();
      await expect(page).toHaveURL(addressOf(CREATE_PATH));
      await expectAtStart('after going back to it');
      expect(await bucketNamesDirect(ctx, port, name), `a direct ListBuckets of ${name}`).toEqual([]);
      expect(record.of('CreateBucket', name), `CreateBucket requests of ${name}`).toEqual([]);
    },
  );

  lines.end();
});
