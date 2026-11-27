// REST APIs whose names differ only by a repeated space, in the built app in front of a real engine and emulator
// (test-criteria.md, issue 664).
//
// `studio.apigateway-api-names-that-differ-by-spaces-are-told-apart`.
//
// The check makes two REST APIs named `<p> a b` and `<p> a  b` (two spaces) under its prefix `<p>`, the second with
// the description `<p> x  y` (two spaces); every API under the prefix is deleted when the check ends (`fixture`). The
// exact identity of the two-space name is `<p> a`, a backslash and `u0020` twice, `b` (`twoSpaceIdentity`). What the
// emulator holds is read directly. Words, direct calls and readers: `services/apigateway/apigateway.ts`.

import { expect, test } from './support';
import { Lines } from './support/lines';
import { cellOfRowWith, drawnText, headerHeading, modalDialog, twoSpaceIdentity } from './support/service-screens';
import {
  APIS,
  apisRead,
  at,
  button,
  choiceParts,
  containerOf,
  dialog,
  dialogContent,
  dialogFooter,
  entryOf,
  fixture,
  pageHeading,
  pairValue,
  restApiPath,
} from './services/apigateway/apigateway';

test('studio.apigateway-api-names-that-differ-by-spaces-are-told-apart', async ({ ctx, page }) => {
  const f = await fixture(ctx);
  const lines = new Lines(ctx);
  const p = f.prefix;
  const one = `${p} a b`;
  const two = `${p} a  b`;
  const identity = twoSpaceIdentity(p);
  const idOne = (await f.rest.createRestApi({ name: one })).id!;
  const idTwo = (await f.rest.createRestApi({ name: two, description: `${p} x  y` })).id!;
  const link = (name: string) => page.getByRole('link', { name, exact: true });
  const control = (name: string) => page.getByRole('radio', { name: `Select ${name} (REST)`, exact: true });
  /** Opens APIs and waits for the two-space API's row. */
  const listed = async () => {
    await page.goto(APIS);
    const list = (await apisRead(page)).first();
    await expect(list.locator(link(identity)), `the link named "${identity}"`).toHaveCount(1, { timeout: 15_000 });
    return list;
  };
  /** Opens the page that asks which REST API to open, and its choice, with the options of both APIs offered. */
  const asked = async () => {
    await page.goto(entryOf('Resources').path);
    await expect(pageHeading(page), 'the h1 "Resources"').toHaveText('Resources');
    const choice = choiceParts(page);
    await choice.trigger.click();
    await expect(choice.option(idOne), "the option of the one-space API's ID").toBeVisible({ timeout: 20_000 });
    await expect(choice.option(idTwo), "the option of the two-space API's ID").toBeVisible({ timeout: 20_000 });
    return choice;
  };
  /** The ID the REST API's page shows. */
  const shownId = () => pairValue(containerOf(page, 'Details'), 'ID');

  await lines.line(
    'Open APIs → links and selection controls of both names, the two-space ones named by the identity; the row of the second reads the name with its two spaces, followed by the identity in brackets; its description reads with one space, as on `main`',
    async () => {
      const list = await listed();
      await expect(list.locator(link(one)), `the link named "${one}"`).toHaveCount(1);
      await expect(list.locator(control(one)), `the selection control "Select ${one} (REST)"`).toHaveCount(1);
      await expect(list.locator(control(identity)), `the selection control "Select ${identity} (REST)"`).toHaveCount(1);
      // Column 1 is the selection control's; then Name, ID, Kind, Description.
      expect(await drawnText(await cellOfRowWith(list, link(identity), 2)), "the second API's name as drawn").toBe(
        `${two} (${identity})`,
      );
      expect(await drawnText(await cellOfRowWith(list, link(identity), 5)), "the second API's description as drawn").toBe(
        `${p} x y`,
      );
    },
  );

  await lines.line(
    "Follow the link named by the identity → the page's heading is named by the identity and the API ID shown is the two-space API's",
    async () => {
      const list = await listed();
      await list.locator(link(identity)).click();
      await expect(page, "the two-space API's address").toHaveURL(at(restApiPath(idTwo)));
      await expect(headerHeading(page), "the heading's accessible name").toHaveAccessibleName(identity, {
        timeout: 15_000,
      });
      await expect.poll(shownId, { message: 'the API ID shown', timeout: 15_000 }).toContain(idTwo);
    },
  );

  await lines.line(
    "On the page that asks which REST API to open, open the choice → the options of both APIs' IDs are offered; type the two-space name into its filter → the option of the one-space API's ID is no longer offered, and the option of the two-space API's ID is, showing only the identity and that ID",
    async () => {
      const choice = await asked();
      await choice.filter.fill(two);
      await expect(choice.option(idOne), "the option of the one-space API's ID, after the filter").toHaveCount(0);
      await expect(choice.option(idTwo), "the option of the two-space API's ID, after the filter").toBeVisible();
      expect(await drawnText(choice.label(idTwo)), "the label of the option left").toBe(identity);
      const whole = await drawnText(choice.option(idTwo));
      expect(whole.replace(identity, '').trim(), `what the option shows beside its label, of "${whole}"`).toBe(idTwo);
    },
  );

  await lines.line(
    "Clear the filter → the options of both IDs are offered again; type the two-space API's ID → the option of the one-space API's ID is no longer offered, and the option of the two-space API's ID is, labelled by the identity; choose it → the closed field shows the identity; press Open → the page opened is the two-space API's, by the ID in its address and the API ID it shows",
    async () => {
      const choice = await asked();
      await choice.filter.fill(two);
      await expect(choice.option(idOne), "the option of the one-space API's ID, after the name").toHaveCount(0);
      await choice.filter.fill('');
      await expect(choice.option(idOne), "the option of the one-space API's ID, the filter cleared").toBeVisible();
      await expect(choice.option(idTwo), "the option of the two-space API's ID, the filter cleared").toBeVisible();
      await choice.filter.fill(idTwo);
      await expect(choice.option(idOne), "the option of the one-space API's ID, after the ID").toHaveCount(0);
      await expect(choice.option(idTwo), "the option of the two-space API's ID, after the ID").toBeVisible();
      expect(await drawnText(choice.label(idTwo)), 'the label of the option left').toBe(identity);
      await choice.option(idTwo).click();
      await expect(choice.option(idTwo), 'the list after the choice').toHaveCount(0);
      expect(await drawnText(choice.trigger), 'what the closed field shows').toContain(identity);
      await button(page, 'Open').click();
      await expect(page, "the two-space API's address").toHaveURL(at(`${restApiPath(idTwo)}?show=resources`));
      await expect.poll(shownId, { message: 'the API ID shown', timeout: 15_000 }).toContain(idTwo);
    },
  );

  await lines.line(
    'On APIs select the two-space API and choose to delete it → the dialog is named "Delete API <identity>?"; type the name with its two spaces and confirm → the emulator holds the one-space API and not the two-space one',
    async () => {
      const list = await listed();
      await list.locator(control(identity)).check();
      await button(page, 'Delete').click();
      await expect(modalDialog(page), "the dialog's accessible name").toHaveAccessibleName(`Delete API ${identity}?`);
      await dialogContent(page).getByRole('textbox').fill(two);
      await button(dialogFooter(page), 'Delete').click();
      await expect(dialog(page), 'the dialog after the delete').toBeHidden();
      await expect(f.rest.getRestApi({ restApiId: idTwo }), 'the two-space API, directly').rejects.toMatchObject({
        name: 'NotFoundException',
      });
      expect((await f.rest.getRestApi({ restApiId: idOne })).name, 'the one-space API, directly').toBe(one);
    },
  );

  lines.end();
});
