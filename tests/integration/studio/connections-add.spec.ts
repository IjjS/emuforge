// `studio.connections-add-connection` (issue 486, test-criteria.md, Integration): the engine holds only `local` (→ `A`).
// A connection added on `/connections` is in the engine's list, not the target; an endpoint off this machine, a name
// already held and the engine's own port are refused with their texts, and the engine's list does not change.

import { expect, OwnEmulator, startStack, test } from './support';
import {
  addForm,
  addThroughForm,
  endpointOf,
  expectResult,
  listTargets,
  openConnections,
  row,
} from './support/connections';
import { ACTION } from './support/frame';
import { checkPrefix } from './support/service-screens';

const NOT_LOOPBACK =
  'Use an address on this machine: https:// and an IP in 127.0.0.0/8 or [::1], with a port. Host names, localhost included, are not accepted.';

test('studio.connections-add-connection', async ({ page, ctx }) => {
  const p = checkPrefix(ctx, 'add');
  const stack = await startStack(ctx);
  const engine = stack.engine.port;
  const b = await OwnEmulator.start(ctx);
  const second = `${p}b`;
  const names = async () => (await listTargets(engine, 'now')).targets.map((t) => t.name);
  await openConnections(page, ['local']);

  await test.step('Add <p>b with B\'s endpoint', async () => {
    await addThroughForm(page, second, endpointOf(b.port));
    await expectResult(page, `${second} was added. Test it, or make it the target.`);
    await expect(row(page, second)).toBeVisible(ACTION);
    await expect(row(page, second).getByText('Target', { exact: true })).toHaveCount(0);
    const list = await listTargets(engine, 'after the add');
    expect(list.targets.find((t) => t.name === second)?.endpoint).toBe(endpointOf(b.port));
    expect(list.active).toBe('local');
  });

  await test.step('Add <p>h on localhost: refused beside Endpoint, values kept', async () => {
    const endpoint = `https://localhost:${String(b.port)}`;
    await addThroughForm(page, `${p}h`, endpoint);
    await expect(page.getByRole('main').getByText(NOT_LOOPBACK, { exact: true })).toBeVisible(ACTION);
    const form = addForm(page);
    // Beside Endpoint: the refusal is the field's own description.
    await expect(form.endpoint).toHaveAccessibleDescription(new RegExp(escapeRe(NOT_LOOPBACK)), ACTION);
    await expect(form.name).toHaveValue(`${p}h`, ACTION);
    await expect(form.endpoint).toHaveValue(endpoint, ACTION);
    expect(await names()).not.toContain(`${p}h`);
  });

  await test.step('Add <p>b again with another port: refused beside Name', async () => {
    await addThroughForm(page, second, endpointOf(stack.emulatorPort));
    await expect(
      page.getByRole('main').getByText(`A connection named ${second} already exists. Choose another name.`, {
        exact: true,
      }),
    ).toBeVisible(ACTION);
    // Beside Name: the refusal is the field's own description.
    await expect(addForm(page).name).toHaveAccessibleDescription(
      new RegExp(escapeRe(`A connection named ${second} already exists. Choose another name.`)),
      ACTION,
    );
    const list = await listTargets(engine, 'after the refused second add');
    expect(list.targets.filter((t) => t.name === second).map((t) => t.endpoint)).toEqual([endpointOf(b.port)]);
  });

  await test.step("Add <p>e on the engine's own port: the engine's refusal with its message", async () => {
    await addThroughForm(page, `${p}e`, endpointOf(engine));
    await expect(
      page
        .getByRole('main')
        .getByText(new RegExp(`^The engine refused the connection: .*${String(engine)}`)),
    ).toBeVisible(ACTION);
    expect(await names()).not.toContain(`${p}e`);
  });
});

/** `text` as a regular expression that matches it literally. */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
