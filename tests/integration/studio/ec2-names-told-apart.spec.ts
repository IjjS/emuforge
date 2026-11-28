// Key pairs and security groups whose names differ only by a repeated space, in the built app in front of a real
// engine and emulator (test-criteria.md, issue 664).
//
// `studio.ec2-names-that-differ-by-spaces-are-told-apart`.
//
// The check makes, under its prefix `<p>`, the key pairs `<p> a b` and `<p> a  b` (two spaces) and, in a VPC of its
// own, the security groups of those two names; everything is removed when the check ends (`Ec2Seeded`), the instance
// it launches included. The exact identity of the two-space name is `<p> a`, a backslash and `u0020` twice, `b`
// (`twoSpaceIdentity`). What the emulator holds is read directly. Words, direct calls and readers:
// `services/ec2/ec2.ts`.

import type { Locator } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf } from './support/frame';
import { Lines } from './support/lines';
import { checkPrefix, drawnText, headerHeading, rowReading, twoSpaceIdentity } from './support/service-screens';
import {
  button,
  chooseOption,
  Ec2Seeded,
  expectValueIs,
  field,
  findBy,
  groupPath,
  GROUPS_H1,
  GROUPS_PATH,
  instanceDirect,
  instancePath,
  KEY_PAIRS_H1,
  KEY_PAIRS_PATH,
  LAUNCH,
  LAUNCH_PATH,
  multiselectOf,
  open,
  openSelect,
  optionLabel,
  rowsOf,
  selectOf,
  TABLE,
  tableOf,
  typeInMultiselect,
  valueElement,
  world,
} from './services/ec2/ec2';

/** In the Security groups table of an instance's page: the column of the group's ID (1 the first). */
const GROUP_ID_COLUMN = 2;

