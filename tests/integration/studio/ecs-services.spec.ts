// ECS's services: the services of a cluster's page S3 and the service's page S4 with its two dialogs, in the built
// app in front of a real engine and emulator (test-criteria.md, issue 575: tasks 1 and 6).
//
// `studio.ecs-service-made-outside-is-shown-with-its-tasks`,
// `studio.ecs-update-service-changes-its-count-and-revision`, `studio.ecs-update-service-shows-the-emulators-refusal`,
// `studio.ecs-delete-service-removes-it-and-stops-its-tasks`.
//
// A count a line is about is waited for on the page, with a bound, without "Refresh". Each check names what it makes
// with its own prefix `<p>` and removes it when it ends (`EcsSeeded`). Words, direct calls and readers:
// `services/ecs/ecs.ts`.

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  button,
  chooseOption,
  clusterPath,
  confirmWith,
  DELETE,
  DELETE_SERVICE,
  dialogOf,
  EcsSeeded,
  expectCell,
  expectFlash,
  expectNoRow,
  expectRow,
  expectValue,
  field,
  NOT_UPDATED,
  open,
  rowsOf,
  serviceDirect,
  serviceNamesDirect,
  servicePath,
  STATE_BOUND_MS,
  tableOf,
  taskIdsDirect,
  UPDATE,
  UPDATE_SERVICE,
  world,
} from './services/ecs/ecs';

test('studio.ecs-service-made-outside-is-shown-with-its-tasks', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecssvc');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const service = await seeded.service(cluster, `${p}-svc`, await seeded.definition(`${p}-td`), 1, w);
  const main = page.getByRole('main');

  await open(page, clusterPath(cluster), cluster);
  const services = tableOf(main, 'Services');
  await expectRow(services, 'Name', service);
  await expectCell(services, 'Name', service, 'Desired', '1');
  await expectCell(services, 'Name', service, 'Running', '1');
  await main.getByRole('link', { name: service, exact: true }).click(ACTION);
  await expect(page).toHaveURL(addressOf(servicePath(cluster, service)));
  await expect(heading(page, service)).toBeVisible();
  await expectValue(page, 'Status', 'Active');
  const deployments = tableOf(main, 'Deployments');
  await expect
    .poll(async () => (await rowsOf(deployments)).map((row) => row.Rollout), {
      message: 'one deployment with rollout "Completed"',
      timeout: STATE_BOUND_MS,
    })
    .toEqual(['Completed']);
  await expect
    .poll(async () => (await rowsOf(tableOf(main, 'Events'))).length, { message: 'at least one event', timeout: 30_000 })
    .toBeGreaterThan(0);
  const tasks = tableOf(main, 'Tasks');
  await expect
    .poll(async () => (await rowsOf(tasks)).length, { message: 'one task of the service', timeout: STATE_BOUND_MS })
    .toBe(1);
  const shown = (await rowsOf(tasks))[0]?.Task ?? '';
  expect(await taskIdsDirect(ctx, port, cluster, 'RUNNING', service), "the emulator's ListTasks for the service").toContain(
    shown,
  );
});

test('studio.ecs-update-service-changes-its-count-and-revision', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsupdate');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const family = `${p}-td`;
  const first = await seeded.definition(family);
  const second = await seeded.definition(family);
  const service = await seeded.service(cluster, `${p}-svc`, first, 1, w);
  await seeded.settled(cluster, service, 1);
  const main = page.getByRole('main');

  await open(page, servicePath(cluster, service), service);
  await button(main, UPDATE_SERVICE).click(ACTION);
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await field(dialog, 'Desired tasks').getByRole('textbox').fill('2', ACTION);
  await chooseOption(field(dialog, 'Revision'), second);
  await button(dialog, UPDATE).click(ACTION);
  await expectFlash(page, 'success', `Service ${service} updated.`);
  await expectValue(page, 'Desired tasks', '2');
  await expectValue(page, 'Running tasks', '2');
  await expectValue(page, 'Task definition', second);
  const direct = await serviceDirect(ctx, port, cluster, service);
  expect([direct?.desired, direct?.definition], 'the service, directly').toEqual([2, second]);
});

test('studio.ecs-update-service-shows-the-emulators-refusal', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsnoupdate');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const service = await seeded.service(cluster, `${p}-svc`, await seeded.definition(`${p}-td`), 0, w);
  const main = page.getByRole('main');

  await open(page, servicePath(cluster, service), service);
  await button(main, UPDATE_SERVICE).click(ACTION);
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await seeded.deleteService(cluster, service);
  await button(dialog, UPDATE).click(ACTION);
  const refusal = alertWith(dialog, NOT_UPDATED);
  await expect(refusal, `"${NOT_UPDATED}" in the dialog`).toBeVisible({ timeout: 20_000 });
  await expect(refusal, "the emulator's code").toContainText('ServiceNotActiveException');
  await expect(dialog, 'the dialog stays open').toBeVisible();
  const direct = await serviceDirect(ctx, port, cluster, service);
  expect(direct?.desired, "the service's desired count, directly").toBe(0);
  expect(direct?.status, "the service's status, directly").not.toBe('ACTIVE');
});

test('studio.ecs-delete-service-removes-it-and-stops-its-tasks', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsdelsvc');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const service = await seeded.service(cluster, `${p}-svc`, await seeded.definition(`${p}-td`), 1, w);
  await seeded.settled(cluster, service, 1);
  const main = page.getByRole('main');

  await open(page, servicePath(cluster, service), service);
  await button(main, DELETE_SERVICE).click(ACTION);
  await confirmWith(page, service, DELETE);
  await expect(page).toHaveURL(addressOf(clusterPath(cluster)), { timeout: 30_000 });
  await expect(heading(page, cluster)).toBeVisible({ timeout: 20_000 });
  await expectFlash(page, 'success', `Service ${service} deleted.`);
  await expectNoRow(tableOf(main, 'Services'), 'Name', service);
  expect(await serviceNamesDirect(ctx, port, cluster), "the emulator's ListServices").not.toContain(service);
  expect(await taskIdsDirect(ctx, port, cluster, 'RUNNING', service), "the service's tasks under RUNNING, directly").toEqual(
    [],
  );
});
