// ECS's clusters: the list S1, the create form S2 and the cluster's page S3, in the built app in front of a real
// engine and emulator (test-criteria.md, issue 575: tasks 1 and 5).
//
// `studio.ecs-cluster-made-outside-is-listed-with-its-tasks`, `studio.ecs-create-cluster-and-delete-it`,
// `studio.ecs-create-cluster-refuses-a-name-that-exists`,
// `studio.ecs-delete-cluster-is-refused-while-a-task-is-not-stopped`,
// `studio.ecs-delete-cluster-is-refused-while-it-has-an-active-service`, `studio.ecs-deleted-cluster-shows-not-found`,
// `studio.ecs-clusters-follow-an-emulator-restart` (tier `full`, `own-emulator`).
//
// Each check names what it makes with its own prefix `<p>` and removes it when it ends (`EcsSeeded`). Words, direct
// calls and readers: `services/ecs/ecs.ts`.

import { expect, expectLine, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  button,
  clusterDirect,
  clusterNamesDirect,
  clusterPath,
  CLUSTERS_H1,
  CLUSTERS_PATH,
  confirmWith,
  CREATE_CLUSTER,
  CREATE_CLUSTER_PATH,
  DELETE,
  DELETE_CLUSTER,
  dialogOf,
  EcsSeeded,
  emptyOf,
  errorOf,
  expectFlash,
  expectNoRow,
  expectRow,
  field,
  findClusterRow,
  NO_CLUSTERS,
  NOT_DELETED_CLUSTER,
  notFoundLinks,
  open,
  REFRESH,
  selectRow,
  TABLE,
  tableOf,
  taskIdsDirect,
  world,
} from './services/ecs/ecs';

test('studio.ecs-cluster-made-outside-is-listed-with-its-tasks', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecslisted');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const definition = await seeded.definition(`${p}-td`);
  const task = await seeded.runningTask(cluster, definition, w);
  const main = page.getByRole('main');

  await open(page, CLUSTERS_PATH, CLUSTERS_H1);
  const row = await findClusterRow(page, cluster);
  expect([row.Status, row['Running tasks']], "the cluster's status and running tasks").toEqual(['Active', '1']);
  await main.getByRole('link', { name: cluster, exact: true }).click(ACTION);
  await expect(page).toHaveURL(addressOf(clusterPath(cluster)));
  await expect(heading(page, cluster)).toBeVisible();
  const tasks = tableOf(main, 'Tasks');
  const shown = await expectRow(tasks, 'Task', task);
  expect([shown['Last status'], shown['Task definition']], "the task's last status and definition").toEqual([
    'Running',
    definition,
  ]);
  expect(await taskIdsDirect(ctx, port, cluster, 'RUNNING'), "the emulator's ListTasks").toEqual([task]);
});

test('studio.ecs-create-cluster-and-delete-it', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecscreate');
  new EcsSeeded(ctx, port, p);
  const name = `${p}-c`;
  expect(await clusterDirect(ctx, port, name), 'no cluster of the name before').toBeNull();
  const main = page.getByRole('main');

  await open(page, CREATE_CLUSTER_PATH, CREATE_CLUSTER);
  await field(main, 'Cluster name').getByRole('textbox').fill(name, ACTION);
  await button(main, CREATE_CLUSTER).click(ACTION);
  await expect(page).toHaveURL(addressOf(clusterPath(name)), { timeout: 30_000 });
  await expect(heading(page, name)).toBeVisible({ timeout: 20_000 });
  await expectFlash(page, 'success', `Cluster ${name} created.`);
  expect((await clusterDirect(ctx, port, name))?.status, 'the cluster, directly').toBe('ACTIVE');

  await button(main, DELETE_CLUSTER).click(ACTION);
  await confirmWith(page, name, DELETE);
  await expect(page).toHaveURL(addressOf(CLUSTERS_PATH), { timeout: 30_000 });
  await expect(heading(page, CLUSTERS_H1)).toBeVisible();
  await expectFlash(page, 'success', `Cluster ${name} deleted.`);
  await expectNoRow(main.locator(TABLE).first(), 'Name', name);
  expect(await clusterNamesDirect(ctx, port), "the emulator's ListClusters").not.toContain(name);
  expect((await clusterDirect(ctx, port, name))?.status, 'the cluster, directly').toBe('INACTIVE');
});

