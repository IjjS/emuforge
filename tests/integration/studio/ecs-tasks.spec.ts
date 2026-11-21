// ECS's tasks: the run form S6 and the task's page S5 with its logs, in the built app in front of a real engine and
// emulator (test-criteria.md, issue 575: tasks 2 and 3).
//
// `studio.ecs-starter-registers-runs-and-logs`, `studio.ecs-task-whose-command-ends-is-followed-to-stopped`,
// `studio.ecs-stop-task-stops-it-in-the-emulator`, `studio.ecs-task-run-without-a-public-ip-fails-to-start`,
// `studio.ecs-run-task-shows-the-emulators-refusal`, `studio.ecs-unknown-task-shows-not-found`.
//
// The emulator plays a task from its container's command (requirement.md, R1.1): it runs after about 5 seconds, and
// a status a line is about is waited for on the page, with a bound, without "Refresh". Each check names what it
// makes with its own prefix `<p>` and removes it when it ends (`EcsSeeded`). Words, direct calls and readers:
// `services/ecs/ecs.ts`.

import type { Page } from '@playwright/test';

import { expect, startStack, test } from './support';
import { ACTION, addressOf, heading } from './support/frame';
import { checkPrefix } from './support/service-screens';
import {
  alertWith,
  button,
  chooseInMultiselect,
  chooseOption,
  clusterPath,
  definitionDirect,
  dialogOf,
  EcsSeeded,
  expectCell,
  expectFlash,
  expectValue,
  field,
  JSON_FIELD,
  lastPart,
  logOf,
  logPartOf,
  NO_LOG_YET,
  NOT_RUN,
  notFoundLinks,
  open,
  REGISTER,
  REGISTER_H1,
  REGISTER_PATH,
  revisionPath,
  RUN_TASK,
  runTaskPath,
  selectOf,
  STARTER_LINE,
  STATE_BOUND_MS,
  STOP_TASK,
  tableOf,
  taskDirect,
  taskIdsDirect,
  taskPath,
  valueOf,
  world,
  type World,
} from './services/ecs/ecs';

/** Fills "Run task" of `cluster` with `family`, its preset revision and the world's subnet; the form is left open. */
async function fillRunTask(page: Page, cluster: string, family: string, definition: string, w: World): Promise<void> {
  const main = page.getByRole('main');
  await open(page, runTaskPath(cluster), RUN_TASK);
  await chooseOption(field(main, 'Task definition family'), family);
  await expect(selectOf(field(main, 'Revision')), 'the preset revision').toContainText(definition, { timeout: 20_000 });
  await chooseInMultiselect(field(main, 'Subnets'), w.subnet);
}

/** The address of the page of any task of `cluster`. */
function aTaskOf(cluster: string): RegExp {
  return new RegExp(`${clusterPath(cluster).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/tasks/task/[^/?#]+$`);
}

/** The id of the task whose page is open, from its address. */
function taskOf(page: Page): string {
  return decodeURIComponent(lastPart(new URL(page.url()).pathname));
}

test('studio.ecs-starter-registers-runs-and-logs', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsstarter');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const family = `${p}-td`;
  expect(await definitionDirect(ctx, port, family), 'no task definition of the family before').toBeNull();
  const main = page.getByRole('main');

  await open(page, REGISTER_PATH, REGISTER_H1);
  const text = field(main, JSON_FIELD).getByRole('textbox');
  const starter = JSON.parse(await text.inputValue());
  starter.family = family;
  starter.containerDefinitions[0].logConfiguration.options['awslogs-group'] = `${p}-logs`;
  await text.fill(JSON.stringify(starter, null, 2), ACTION);
  await button(main, REGISTER).click(ACTION);
  await expect(page).toHaveURL(addressOf(revisionPath(family, 1)), { timeout: 30_000 });
  await expect(heading(page, `${family}:1`)).toBeVisible({ timeout: 20_000 });
  await expectFlash(page, 'success', `Task definition ${family}:1 registered.`);
  expect((await definitionDirect(ctx, port, `${family}:1`))?.status, 'the revision, directly').toBe('ACTIVE');

  await fillRunTask(page, cluster, family, `${family}:1`, w);
  await expect(main.getByRole('checkbox', { name: 'Assign a public IP' }), 'the public IP box as it starts').toBeChecked();
  await button(main, RUN_TASK).click(ACTION);
  await expect(page).toHaveURL(aTaskOf(cluster), { timeout: 30_000 });
  const task = taskOf(page);
  await expect(heading(page, `Task ${task}`)).toBeVisible({ timeout: 20_000 });
  await expectFlash(page, 'success', `Task ${task} started.`);
  await expectValue(page, 'Last status', 'Running');
  await expect(logOf(page, 'app'), `the log line "${STARTER_LINE}"`).toContainText(STARTER_LINE, {
    timeout: STATE_BOUND_MS,
  });
  expect(await valueOf(main, 'Last status'), 'the last status after the log line').toBe('Running');
  const direct = await taskDirect(ctx, port, cluster, task);
  expect([direct?.lastStatus, direct?.launchType], 'the task, directly').toEqual(['RUNNING', 'FARGATE']);
});

