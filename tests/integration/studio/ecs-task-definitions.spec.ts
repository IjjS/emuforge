// ECS's task definitions: the families S7, a family S8, a revision S9 and the register form S10, in the built app in
// front of a real engine and emulator (test-criteria.md, issue 575: task 4).
//
// `studio.ecs-definition-made-outside-is-listed-and-shown`, `studio.ecs-register-new-revision-from-a-revision`,
// `studio.ecs-register-shows-the-emulators-refusal`.
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EcsSeeded`). Words, direct
// calls and readers: `services/ecs/ecs.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { checkPrefix } from './support/service-screens';
import {
  action,
  button,
  chooseOption,
  definitionDirect,
  DEFINITIONS_H1,
  DEFINITIONS_PATH,
  EcsSeeded,
  expectFlash,
  expectRow,
  expectValue,
  FAMILY_FILTER,
  familyPath,
  field,
  JSON_FIELD,
  NOT_REGISTERED,
  open,
  REGISTER,
  REGISTER_H1,
  REGISTER_NEW_REVISION,
  REGISTER_PATH,
  revisionPath,
  revisionsDirect,
  TABLE,
  tableOf,
} from './services/ecs/ecs';

test('studio.ecs-definition-made-outside-is-listed-and-shown', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsdefs');
  const seeded = new EcsSeeded(ctx, port, p);
  const family = `${p}-td`;
  const first = await seeded.definition(family);
  await seeded.definition(family, { container: 'web', image: 'busybox', port: 80 });
  await seeded.deregister(first);
  const main = page.getByRole('main');

  await open(page, DEFINITIONS_PATH, DEFINITIONS_H1);
  await main.getByRole('textbox', { name: FAMILY_FILTER }).fill(family, ACTION);
  await expectRow(main.locator(TABLE).first(), 'Family', family);
  await main.getByRole('link', { name: family, exact: true }).click(ACTION);
  await expect(page).toHaveURL(addressOf(familyPath(family)));
  await expect(heading(page, family)).toBeVisible();
  const revisions = tableOf(main, 'Revisions');
  await expectRow(revisions, 'Revision', `${family}:2`);
  await chooseOption(revisions, 'INACTIVE');
  await expectRow(revisions, 'Revision', `${family}:1`);

  await open(page, revisionPath(family, 2), `${family}:2`);
  await expectValue(page, 'Status', 'Active');
  const web = await expectRow(tableOf(main, 'Containers'), 'Name', 'web');
  expect([web.Image, web.Ports], "the container's image and ports").toEqual(['busybox', '80/tcp']);
  await expect(main.locator('pre').filter({ hasText: `"family": "${family}"` }), "the JSON holds the family's name").toBeVisible();
});

test('studio.ecs-register-new-revision-from-a-revision', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsnewrev');
  const seeded = new EcsSeeded(ctx, port, p);
  const family = `${p}-td`;
  await seeded.definition(family, { environment: { A: '1' } });
  const main = page.getByRole('main');

  await open(page, revisionPath(family, 1), `${family}:1`);
  await action(main, REGISTER_NEW_REVISION).click(ACTION);
  await expect(heading(page, REGISTER_H1)).toBeVisible({ timeout: 20_000 });
  const text = field(main, JSON_FIELD).getByRole('textbox');
  await expect(text, 'the form holds the family').toHaveValue(new RegExp(`"family": "${family}"`), { timeout: 20_000 });
  const document = JSON.parse(await text.inputValue());
  expect(
    [document.family, document.containerDefinitions[0].name, document.containerDefinitions[0].environment],
    "the form's family, container and variable",
  ).toEqual([family, 'app', [{ name: 'A', value: '1' }]]);
  expect('taskDefinitionArn' in document, 'a taskDefinitionArn in the form').toBe(false);

  await button(main, REGISTER).click(ACTION);
  await expect(page).toHaveURL(addressOf(revisionPath(family, 2)), { timeout: 30_000 });
  await expect(heading(page, `${family}:2`)).toBeVisible({ timeout: 20_000 });
  await expectFlash(page, 'success', `Task definition ${family}:2 registered.`);
  expect(await revisionsDirect(ctx, port, family, 'ACTIVE'), "the family's revisions, directly").toEqual([
    `${family}:1`,
    `${family}:2`,
  ]);
  const second = await definitionDirect(ctx, port, `${family}:2`);
  expect(second?.containerDefinitions?.[0]?.environment, 'the variable of revision 2, directly').toEqual([
    { name: 'A', value: '1' },
  ]);
});

test('studio.ecs-register-shows-the-emulators-refusal', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsbadreg');
  new EcsSeeded(ctx, port, p);
  const family = `${p}-td`;
  expect(await definitionDirect(ctx, port, family), 'no task definition of the family before').toBeNull();
  const main = page.getByRole('main');

  await open(page, REGISTER_PATH, REGISTER_H1);
  const text = field(main, JSON_FIELD).getByRole('textbox');
  const starter = JSON.parse(await text.inputValue());
  starter.family = family;
  starter.memory = '8192';
  await text.fill(JSON.stringify(starter, null, 2), ACTION);
  await button(main, REGISTER).click(ACTION);
  await expect(main.getByText(NOT_REGISTERED), `"${NOT_REGISTERED}"`).toBeVisible({ timeout: 20_000 });
  await expect(main, "the emulator's message names the CPU and memory").toContainText(/cpu[\s\S]*memory|memory[\s\S]*cpu/i);
  await expect(page).toHaveURL(addressOf(REGISTER_PATH));
  expect(
    [await revisionsDirect(ctx, port, family, 'ACTIVE'), await revisionsDirect(ctx, port, family, 'INACTIVE')],
    "the family's revisions, directly",
  ).toEqual([[], []]);
});
