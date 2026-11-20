// EC2's key pairs: the list S8 and the create and import form S9, in the built app in front of a real engine and
// emulator (test-criteria.md, issue 553: task 5).
//
// `studio.ec2-key-pair-create-import-delete`.
//
// The check names its key pairs and its instance with its own prefix `<p>` and removes them when it ends
// (`Ec2Seeded`). The private key the emulator returns is read from the page only to compare it with the saved file;
// it is never logged. Words, direct calls and readers: `services/ec2/ec2.ts`.

import { readFile } from 'node:fs/promises';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  button,
  cancelDialog,
  confirmWith,
  countActions,
  CREATE_KEY_PAIR,
  CREATE_KEY_PAIR_PATH,
  DELETE,
  dialogOf,
  Ec2Seeded,
  errorOf,
  expectFlash,
  expectRows,
  field,
  findBy,
  IMPORT_KEY_PAIR,
  instanceDirect,
  KEY_NAME_ASCII,
  KEY_PAIRS_H1,
  KEY_PAIRS_PATH,
  keyPairDirect,
  keyPairsDirect,
  open,
  openSshPublicKey,
  radio,
  selectRow,
  TABLE,
  tile,
  valueOf,
  VIEW_KEY_PAIRS,
  world,
} from './services/ec2/ec2';

