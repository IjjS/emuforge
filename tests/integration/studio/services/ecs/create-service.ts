import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { directEc2 } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, addressOf, heading } from '../../support/frame';
import { action, clusterPath, ecs, emptyOf, expectRow, field, lastPart, open, tableOf, world } from './ecs';

export const CREATE = 'Create service';

/** Read two distinct subnets and a security group in the default VPC from the test emulator. */
export async function network(ctx: Ctx, port: number) {
  const { defaultVpc, subnet } = await world(ctx, port);
  const filter = { 'Filter.1.Name': 'vpc-id', 'Filter.1.Value.1': defaultVpc };
  const subnets = await directEc2(ctx, port, 'DescribeSubnets', filter);
  const groups = await directEc2(ctx, port, 'DescribeSecurityGroups', filter);
  if ('error' in subnets || subnets.status !== 200 || 'error' in groups || groups.status !== 200) {
    throw new EnvError('Cannot read the default VPC network for service creation');
  }
  const other = [...subnets.body.matchAll(/<subnetId>([^<]+)<\/subnetId>/g)]
    .map((match) => match[1])
    .find((id) => id !== subnet);
  const group = groups.body.match(/<groupId>([^<]+)<\/groupId>/)?.[1];
  if (!other || !group) throw new EnvError('The default VPC needs two subnets and a security group');
  return { subnet, other, group };
}

export async function enterForm(page: Page, cluster: string, existingService?: string) {
  await open(page, clusterPath(cluster), cluster);
  const main = page.getByRole('main');
  const services = tableOf(main, 'Services');
  if (existingService === undefined) {
    const empty = emptyOf(services);
    await expect(empty).toHaveText('No services');
    await expect(empty).toBeVisible();
  } else {
    await expectRow(services, 'Name', existingService);
  }
  await action(services, CREATE).click(ACTION);
  await expect(page).toHaveURL(addressOf(clusterPath(cluster) + '/services/create'));
  await expect(heading(page, CREATE)).toBeVisible();
  return main;
}

export function input(main: Locator, label: string) {
  return field(main, label).locator(createWrapper().findInput().findNativeInput().toSelector().replace(/^body /, ''));
}

export function tokens(main: Locator, label: string) {
  return field(main, label).locator(createWrapper().findMultiselect().findTokens().toSelector().replace(/^body /, ''));
}

const wrapper = createWrapper();

export async function expectVisibleResult(page: Page, type: 'success' | 'error', ...messages: string[]) {
  let items = page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector()).filter({ visible: true });
  for (const message of messages) items = items.filter({ hasText: message });
  await expect(items).toBeVisible({ timeout: 30_000 });
}

export function publicIpInput(main: Locator) {
  return main.locator(wrapper.findCheckbox().findNativeInput().toSelector().replace(/^body /, ''));
}

export function groupPicker(main: Locator) {
  return field(main, 'Security groups').locator(wrapper.findMultiselect().toSelector().replace(/^body /, ''));
}

/** This isolated cluster has one service. Its Name cell is the first cell of that data row. */
export function createdServiceLink(main: Locator) {
  const section = main.getByRole('region', { name: 'Services', exact: true });
  const nameCell = wrapper.findTable().findBodyCell(1, 1);
  return section.locator(nameCell.findLink().toSelector().replace(/^body /, ''));
}

/** Verify the entire submitted configuration through a fresh request outside Studio. */
export async function expectService(ctx: Ctx, port: number, cluster: string, name: string,
  revision: string, count: number, subnet: string, group: string) {
  const response = await ecs(ctx, port, 'DescribeServices', { cluster, services: [name] });
  expect(response.status).toBe(200);
  expect(response.json.failures ?? []).toEqual([]);
  expect(response.json.services).toHaveLength(1);
  const service = response.json.services[0];
  expect(service).toMatchObject({
    serviceName: name, status: 'ACTIVE', desiredCount: count, launchType: 'FARGATE',
    networkConfiguration: { awsvpcConfiguration: { subnets: [subnet], securityGroups: [group], assignPublicIp: 'ENABLED' } },
  });
  expect(lastPart(service.taskDefinition)).toBe(revision);
}