test('studio.ec2-names-that-differ-by-spaces-are-told-apart', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const lines = new Lines(ctx);
  const p = checkPrefix(ctx, 'ec2names');
  const one = `${p} a b`;
  const two = `${p} a  b`;
  const identity = twoSpaceIdentity(p);
  const w = await world(ctx, port);
  const seeded = new Ec2Seeded(ctx, port, p, w);
  await seeded.keyPair(one);
  await seeded.keyPair(two);
  const own = await seeded.vpcWithSubnet('10.164.0.0/16', '10.164.1.0/24', 'us-east-1a');
  const groupOne = await seeded.group(one, `one space ${p}`, own.vpcId);
  const groupTwo = await seeded.group(two, `two spaces ${p}`, own.vpcId);
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();
  const control = (row: Locator, name: string) => row.getByRole('radio', { name, exact: true });
  const link = (row: Locator, name: string) => row.getByRole('link', { name, exact: true });
  // On Key pairs and on Security groups column 1 is the selection control's, column 2 the name. A row is found by
  // the name it reads; its link and its selection control are that row's.
  /** Narrows the list to the check's two rows and waits until it holds those alone. */
  const narrowed = async () => {
    await findBy(table, p);
    await expect.poll(async () => (await rowsOf(table)).length, { message: "the check's two rows, alone", timeout: 15_000 }).toBe(2);
  };
  const rowOfOne = async () => (await rowReading(table, 2, one)).row;
  const rowOfTwo = async () => (await rowReading(table, 2, `${two} (${identity})`)).row;
  let launched = '';

  await lines.line(
    'Open Key pairs → selection controls of both names, the two-space one named by its identity; the row of the two-space key pair reads the name with its two spaces, followed by the identity in brackets',
    async () => {
      await open(page, KEY_PAIRS_PATH, KEY_PAIRS_H1);
      await narrowed();
      await expect(control(await rowOfTwo(), identity), `the two-space row's control, named "${identity}"`).toHaveCount(1);
      await expect(control(await rowOfOne(), one), `the one-space row's control, named "${one}"`).toHaveCount(1);
    },
  );

  await lines.line(
    "Open Security groups → links and selection controls of both names, and the row of the two-space group reads the name with its two spaces, followed by the identity in brackets; follow the link named by the identity → the heading is named by the identity and the group ID shown is the two-space group's",
    async () => {
      await open(page, GROUPS_PATH, GROUPS_H1);
      await narrowed();
      const rowTwo = await rowOfTwo();
      await expect(link(rowTwo, identity), `the two-space row's link, named "${identity}"`).toHaveCount(1);
      await expect(control(rowTwo, identity), `the two-space row's control, named "${identity}"`).toHaveCount(1);
      const rowOne = await rowOfOne();
      await expect(link(rowOne, one), `the one-space row's link, named "${one}"`).toHaveCount(1);
      await expect(control(rowOne, one), `the one-space row's control, named "${one}"`).toHaveCount(1);
      await link(rowTwo, identity).click(ACTION);
      await expect(page, "the two-space group's address").toHaveURL(addressOf(groupPath(groupTwo)));
      await expect(headerHeading(page), "the heading's accessible name").toHaveAccessibleName(identity, {
        timeout: 15_000,
      });
      await expectValueIs(page, 'Group ID', groupTwo);
      expect(groupTwo, 'the two groups have different IDs').not.toBe(groupOne);
    },
  );

  await lines.line(
    'On Launch an instance open "Key pair" → the option of the two-space value is labelled by its identity; choose it, choose the VPC\'s subnet and, in "Security groups", the option of the two-space group\'s ID, labelled by the identity; launch → the emulator\'s instance has the two-space key pair\'s name and the two-space group\'s ID',
    async () => {
      const keyPair = field(main, 'Key pair - optional');
      const groups = field(main, 'Security groups - optional');
      await open(page, LAUNCH_PATH, LAUNCH);
      await field(main, 'Name - optional').getByRole('textbox').fill(`${p}-inst`, ACTION);
      // A part of the image's name, never the whole of it.
      await chooseOption(field(main, 'Image'), w.image.id, w.image.name.slice(1, -1));
      await chooseOption(field(main, 'Instance type'), w.type, 't3.mic');
      const option = await openSelect(keyPair, two);
      expect(await drawnText(optionLabel(keyPair, two)), 'the label of the option of the two-space key pair').toBe(
        identity,
      );
      await option.click(ACTION);
      expect(await drawnText(selectOf(keyPair)), 'what the closed "Key pair" shows').toBe(identity);
      await chooseOption(field(main, 'Subnet - optional'), own.subnetId);
      const m = multiselectOf(groups);
      await typeInMultiselect(groups, two);
      await expect(m.option(groupTwo), "the option of the two-space group's ID").toBeVisible({ timeout: 20_000 });
      expect(await drawnText(optionLabel(groups, groupTwo)), 'the label of the option of the two-space group').toBe(
        identity,
      );
      await m.option(groupTwo).click(ACTION);
      await expect(m.tokens, 'the chosen groups').toHaveCount(1, { timeout: 10_000 });
      await page.keyboard.press('Escape');
      await expect(m.list, 'the list after Escape').toHaveCount(0);
      await button(main, LAUNCH).click(ACTION);
      await expect(page).toHaveURL(/\/aws\/ec2\/instances\/instance\/i-[0-9a-f]+$/, { timeout: 30_000 });
      launched = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
      const reported = await instanceDirect(ctx, port, launched);
      expect(
        { key: reported?.keyName, groups: reported?.groups.map((each) => each.id) },
        'the instance, directly',
      ).toEqual({ key: two, groups: [groupTwo] });
    },
  );

  await lines.line(
    "Open that instance's page → the key pair's link is named by the identity and the Security groups table has a link named by the identity that leads to the two-space group's page",
    async () => {
      expect(launched, 'the instance of the line before').not.toBe('');
      await page.goto(instancePath(launched));
      const here = (path: string) => new URL(path, page.url()).href;
      // The group's link is the one in the row of the Security groups table that reads the two-space group's ID.
      const groupRow = (await rowReading(tableOf(main, 'Security groups'), GROUP_ID_COLUMN, groupTwo)).row;
      const groupLink = groupRow.getByRole('link', { name: identity, exact: true });
      await expect(groupLink, "the link named by the identity in the two-space group's row").toHaveCount(1);
      expect(here((await groupLink.getAttribute('href')) ?? ''), "where the group's link leads").toBe(
        here(groupPath(groupTwo)),
      );
      // The key pair's link is the one in the value of "Key pair".
      const keyLink = valueElement(main, 'Key pair').getByRole('link', { name: identity, exact: true });
      await expect(keyLink, 'the link named by the identity in the value of "Key pair"').toHaveCount(1);
      expect(here((await keyLink.getAttribute('href')) ?? ''), "where the key pair's link leads").toBe(
        here(KEY_PAIRS_PATH),
      );
    },
  );

  lines.end();
});