test('studio.ec2-key-pair-create-import-delete', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2keys');
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  const name = `${p}-ed`;
  const imported = `${p}-imp`;
  const bad = `${p}-bad`;
  const publicKey = openSshPublicKey(`${p}@checks`);
  for (const each of [name, imported, bad]) {
    expect(await keyPairDirect(ctx, port, each), `no key pair ${each} before`).toBeNull();
  }
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  const keyName = () => field(main, 'Name').getByRole('textbox');
  const privateKey = () => main.getByRole('textbox', { name: 'Private key', exact: true });
  let fingerprint = '';
  let created = false;

  await lines.line(
    'S8, "Create key pair" → S9; the name `<prefix>-ed`, "ED25519", ".pem", "Create key pair" → the page stays and shows "Key pair <prefix>-ed created", a private key, a fingerprint and "View key pairs"; the form is gone',
    async () => {
      await open(page, KEY_PAIRS_PATH, KEY_PAIRS_H1);
      await main.getByRole('link', { name: CREATE_KEY_PAIR, exact: true }).first().click(ACTION);
      await expect(page).toHaveURL(addressOf(CREATE_KEY_PAIR_PATH));
      await expect(heading(page, CREATE_KEY_PAIR)).toBeVisible();
      await keyName().fill(name, ACTION);
      await radio(field(main, 'Type'), 'ed25519').click(ACTION);
      await radio(field(main, 'Private key format'), 'pem').click(ACTION);
      await button(main, CREATE_KEY_PAIR).click(ACTION);
      await expect(main.getByText(`Key pair ${name} created`, { exact: true })).toBeVisible({ timeout: 20_000 });
      created = true;
      await expect(page).toHaveURL(addressOf(CREATE_KEY_PAIR_PATH));
      await expect(privateKey(), 'the private key').toHaveValue(/PRIVATE KEY/);
      fingerprint = (await valueOf(main, 'Fingerprint')) ?? '';
      expect(fingerprint, 'the fingerprint shown').not.toBe('');
      await expect(main.getByRole('link', { name: VIEW_KEY_PAIRS, exact: true })).toBeVisible();
      await expect(field(main, 'Name'), 'the form after the create').toHaveCount(0);
      await expect(button(main, CREATE_KEY_PAIR), 'the submit after the create').toHaveCount(0);
    },
  );

  await lines.line(
    'The emulator reports the key pair with that name, the type `ed25519` and the fingerprint the page shows, and its answer (`DescribeKeyPairs`) holds no private key',
    async () => {
      expect(created, 'the key pair of the first line').toBe(true);
      const { pairs, body } = await keyPairsDirect(ctx, port);
      const reported = pairs.find((each) => each.name === name);
      expect([reported?.name, reported?.type], 'the key pair, directly').toEqual([name, 'ed25519']);
      expect(reported!.fingerprint, "the emulator's fingerprint").not.toBe('');
      expect(fingerprint, 'the fingerprint shown').toBe(reported!.fingerprint);
      expect(body.includes('PRIVATE KEY'), 'a private key in the answer of DescribeKeyPairs').toBe(false);
      expect(/keyMaterial/i.test(body), 'key material in the answer of DescribeKeyPairs').toBe(false);
    },
  );

  await lines.line(
    '"Save as <prefix>-ed.pem" → a file of that name is saved whose text is the private key the page shows; no request left the page for it',
    async () => {
      expect(created, 'the key pair of the first line').toBe(true);
      const shown = await privateKey().inputValue();
      let requests = 0;
      const count = (request: { url(): string }) => {
        if (!request.url().startsWith('blob:')) requests++;
      };
      page.on('request', count);
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 20_000 }),
        button(main, `Save as ${name}.pem`).click(ACTION),
      ]);
      expect(download.suggestedFilename(), "the file's name").toBe(`${name}.pem`);
      const saved = await readFile(await download.path(), 'utf8');
      page.off('request', count);
      expect(saved === shown, 'the saved text is the private key the page shows').toBe(true);
      expect(requests, 'requests the page sent for the save').toBe(0);
    },
  );

  await lines.line(
    '"View key pairs" → S8; "Find by name" `<prefix>-ed` → its row with the name, the type, the fingerprint and the key pair ID as the emulator reports them; the page holds no private key, and S9 opened again shows the empty form',
    async () => {
      expect(created, 'the key pair of the first line').toBe(true);
      await main.getByRole('link', { name: VIEW_KEY_PAIRS, exact: true }).click(ACTION);
      await expect(page).toHaveURL(addressOf(KEY_PAIRS_PATH));
      await expect(heading(page, KEY_PAIRS_H1)).toBeVisible();
      await findBy(table, name);
      const rows = await expectRows(table, 'Name', [name], "the key pair's row");
      const reported = (await keyPairDirect(ctx, port, name))!;
      expect(
        [rows[0]?.Name, rows[0]?.Type, rows[0]?.Fingerprint, rows[0]?.['Key pair ID']],
        "the key pair's row",
      ).toEqual([reported.name, reported.type, reported.fingerprint, reported.id]);
      await expect(page.locator('body'), 'a private key on S8').not.toContainText('PRIVATE KEY');
      await open(page, CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR);
      await expect(keyName(), 'the name of the form opened again').toHaveValue('');
      await expect(privateKey(), 'a private key on S9 opened again').toHaveCount(0);
      await expect(page.locator('body'), 'a private key on S9 opened again').not.toContainText('PRIVATE KEY');
    },
  );

  await lines.line(
    'S9, the name `<prefix>-ed` again → the form stays with the emulator\'s `InvalidKeyPair.Duplicate`',
    async () => {
      expect(created, 'the key pair of the first line').toBe(true);
      await open(page, CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR);
      await keyName().fill(name, ACTION);
      await button(main, CREATE_KEY_PAIR).click(ACTION);
      await expect(alertWith(main, 'InvalidKeyPair.Duplicate'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(page).toHaveURL(addressOf(CREATE_KEY_PAIR_PATH));
      await expect(keyName(), 'the name as typed').toHaveValue(name);
    },
  );

  await lines.line(
    'S9, the name `<prefix>-é` → "A name can hold ASCII characters only." at the field; no request to create left the page',
    async () => {
      await open(page, CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR);
      const creates = countActions(page, 'CreateKeyPair');
      await keyName().fill(`${p}-é`, ACTION);
      await button(main, CREATE_KEY_PAIR).click(ACTION);
      await expect(errorOf(field(main, 'Name')), `"${KEY_NAME_ASCII}"`).toHaveText(KEY_NAME_ASCII);
      await expect(page).toHaveURL(addressOf(CREATE_KEY_PAIR_PATH));
      expect(creates.count(), 'requests to create').toBe(0);
    },
  );

  await lines.line(
    'S9, "Import a public key", the name `<prefix>-imp`, the public key, "Import key pair" → S8 with "Imported key pair <prefix>-imp"; the emulator reports the key pair',
    async () => {
      await open(page, CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR);
      await tile(main, 'import').click(ACTION);
      await keyName().fill(imported, ACTION);
      await field(main, 'Public key').getByRole('textbox').fill(publicKey, ACTION);
      await button(main, IMPORT_KEY_PAIR).click(ACTION);
      await expect(page).toHaveURL(addressOf(KEY_PAIRS_PATH), { timeout: 30_000 });
      await expectFlash(page, 'success', `Imported key pair ${imported}`);
      expect((await keyPairDirect(ctx, port, imported))?.name, 'the imported key pair, directly').toBe(imported);
    },
  );

  await lines.line(
    'S9, "Import a public key", the name `<prefix>-bad`, the text `not a key` → the form stays with the emulator\'s `InvalidKeyPair.Format`; the emulator reports no key pair of that name',
    async () => {
      await open(page, CREATE_KEY_PAIR_PATH, CREATE_KEY_PAIR);
      await tile(main, 'import').click(ACTION);
      await keyName().fill(bad, ACTION);
      await field(main, 'Public key').getByRole('textbox').fill('not a key', ACTION);
      await button(main, IMPORT_KEY_PAIR).click(ACTION);
      await expect(alertWith(main, 'InvalidKeyPair.Format'), 'the refusal in the form').toBeVisible({
        timeout: 20_000,
      });
      await expect(page).toHaveURL(addressOf(CREATE_KEY_PAIR_PATH));
      expect(await keyPairDirect(ctx, port, bad), 'a key pair of that name, directly').toBeNull();
    },
  );

  await lines.line(
    'An instance made directly with the key pair `<prefix>-ed`; S8, select it, "Delete" → "Delete key pair?" naming it; "Cancel" → the emulator still reports it; "Delete", type `delete`, "Delete" → "Deleted key pair <prefix>-ed" and the row is gone; the emulator reports no such key pair, and the instance still with that key name',
    async () => {
      expect(created, 'the key pair of the first line').toBe(true);
      const instance = await seeded.instance({ name: `${p}-user`, keyName: name });
      await open(page, KEY_PAIRS_PATH, KEY_PAIRS_H1);
      await findBy(table, name);
      await expectRows(table, 'Name', [name], "the key pair's row");
      await selectRow(table, 'Name', name);
      await button(main, DELETE).click(ACTION);
      const dialog = dialogOf(page);
      await expect(dialog, 'the dialog').toContainText('Delete key pair?');
      await expect(dialog, 'the dialog names the key pair').toContainText(name);
      await cancelDialog(page);
      expect((await keyPairDirect(ctx, port, name))?.name, 'the key pair after "Cancel", directly').toBe(name);
      await button(main, DELETE).click(ACTION);
      await confirmWith(page, 'delete', DELETE);
      await expectFlash(page, 'success', `Deleted key pair ${name}`);
      await expectRows(table, 'Name', [], 'no row after the delete');
      expect(await keyPairDirect(ctx, port, name), 'the key pair, directly').toBeNull();
      expect((await instanceDirect(ctx, port, instance))?.keyName, "the instance's key name, directly").toBe(name);
    },
  );

  lines.end();
});