test('studio.ecs-create-cluster-refuses-a-name-that-exists', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsexists');
  const seeded = new EcsSeeded(ctx, port, p);
  const name = await seeded.cluster(`${p}-c`, { made: 'outside' });
  const main = page.getByRole('main');

  await open(page, CREATE_CLUSTER_PATH, CREATE_CLUSTER);
  await field(main, 'Cluster name').getByRole('textbox').fill(name, ACTION);
  await button(main, CREATE_CLUSTER).click(ACTION);
  const said = `A cluster named ${name} already exists.`;
  await expect(errorOf(field(main, 'Cluster name')), `"${said}"`).toHaveText(said, { timeout: 20_000 });
  await expect(page).toHaveURL(addressOf(CREATE_CLUSTER_PATH));
  await expect(field(main, 'Cluster name').getByRole('textbox'), 'the name as typed').toHaveValue(name);
  expect((await clusterNamesDirect(ctx, port)).filter((each) => each === name), 'clusters of that name').toEqual([name]);
  expect((await clusterDirect(ctx, port, name))?.tags, "the cluster's tags, directly").toEqual({ made: 'outside' });
});

test('studio.ecs-delete-cluster-is-refused-while-a-task-is-not-stopped', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsbusy');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  await seeded.runningTask(cluster, await seeded.definition(`${p}-td`), w);
  const main = page.getByRole('main');

  await open(page, clusterPath(cluster), cluster);
  await button(main, DELETE_CLUSTER).click(ACTION);
  await confirmWith(page, cluster, DELETE);
  const dialog = dialogOf(page);
  await expect(alertWith(dialog, NOT_DELETED_CLUSTER), `"${NOT_DELETED_CLUSTER}" in the dialog`).toBeVisible({
    timeout: 20_000,
  });
  await expect(alertWith(dialog, NOT_DELETED_CLUSTER)).toContainText('ClusterContainsTasksException');
  await expect(dialog, 'the dialog stays open').toBeVisible();
  expect((await clusterDirect(ctx, port, cluster))?.status, 'the cluster, directly').toBe('ACTIVE');
});

test('studio.ecs-delete-cluster-is-refused-while-it-has-an-active-service', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsserved');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  await seeded.service(cluster, `${p}-svc`, await seeded.definition(`${p}-td`), 0, w);
  const main = page.getByRole('main');

  await open(page, CLUSTERS_PATH, CLUSTERS_H1);
  await findClusterRow(page, cluster);
  await selectRow(main.locator(TABLE).first(), 'Name', cluster);
  await button(main, DELETE).click(ACTION);
  await confirmWith(page, cluster, DELETE);
  const dialog = dialogOf(page);
  await expect(alertWith(dialog, 'ClusterContainsServicesException'), 'the refusal in the dialog').toBeVisible({
    timeout: 20_000,
  });
  await expect(dialog, 'the dialog stays open').toBeVisible();
  expect((await clusterDirect(ctx, port, cluster))?.status, 'the cluster, directly').toBe('ACTIVE');
});

test('studio.ecs-deleted-cluster-shows-not-found', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsgone');
  const seeded = new EcsSeeded(ctx, port, p);
  const cluster = await seeded.cluster(`${p}-c`);
  await seeded.deleteCluster(cluster);
  expect((await clusterDirect(ctx, port, cluster))?.status, 'the deleted cluster, directly').toBe('INACTIVE');
  const main = page.getByRole('main');

  await page.goto(clusterPath(cluster));
  await expect(main.getByText(`No cluster named ${cluster}`, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(
    notFoundLinks(main, `No cluster named ${cluster}`).and(main.getByRole('link', { name: CLUSTERS_H1, exact: true })),
    'the link "Clusters" of the not-found state',
  ).toBeVisible();
  await expect(tableOf(main, 'Services'), 'a services table').toHaveCount(0);
  await expect(tableOf(main, 'Tasks'), 'a tasks table').toHaveCount(0);
});

test('studio.ecs-clusters-follow-an-emulator-restart', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx, { ownEmulator: true });
  const emulator = stack.emulator!;
  const p = checkPrefix(ctx, 'ecsrestart');
  const seeded = new EcsSeeded(ctx, emulator.port, p);
  const cluster = await seeded.cluster(`${p}-c`);
  const main = page.getByRole('main');
  const table = main.locator(TABLE).first();

  await open(page, CLUSTERS_PATH, CLUSTERS_H1);
  await expectRow(table, 'Name', cluster);
  await emulator.stop();
  await emulator.startAgain();
  await expectLine(page, /Connected/, 60_000);
  await button(main, REFRESH).click(ACTION);
  await expect(emptyOf(table).getByText(NO_CLUSTERS, { exact: true }), `"${NO_CLUSTERS}"`).toBeVisible({
    timeout: 60_000,
  });
  await expectNoRow(table, 'Name', cluster);
});
