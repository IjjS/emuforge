// `studio.connections-compose-form-holds-one` (issue 486, test-criteria.md, Integration): an engine started in the
// Compose form (`EMUFORGE_FORM=compose`) in front of the run's emulator holds one target, `compose`. `/connections`
// shows it as the target, says the form holds one connection in place of the add form, offers no "Make target" and
// no available "Remove", and its test passes; the engine's list still holds the one target.

import { Engine, expect, requireRunEmulator, StudioServer, test } from './support';
import { listTargets, openConnections, row, rowText } from './support/connections';
import { ACTION } from './support/frame';

const COMPOSE =
  "This is EmuForge's Compose form. It holds one connection, its own emulator, and no other can be added.";

test('studio.connections-compose-form-holds-one', async ({ page, ctx }) => {
  await StudioServer.start(ctx);
  await requireRunEmulator(ctx);
  const engine = await Engine.start(ctx, { form: 'compose' });

  await openConnections(page, ['compose']);
  const main = page.getByRole('main');
  await expect.poll(() => rowText(page, 'compose'), ACTION).toMatch(/^Name compose Target .*Emulator Connected/);
  await expect(main.getByText(COMPOSE, { exact: true })).toBeVisible(ACTION);
  await expect(main.getByRole('button', { name: 'Add connection', exact: true })).toHaveCount(0);
  await expect(main.getByRole('textbox')).toHaveCount(0);
  await expect(row(page, 'compose').getByRole('button', { name: 'Make compose the target', exact: true })).toHaveCount(0);
  await expect(row(page, 'compose').getByRole('button', { name: 'Remove compose', exact: true })).toHaveAttribute(
    'aria-disabled',
    'true',
    ACTION,
  );
  await row(page, 'compose').getByRole('button', { name: 'Test compose', exact: true }).click(ACTION);
  await expect(row(page, 'compose').getByText('Test passed', { exact: true })).toBeVisible({ timeout: 20_000 });

  const list = await listTargets(engine.port, 'after the page');
  expect(list.form).toBe('compose');
  expect(list.active).toBe('compose');
  expect(list.targets.map((t) => t.name)).toEqual(['compose']);
});
