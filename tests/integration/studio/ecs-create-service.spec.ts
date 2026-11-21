import { expect, startStack, test } from './support';
import { ACTION, addressOf, BREADCRUMB_GROUP, heading } from './support/frame';
import { checkPrefix } from './support/service-screens';
import { CREATE, enterForm, expectService, input, network, tokens } from './services/ecs/create-service';
import {
  button, chooseInMultiselect, chooseOption, clusterPath, ecs, EcsSeeded, expectFlash, expectRow,
  expectValue, field, selectOf, serviceNamesDirect, servicePath, tableOf,
} from './services/ecs/ecs';

test('studio.ecs-create-service-opens-the-created-service', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = checkPrefix(ctx, 'ecscreate');
  const seed = new EcsSeeded(ctx, port, prefix);
  const cluster = await seed.cluster(prefix + '-cluster');
  const family = prefix + '-family';
  const older = await seed.definition(family);
  const newer = await seed.definition(family);
  const registration = await ecs(ctx, port, 'RegisterTaskDefinition', {
    family, requiresCompatibilities: ['EC2'], networkMode: 'bridge', cpu: '256', memory: '512',
    containerDefinitions: [{ name: 'app', image: 'busybox', essential: true }],
  });
  expect(registration.status).toBe(200);
  const { subnet, group } = await network(ctx, port);
  const name = prefix + '-service';
  expect(await serviceNamesDirect(ctx, port, cluster)).toEqual([]);
  const main = await enterForm(page, cluster);
  await input(main, 'Service name').fill(name, ACTION);
  await chooseOption(field(main, 'Task definition family'), family);
  await expect(selectOf(field(main, 'Revision'))).toContainText(newer);
  await chooseOption(field(main, 'Revision'), older);
  await input(main, 'Desired tasks').fill('2', ACTION);
  await chooseInMultiselect(field(main, 'Subnets'), subnet);
  await chooseInMultiselect(field(main, 'Security groups'), group);
  await expect(main.getByRole('checkbox', { name: 'Assign public IP' })).toBeChecked();
  await button(main, CREATE).click(ACTION);

  await expect(page).toHaveURL(addressOf(servicePath(cluster, name)));
  await expect(heading(page, name)).toBeVisible();
  await expectValue(page, 'Status', 'Active');
  await expectValue(page, 'Desired tasks', '2');
  await expectValue(page, 'Task definition', older);
  await expectValue(page, 'Launch type', 'FARGATE');
  await expectValue(page, 'Subnets', subnet);
  await expectValue(page, 'Security groups', group);
  await expectValue(page, 'Public IP', 'Enabled');
  await expectFlash(page, 'success', 'Service ' + name + ' created.');
  await page.locator(BREADCRUMB_GROUP).getByRole('link', { name: cluster, exact: true }).click(ACTION);
  await expect(page).toHaveURL(addressOf(clusterPath(cluster)));
  const services = tableOf(main, 'Services');
  await expectRow(services, 'Name', name);
  await expect(services.getByRole('link', { name, exact: true })).toHaveAttribute('href', servicePath(cluster, name));
  await expectService(ctx, port, cluster, name, older, 2, subnet, group);
});

test('studio.ecs-create-service-keeps-input-on-duplicate-name', async ({ ctx, page }) => {
  test.setTimeout(300_000);
  const { emulatorPort: port } = await startStack(ctx);
  const prefix = checkPrefix(ctx, 'ecsdup');
  const seed = new EcsSeeded(ctx, port, prefix);
  const cluster = await seed.cluster(prefix + '-cluster');
  const family = prefix + '-family';
  const original = await seed.definition(family);
  const revision = await seed.definition(family);
  const { subnet, other, group } = await network(ctx, port);
  const name = prefix + '-service';
  const seeded = await ecs(ctx, port, 'CreateService', {
    cluster, serviceName: name, taskDefinition: original, desiredCount: 1, launchType: 'FARGATE',
    networkConfiguration: { awsvpcConfiguration: { subnets: [subnet], securityGroups: [group], assignPublicIp: 'ENABLED' } },
  });
  expect(seeded.status).toBe(200);
  const main = await enterForm(page, cluster);
  await input(main, 'Service name').fill(name, ACTION);
  await chooseOption(field(main, 'Task definition family'), family);
  await expect(selectOf(field(main, 'Revision'))).toContainText(revision);
  await input(main, 'Desired tasks').fill('0', ACTION);
  await chooseInMultiselect(field(main, 'Subnets'), other);
  const publicIp = main.getByRole('checkbox', { name: 'Assign public IP' });
  await publicIp.uncheck(ACTION);
  await button(main, CREATE).click(ACTION);

  await expectFlash(page, 'error', 'The emulator did not create the service.', 'InvalidParameterException', 'Creation of service was not idempotent.');
  await expect(page).toHaveURL(addressOf(clusterPath(cluster) + '/services/create'));
  await expect(input(main, 'Service name')).toHaveValue(name);
  await expect(selectOf(field(main, 'Task definition family'))).toContainText(family);
  await expect(selectOf(field(main, 'Revision'))).toContainText(revision);
  await expect(input(main, 'Desired tasks')).toHaveValue('0');
  await expect(tokens(main, 'Subnets')).toHaveCount(1);
  await expect(tokens(main, 'Subnets')).toContainText(other);
  await expect(tokens(main, 'Security groups')).toHaveCount(0);
  await expect(publicIp).not.toBeChecked();
  expect(await serviceNamesDirect(ctx, port, cluster)).toEqual([name]);
  await expectService(ctx, port, cluster, name, original, 1, subnet, group);
});