test('studio.ecs-task-whose-command-ends-is-followed-to-stopped', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsends');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const definition = await seeded.definition(`${p}-td`, {
    command: ['sh', '-c', 'echo start; sleep 20; echo done; exit 3'],
    logGroup: `${p}-logs`,
  });
  const task = await seeded.task(cluster, definition, w);
  const main = page.getByRole('main');

  await open(page, taskPath(cluster, task), `Task ${task}`);
  // The state in between is what the line is about: the page is open before the task has stopped.
  await expect
    .poll(() => valueOf(main, 'Last status'), { message: 'a last status is shown', timeout: 20_000 })
    .not.toBeNull();
  expect(await valueOf(main, 'Last status'), 'the last status when the page opens').not.toBe('Stopped');
  await expectValue(page, 'Last status', 'Stopped');
  await expectValue(page, 'Stop code', 'EssentialContainerExited');
  await expectCell(tableOf(main, 'Containers'), 'Name', 'app', 'Exit code', '3');
  await expect(logOf(page, 'app'), 'the log lines "start" then "done"').toContainText(/start[\s\S]*done/, {
    timeout: STATE_BOUND_MS,
  });
  const direct = await taskDirect(ctx, port, cluster, task);
  expect([direct?.lastStatus, direct?.exitCode], 'the task, directly').toEqual(['STOPPED', 3]);
});

test('studio.ecs-stop-task-stops-it-in-the-emulator', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsstop');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const task = await seeded.runningTask(cluster, await seeded.definition(`${p}-td`), w);
  const main = page.getByRole('main');

  await open(page, taskPath(cluster, task), `Task ${task}`);
  await expectValue(page, 'Last status', 'Running');
  await button(main, STOP_TASK).click(ACTION);
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await button(dialog, STOP_TASK).click(ACTION);
  await expectFlash(page, 'success', `Stopping task ${task}.`);
  await expectValue(page, 'Last status', 'Stopped');
  await expectValue(page, 'Stop code', 'UserInitiated');
  await expect(button(main, STOP_TASK), '"Stop task" is unavailable').toBeDisabled();
  expect((await taskDirect(ctx, port, cluster, task))?.lastStatus, 'the task, directly').toBe('STOPPED');
});

test('studio.ecs-task-run-without-a-public-ip-fails-to-start', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsnoip');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const family = `${p}-td`;
  const definition = await seeded.definition(family, { logGroup: `${p}-logs` });
  const main = page.getByRole('main');

  await fillRunTask(page, cluster, family, definition, w);
  await main.getByRole('checkbox', { name: 'Assign a public IP' }).uncheck(ACTION);
  await button(main, RUN_TASK).click(ACTION);
  await expect(page).toHaveURL(aTaskOf(cluster), { timeout: 30_000 });
  const task = taskOf(page);
  await expect(heading(page, `Task ${task}`)).toBeVisible({ timeout: 20_000 });
  // The emulator's simulated registry timeout can leave this task pending beyond 60 seconds.
  await expect
    .poll(() => valueOf(main, 'Last status'), { message: '"Last status" is "Stopped"', timeout: 90_000 })
    .toBe('Stopped');
  await expectValue(page, 'Stop code', 'TaskFailedToStart');
  await expect(
    logPartOf(main, 'app').getByText(NO_LOG_YET, { exact: true }),
    `"${NO_LOG_YET}" in the log part`,
  ).toBeVisible({ timeout: 20_000 });
  const direct = await taskDirect(ctx, port, cluster, task);
  expect([direct?.lastStatus, direct?.stopCode], 'the task, directly').toEqual(['STOPPED', 'TaskFailedToStart']);
});

test('studio.ecs-run-task-shows-the-emulators-refusal', async ({ ctx, page }) => {
  test.setTimeout(240_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsrefused');
  const seeded = new EcsSeeded(ctx, port, p);
  const w = await world(ctx, port);
  const cluster = await seeded.cluster(`${p}-c`);
  const family = `${p}-td`;
  const definition = await seeded.definition(family);
  const main = page.getByRole('main');

  await fillRunTask(page, cluster, family, definition, w);
  await seeded.deregister(definition);
  await button(main, RUN_TASK).click(ACTION);
  const refusal = alertWith(main, NOT_RUN);
  await expect(refusal, `"${NOT_RUN}" on the form`).toBeVisible({ timeout: 20_000 });
  await expect(refusal, "the emulator's message").toContainText('TaskDefinition is inactive');
  await expect(page).toHaveURL(addressOf(runTaskPath(cluster)));
  expect(
    [await taskIdsDirect(ctx, port, cluster, 'RUNNING'), await taskIdsDirect(ctx, port, cluster, 'STOPPED')],
    "the cluster's tasks, running and stopped, directly",
  ).toEqual([[], []]);
});

test('studio.ecs-unknown-task-shows-not-found', async ({ ctx, page }) => {
  test.setTimeout(180_000);
  const stack = await startStack(ctx);
  const port = stack.emulatorPort;
  const p = checkPrefix(ctx, 'ecsnotask');
  const seeded = new EcsSeeded(ctx, port, p);
  const cluster = await seeded.cluster(`${p}-c`);
  const task = '0123456789abcdef0123456789abcdef';
  expect(await taskDirect(ctx, port, cluster, task), 'the task, directly').toBeNull();
  const main = page.getByRole('main');

  await page.goto(taskPath(cluster, task));
  await expect(main.getByText(`No task ${task}`, { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(notFoundLinks(main, `No task ${task}`), "a link to the cluster's page").toHaveAttribute(
    'href',
    clusterPath(cluster),
  );
});
