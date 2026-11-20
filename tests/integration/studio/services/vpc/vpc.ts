// The emulator side and the words of VPC's screens (test-criteria.md, issue 574), for the `vpc-*.spec.ts` checks.
//
// - Direct calls: `directEc2` of `support/aws-clients-general.ts` (the EC2 query protocol, XML answers), straight to
//   the emulator, SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`, never through
//   the engine.
// - `VpcSeeded`: the VPCs, subnets, route tables, internet gateways, security groups, NAT gateways and instances a
//   check makes. When the check ends it removes all of the emulator's that is the check's, those Studio's actions made
//   included, in the order of test-criteria.md: the instances terminated and `terminated` waited for, the NAT
//   gateways deleted and `deleted` waited for, the associations and the route tables that are not a main one, the
//   internet gateways detached and deleted, the security groups, the subnets, the VPCs.
// - The screens' words (requirement.md, "EmuForge's own text") and readers of what a screen shows. What is inside a
//   Cloudscape component (a select's options, a table's rows and cells, a flash, a modal) is found with Cloudscape's
//   own test selectors, an option by its value; a reader waits for the settled screen.
//
// A service's folder imports no other service's: the direct calls and the readers of Cloudscape's parts are this
// folder's own, as `services/ec2/ec2.ts` has its own.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';

import { directEc2, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Direct calls.
// ---------------------------------------------------------------------------------------------------------------

/** An element of an XML answer: its name without a prefix, its child elements and its own text. */
export interface Xml {
  name: string;
  children: Xml[];
  text: string;
}

function xmlText(raw: string): string {
  return raw
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');
}

/** Parses an XML answer of elements and text (no mixed content is read). */
export function parseXml(body: string): Xml {
  const root: Xml = { name: '', children: [], text: '' };
  const stack: Xml[] = [root];
  const tag = /<(\/?)([A-Za-z_][\w.:-]*)([^>]*?)(\/?)>|<\?[\s\S]*?\?>|<!--[\s\S]*?-->/g;
  let last = 0;
  let found: RegExpExecArray | null;
  while ((found = tag.exec(body)) !== null) {
    const top = stack[stack.length - 1]!;
    top.text += body.slice(last, found.index);
    last = tag.lastIndex;
    const name = found[2];
    if (name === undefined) continue;
    const local = name.slice(name.indexOf(':') + 1);
    if (found[1] === '/') {
      top.text = xmlText(top.text.trim());
      if (stack.length > 1) stack.pop();
    } else {
      const element: Xml = { name: local, children: [], text: '' };
      top.children.push(element);
      if (found[4] !== '/') stack.push(element);
    }
  }
  return root.children[0] ?? root;
}

/** The first child `name` of `node`, or `undefined`. */
export function child(node: Xml | undefined, name: string): Xml | undefined {
  return node?.children.find((each) => each.name === name);
}

/** The text of the element at `path` below `node`; `undefined` when a step is missing. */
export function textAt(node: Xml | undefined, ...path: string[]): string | undefined {
  let at = node;
  for (const step of path) at = child(at, step);
  return at === undefined ? undefined : at.text;
}

/** The `item` children of the child `set` of `node`. */
export function items(node: Xml | undefined, set: string): Xml[] {
  return (child(node, set)?.children ?? []).filter((each) => each.name === 'item');
}

/** The first element named `name` anywhere below `node`, depth first. */
function anywhere(node: Xml, name: string): Xml | undefined {
  for (const each of node.children) {
    if (each.name === name) return each;
    const deeper = anywhere(each, name);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

/** A direct answer: its status, its body as it came, its parsed root and, for a refusal, the emulator's code. */
export interface Answer {
  status: number;
  body: string;
  root: Xml;
  code: string | null;
  message: string | null;
}

function arrived(answer: DirectAnswer, what: string): { status: number; body: string } {
  if ('error' in answer) throw new EnvError(`${what}: ${answer.error}`);
  return answer;
}

/** An EC2 action with its parameters, straight to the emulator; logs its status. The body is never logged. */
export async function ec2(ctx: Ctx, port: number, action: string, params: Record<string, string> = {}): Promise<Answer> {
  const answer = arrived(await directEc2(ctx, port, action, params), `direct ${action}`);
  const root = parseXml(answer.body);
  const code = answer.status === 200 ? null : (anywhere(root, 'Code')?.text ?? null);
  const message = answer.status === 200 ? null : (anywhere(root, 'Message')?.text ?? null);
  ctx.log(`direct ec2 ${action}: status ${String(answer.status)}${code ? ` ${code}` : ''}`);
  return { ...answer, root, code, message };
}

/** An EC2 action that must answer 200; an `EnvError` otherwise (a check's Given that does not hold). */
async function given(ctx: Ctx, port: number, action: string, params: Record<string, string>): Promise<Answer> {
  const answer = await ec2(ctx, port, action, params);
  if (answer.status !== 200) {
    throw new EnvError(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''} ${answer.message ?? ''}`);
  }
  return answer;
}

/** `Filter.n.Name` and `Filter.n.Value.m` for `filters`. */
function filterParams(filters: Record<string, string | string[]>): Record<string, string> {
  const params: Record<string, string> = {};
  Object.entries(filters).forEach(([name, value], i) => {
    params[`Filter.${String(i + 1)}.Name`] = name;
    (Array.isArray(value) ? value : [value]).forEach((each, j) => {
      params[`Filter.${String(i + 1)}.Value.${String(j + 1)}`] = each;
    });
  });
  return params;
}

/** Every page of a describe `action`: the `item`s of its `set`, following `nextToken`. */
async function everyPage(
  ctx: Ctx,
  port: number,
  action: string,
  set: string,
  params: Record<string, string>,
  paged: boolean,
): Promise<Xml[]> {
  const found: Xml[] = [];
  let token: string | undefined;
  for (let i = 0; i < 200; i++) {
    const answer: Answer = await ec2(ctx, port, action, {
      ...params,
      ...(paged ? { MaxResults: '100' } : {}),
      ...(token === undefined ? {} : { NextToken: token }),
    });
    if (answer.status !== 200) throw new Error(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''}`);
    const page = items(answer.root, set);
    found.push(...page);
    token = textAt(answer.root, 'nextToken');
    if (!paged || token === undefined || token === '' || page.length === 0) break;
  }
  return found;
}

// --- What the emulator reports ---

/** How long a check waits for a state the emulator moves by itself. */
export const STATE_BOUND_MS = 30_000;

function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function tagsOf(node: Xml): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const tag of items(node, 'tagSet')) tags[textAt(tag, 'key') ?? ''] = textAt(tag, 'value') ?? '';
  return tags;
}

type Filters = Record<string, string | string[]>;

async function described(ctx: Ctx, port: number, action: string, set: string, filters: Filters): Promise<Xml[]> {
  return everyPage(ctx, port, action, set, filterParams(filters), false);
}

/** A VPC as `DescribeVpcs` gives it. */
export interface DirectVpc {
  id: string;
  state: string;
  cidr: string;
  isDefault: boolean;
  tags: Record<string, string>;
}

/** The VPCs `DescribeVpcs` answers for `filters`. */
export async function vpcsDirect(ctx: Ctx, port: number, filters: Filters = {}): Promise<DirectVpc[]> {
  return (await described(ctx, port, 'DescribeVpcs', 'vpcSet', filters)).map((node) => ({
    id: textAt(node, 'vpcId') ?? '',
    state: textAt(node, 'state') ?? '',
    cidr: textAt(node, 'cidrBlock') ?? '',
    isDefault: textAt(node, 'isDefault') === 'true',
    tags: tagsOf(node),
  }));
}

/** The VPC `id` by the filter `vpc-id`; `null` when the emulator holds none. */
export async function vpcDirect(ctx: Ctx, port: number, id: string): Promise<DirectVpc | null> {
  return (await vpcsDirect(ctx, port, { 'vpc-id': id }))[0] ?? null;
}

/** The VPCs whose tag `Name` is exactly `name`. */
export async function vpcsNamed(ctx: Ctx, port: number, name: string): Promise<DirectVpc[]> {
  return vpcsDirect(ctx, port, { 'tag:Name': name });
}

/** Whether the VPC attribute `attribute` (`enableDnsSupport`, `enableDnsHostnames`) is on. */
export async function vpcAttributeDirect(ctx: Ctx, port: number, id: string, attribute: string): Promise<boolean> {
  const answer = await given(ctx, port, 'DescribeVpcAttribute', { VpcId: id, Attribute: attribute });
  return textAt(answer.root, attribute, 'value') === 'true';
}

/** A subnet as `DescribeSubnets` gives it. */
export interface DirectSubnet {
  id: string;
  arn: string | undefined;
  state: string;
  vpcId: string;
  cidr: string;
  zone: string;
  free: string;
  isDefault: boolean;
  publicOnLaunch: boolean;
  tags: Record<string, string>;
}

/** The subnets `DescribeSubnets` answers for `filters`. */
export async function subnetsDirect(ctx: Ctx, port: number, filters: Filters = {}): Promise<DirectSubnet[]> {
  return (await described(ctx, port, 'DescribeSubnets', 'subnetSet', filters)).map((node) => ({
    id: textAt(node, 'subnetId') ?? '',
    arn: present(textAt(node, 'subnetArn')),
    state: textAt(node, 'state') ?? '',
    vpcId: textAt(node, 'vpcId') ?? '',
    cidr: textAt(node, 'cidrBlock') ?? '',
    zone: textAt(node, 'availabilityZone') ?? '',
    free: textAt(node, 'availableIpAddressCount') ?? '',
    isDefault: textAt(node, 'defaultForAz') === 'true',
    publicOnLaunch: textAt(node, 'mapPublicIpOnLaunch') === 'true',
    tags: tagsOf(node),
  }));
}

/** The subnet `id` by the filter `subnet-id`; `null` when the emulator holds none. */
export async function subnetDirect(ctx: Ctx, port: number, id: string): Promise<DirectSubnet | null> {
  return (await subnetsDirect(ctx, port, { 'subnet-id': id }))[0] ?? null;
}

/** The subnets of the VPC `vpcId`. */
export async function subnetsOf(ctx: Ctx, port: number, vpcId: string): Promise<DirectSubnet[]> {
  return subnetsDirect(ctx, port, { 'vpc-id': vpcId });
}

export interface DirectRoute {
  destination: string | undefined;
  target: string | undefined;
  state: string | undefined;
}

export interface DirectAssociation {
  id: string;
  subnetId: string | undefined;
  main: boolean;
}

/** A route table as `DescribeRouteTables` gives it. */
export interface DirectRouteTable {
  id: string;
  vpcId: string;
  main: boolean;
  routes: DirectRoute[];
  associations: DirectAssociation[];
  tags: Record<string, string>;
}

/** The route tables `DescribeRouteTables` answers for `filters`. */
export async function routeTablesDirect(ctx: Ctx, port: number, filters: Filters = {}): Promise<DirectRouteTable[]> {
  return (await described(ctx, port, 'DescribeRouteTables', 'routeTableSet', filters)).map((node) => {
    const associations = items(node, 'associationSet').map((each) => ({
      id: textAt(each, 'routeTableAssociationId') ?? '',
      subnetId: present(textAt(each, 'subnetId')),
      main: textAt(each, 'main') === 'true',
    }));
    return {
      id: textAt(node, 'routeTableId') ?? '',
      vpcId: textAt(node, 'vpcId') ?? '',
      main: associations.some((each) => each.main),
      routes: items(node, 'routeSet').map((each) => ({
        destination: present(textAt(each, 'destinationCidrBlock')),
        target: present(textAt(each, 'gatewayId')),
        state: present(textAt(each, 'state')),
      })),
      associations,
      tags: tagsOf(node),
    };
  });
}

/** The route table `id` by the filter `route-table-id`; `null` when the emulator holds none. */
export async function routeTableDirect(ctx: Ctx, port: number, id: string): Promise<DirectRouteTable | null> {
  return (await routeTablesDirect(ctx, port, { 'route-table-id': id }))[0] ?? null;
}

/** The route tables of the VPC `vpcId`. */
export async function routeTablesOf(ctx: Ctx, port: number, vpcId: string): Promise<DirectRouteTable[]> {
  return routeTablesDirect(ctx, port, { 'vpc-id': vpcId });
}

/** The associations of the subnet `subnetId`, in any route table. */
export async function associationsOf(ctx: Ctx, port: number, subnetId: string): Promise<DirectAssociation[]> {
  const tables = await routeTablesDirect(ctx, port, { 'association.subnet-id': subnetId });
  return tables.flatMap((table) => table.associations.filter((each) => each.subnetId === subnetId));
}

/** An internet gateway as `DescribeInternetGateways` gives it; `vpcIds` are the VPCs it is attached to. */
export interface DirectGateway {
  id: string;
  vpcIds: string[];
  tags: Record<string, string>;
}

/** The internet gateways `DescribeInternetGateways` answers for `filters`. */
export async function gatewaysDirect(ctx: Ctx, port: number, filters: Filters = {}): Promise<DirectGateway[]> {
  return (await described(ctx, port, 'DescribeInternetGateways', 'internetGatewaySet', filters)).map((node) => ({
    id: textAt(node, 'internetGatewayId') ?? '',
    vpcIds: items(node, 'attachmentSet')
      .map((each) => textAt(each, 'vpcId') ?? '')
      .filter((each) => each !== ''),
    tags: tagsOf(node),
  }));
}

/** The internet gateway `id` by the filter `internet-gateway-id`; `null` when the emulator holds none. */
export async function gatewayDirect(ctx: Ctx, port: number, id: string): Promise<DirectGateway | null> {
  return (await gatewaysDirect(ctx, port, { 'internet-gateway-id': id }))[0] ?? null;
}

/** The internet gateways whose tag `Name` is exactly `name`. */
export async function gatewaysNamed(ctx: Ctx, port: number, name: string): Promise<DirectGateway[]> {
  return gatewaysDirect(ctx, port, { 'tag:Name': name });
}

/** An instance as far as a VPC check reads it. */
export interface DirectInstance {
  id: string;
  state: string;
  publicIp: string | undefined;
}

async function instancesDirect(ctx: Ctx, port: number, filters: Filters): Promise<DirectInstance[]> {
  const reservations = await everyPage(ctx, port, 'DescribeInstances', 'reservationSet', filterParams(filters), true);
  return reservations.flatMap((reservation) =>
    items(reservation, 'instancesSet').map((node) => ({
      id: textAt(node, 'instanceId') ?? '',
      state: textAt(node, 'instanceState', 'name') ?? '',
      publicIp: present(textAt(node, 'ipAddress')),
    })),
  );
}

/** The instance `id`; `null` when the emulator holds none. */
export async function instanceDirect(ctx: Ctx, port: number, id: string): Promise<DirectInstance | null> {
  return (await instancesDirect(ctx, port, { 'instance-id': id }))[0] ?? null;
}

async function reportsInstanceState(ctx: Ctx, port: number, id: string, state: string): Promise<boolean> {
  const found = await waitFor(STATE_BOUND_MS, async () =>
    (await instanceDirect(ctx, port, id))?.state === state ? true : undefined,
  );
  ctx.log(`the emulator ${found ? 'reports' : 'does not report'} ${id} as ${state}`);
  return found === true;
}

async function natGatewayStates(ctx: Ctx, port: number, filters: Filters): Promise<{ id: string; state: string }[]> {
  return (await described(ctx, port, 'DescribeNatGateways', 'natGatewaySet', filters)).map((node) => ({
    id: textAt(node, 'natGatewayId') ?? '',
    state: textAt(node, 'state') ?? '',
  }));
}

async function reportsNatGatewayState(ctx: Ctx, port: number, id: string, state: string): Promise<boolean> {
  const found = await waitFor(STATE_BOUND_MS, async () =>
    (await natGatewayStates(ctx, port, { 'nat-gateway-id': id }))[0]?.state === state ? true : undefined,
  );
  ctx.log(`the emulator ${found ? 'reports' : 'does not report'} ${id} as ${state}`);
  return found === true;
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

function nameTag(resource: string, name: string | undefined, more: Record<string, string> = {}): Record<string, string> {
  const tags = { ...(name === undefined ? {} : { Name: name }), ...more };
  const params: Record<string, string> = {};
  Object.entries(tags).forEach(([key, value], i) => {
    params['TagSpecification.1.ResourceType'] = resource;
    params[`TagSpecification.1.Tag.${String(i + 1)}.Key`] = key;
    params[`TagSpecification.1.Tag.${String(i + 1)}.Value`] = value;
  });
  return params;
}

/**
 * The VPCs, subnets, route tables, internet gateways, security groups, NAT gateways and instances a check makes
 * directly on the emulator on `port`. Every VPC and internet gateway is named under the check's prefix; what is in a
 * VPC is found again by the VPC's `vpc-id`, so a subnet without a name is the check's too. Making one that the
 * emulator refuses is an environment failure: the check's Given would not hold.
 */
export class VpcSeeded {
  private readonly vpcs = new Set<string>();
  private readonly gateways = new Set<string>();
  private image: string | undefined;

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  private named(name: string): void {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
  }

  private id(answer: Answer, what: string, ...path: string[]): string {
    const id = textAt(answer.root, ...path);
    if (id === undefined || id === '') throw new EnvError(`the emulator gave ${what} no id`);
    return id;
  }

  /** `CreateVpc cidr` named `name`, with the tags `tags` beside; its id. */
  async vpc(name: string, cidr: string, tags: Record<string, string> = {}): Promise<string> {
    this.named(name);
    const answer = await given(this.ctx, this.port, 'CreateVpc', { CidrBlock: cidr, ...nameTag('vpc', name, tags) });
    const id = this.id(answer, `the VPC ${name}`, 'vpc', 'vpcId');
    this.vpcs.add(id);
    return id;
  }

  /** `CreateSubnet cidr` in `vpcId`, named `name` when given, in `zone` when given; its id. */
  async subnet(vpcId: string, name: string | undefined, cidr: string, zone?: string): Promise<string> {
    if (name !== undefined) this.named(name);
    const answer = await given(this.ctx, this.port, 'CreateSubnet', {
      VpcId: vpcId,
      CidrBlock: cidr,
      ...(zone === undefined ? {} : { AvailabilityZone: zone }),
      ...nameTag('subnet', name),
    });
    return this.id(answer, `the subnet ${name ?? cidr}`, 'subnet', 'subnetId');
  }

  /** `ModifySubnetAttribute MapPublicIpOnLaunch`. */
  async publicOnLaunch(subnetId: string, on: boolean): Promise<void> {
    await given(this.ctx, this.port, 'ModifySubnetAttribute', {
      SubnetId: subnetId,
      'MapPublicIpOnLaunch.Value': on ? 'true' : 'false',
    });
  }

  /** `CreateInternetGateway` named `name`; its id. */
  async gateway(name: string): Promise<string> {
    this.named(name);
    const answer = await given(this.ctx, this.port, 'CreateInternetGateway', nameTag('internet-gateway', name));
    const id = this.id(answer, `the internet gateway ${name}`, 'internetGateway', 'internetGatewayId');
    this.gateways.add(id);
    return id;
  }

  /** `AttachInternetGateway`. */
  async attach(gatewayId: string, vpcId: string): Promise<void> {
    await given(this.ctx, this.port, 'AttachInternetGateway', { InternetGatewayId: gatewayId, VpcId: vpcId });
  }

  /** `CreateRouteTable` in `vpcId`, named `name`; its id. */
  async routeTable(vpcId: string, name: string): Promise<string> {
    this.named(name);
    const answer = await given(this.ctx, this.port, 'CreateRouteTable', {
      VpcId: vpcId,
      ...nameTag('route-table', name),
    });
    return this.id(answer, `the route table ${name}`, 'routeTable', 'routeTableId');
  }

  /** `CreateRoute destination` to the internet gateway `gatewayId` in `routeTableId`. */
  async route(routeTableId: string, destination: string, gatewayId: string): Promise<void> {
    await given(this.ctx, this.port, 'CreateRoute', {
      RouteTableId: routeTableId,
      DestinationCidrBlock: destination,
      GatewayId: gatewayId,
    });
  }

  /** `AssociateRouteTable` of `subnetId`; the association's id. */
  async associate(routeTableId: string, subnetId: string): Promise<string> {
    const answer = await given(this.ctx, this.port, 'AssociateRouteTable', {
      RouteTableId: routeTableId,
      SubnetId: subnetId,
    });
    return this.id(answer, `the association of ${subnetId}`, 'associationId');
  }

  /** `CreateSecurityGroup name` in `vpcId`; its id. */
  async group(vpcId: string, name: string): Promise<string> {
    this.named(name);
    const answer = await given(this.ctx, this.port, 'CreateSecurityGroup', {
      GroupName: name,
      GroupDescription: `Of ${name}`,
      VpcId: vpcId,
    });
    return this.id(answer, `the security group ${name}`, 'groupId');
  }

  /** A private NAT gateway in `subnetId` (`CreateNatGateway ConnectivityType private`); its id. */
  async natGateway(subnetId: string): Promise<string> {
    const answer = await given(this.ctx, this.port, 'CreateNatGateway', {
      SubnetId: subnetId,
      ConnectivityType: 'private',
    });
    return this.id(answer, `the NAT gateway in ${subnetId}`, 'natGateway', 'natGatewayId');
  }

  /** An x86_64 Linux image of the emulator's catalogue, read once. */
  private async linuxImage(): Promise<string> {
    if (this.image !== undefined) return this.image;
    const images = await given(this.ctx, this.port, 'DescribeImages', {
      ...filterParams({ architecture: 'x86_64' }),
      MaxResults: '50',
    });
    const image = items(images.root, 'imagesSet')
      .map((node) => ({ id: textAt(node, 'imageId') ?? '', platform: textAt(node, 'platformDetails') ?? '' }))
      .find((each) => each.id !== '' && each.platform.startsWith('Linux'));
    if (image === undefined) throw new EnvError('the emulator lists no x86_64 Linux image');
    this.image = image.id;
    return image.id;
  }

  /** `RunInstances` of one `t3.micro` of a Linux image into `subnetId`, waited for until it is `running`; its id. */
  async instance(name: string, subnetId: string): Promise<string> {
    this.named(name);
    const answer = await given(this.ctx, this.port, 'RunInstances', {
      ImageId: await this.linuxImage(),
      InstanceType: 't3.micro',
      MinCount: '1',
      MaxCount: '1',
      SubnetId: subnetId,
      ...nameTag('instance', name),
    });
    const id = textAt(items(answer.root, 'instancesSet')[0], 'instanceId');
    if (id === undefined || id === '') throw new EnvError(`the emulator gave the instance ${name} no id`);
    if (!(await reportsInstanceState(this.ctx, this.port, id, 'running'))) {
      throw new EnvError(`the instance ${id} did not reach running`);
    }
    return id;
  }

  /**
   * Removes everything of the check from the emulator, those Studio's actions made included, in the order the
   * criteria name: what is in a VPC named under the prefix is found by that VPC's `vpc-id`.
   */
  async dispose(): Promise<void> {
    const { ctx, port } = this;
    const step = async (what: string, body: () => Promise<void>) => {
      try {
        await body();
      } catch (e) {
        ctx.log(`cleanup of ${what} failed: ${(e as Error).message}`);
      }
    };
    const vpcs = new Set(this.vpcs);
    await step(`the VPCs ${this.prefix}*`, async () => {
      for (const each of await vpcsDirect(ctx, port, { 'tag:Name': `${this.prefix}*` })) vpcs.add(each.id);
    });
    const ids = [...vpcs];
    if (ids.length > 0) {
      await step('the instances', async () => {
        const live = (await instancesDirect(ctx, port, { 'vpc-id': ids })).filter((each) => each.state !== 'terminated');
        for (const each of live) await ec2(ctx, port, 'TerminateInstances', { 'InstanceId.1': each.id });
        for (const each of live) await reportsInstanceState(ctx, port, each.id, 'terminated');
      });
      await step('the NAT gateways', async () => {
        const live = (await natGatewayStates(ctx, port, { 'vpc-id': ids })).filter((each) => each.state !== 'deleted');
        for (const each of live) await ec2(ctx, port, 'DeleteNatGateway', { NatGatewayId: each.id });
        for (const each of live) await reportsNatGatewayState(ctx, port, each.id, 'deleted');
      });
      await step('the associations and the route tables', async () => {
        for (const table of await routeTablesDirect(ctx, port, { 'vpc-id': ids })) {
          for (const each of table.associations) {
            if (!each.main) await ec2(ctx, port, 'DisassociateRouteTable', { AssociationId: each.id });
          }
          if (!table.main) await ec2(ctx, port, 'DeleteRouteTable', { RouteTableId: table.id });
        }
      });
    }
    await step('the internet gateways', async () => {
      const found = new Map<string, DirectGateway>();
      const add = (gateways: DirectGateway[]) => {
        for (const each of gateways) found.set(each.id, each);
      };
      if (ids.length > 0) add(await gatewaysDirect(ctx, port, { 'attachment.vpc-id': ids }));
      add(await gatewaysDirect(ctx, port, { 'tag:Name': `${this.prefix}*` }));
      for (const id of this.gateways) {
        const gateway = await gatewayDirect(ctx, port, id);
        if (gateway !== null) add([gateway]);
      }
      for (const gateway of found.values()) {
        for (const vpcId of gateway.vpcIds) {
          await ec2(ctx, port, 'DetachInternetGateway', { InternetGatewayId: gateway.id, VpcId: vpcId });
        }
        await ec2(ctx, port, 'DeleteInternetGateway', { InternetGatewayId: gateway.id });
      }
    });
    if (ids.length === 0) return;
    await step('the security groups', async () => {
      const groups = await described(ctx, port, 'DescribeSecurityGroups', 'securityGroupInfo', { 'vpc-id': ids });
      for (const group of groups) {
        if (textAt(group, 'groupName') === 'default') continue;
        await ec2(ctx, port, 'DeleteSecurityGroup', { GroupId: textAt(group, 'groupId') ?? '' });
      }
    });
    await step('the subnets', async () => {
      for (const each of await subnetsDirect(ctx, port, { 'vpc-id': ids })) {
        await ec2(ctx, port, 'DeleteSubnet', { SubnetId: each.id });
      }
    });
    await step('the VPCs', async () => {
      for (const id of ids) await ec2(ctx, port, 'DeleteVpc', { VpcId: id });
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens' words.
// ---------------------------------------------------------------------------------------------------------------

export const VPC_PATH = '/aws/vpc';
export const VPCS_PATH = '/aws/vpc/vpcs';
export const CREATE_VPC_PATH = '/aws/vpc/vpcs/create';
export const SUBNETS_PATH = '/aws/vpc/subnets';
export const CREATE_SUBNET_PATH = '/aws/vpc/subnets/create';
export const ROUTE_TABLES_PATH = '/aws/vpc/route-tables';
export const CREATE_ROUTE_TABLE_PATH = '/aws/vpc/route-tables/create';
export const GATEWAYS_PATH = '/aws/vpc/internet-gateways';
export const CREATE_GATEWAY_PATH = '/aws/vpc/internet-gateways/create';
export function vpcPath(id: string): string {
  return `${VPCS_PATH}/vpc/${encodeURIComponent(id)}`;
}
export function subnetPath(id: string): string {
  return `${SUBNETS_PATH}/subnet/${encodeURIComponent(id)}`;
}
export function createSubnetPath(vpcId: string): string {
  return `${CREATE_SUBNET_PATH}?vpc=${encodeURIComponent(vpcId)}`;
}
export function routeTablePath(id: string): string {
  return `${ROUTE_TABLES_PATH}/route-table/${encodeURIComponent(id)}`;
}
export function createRouteTablePath(vpcId: string): string {
  return `${CREATE_ROUTE_TABLE_PATH}?vpc=${encodeURIComponent(vpcId)}`;
}
export function addRoutePath(id: string): string {
  return `${routeTablePath(id)}/add-route`;
}
export function associateSubnetPath(id: string): string {
  return `${routeTablePath(id)}/associate-subnet`;
}
export function attachGatewayPath(id: string): string {
  return `${GATEWAYS_PATH}/gateway/${encodeURIComponent(id)}/attach`;
}

export const VPCS_H1 = 'VPCs';
export const CREATE_VPC = 'Create VPC';
export const SUBNETS_H1 = 'Subnets';
export const CREATE_SUBNET = 'Create subnet';
export const ROUTE_TABLES_H1 = 'Route tables';
export const CREATE_ROUTE_TABLE = 'Create route table';
export const ADD_ROUTE = 'Add route';
export const ASSOCIATE_SUBNET = 'Associate subnet';
export const GATEWAYS_H1 = 'Internet gateways';
export const CREATE_GATEWAY = 'Create internet gateway';
export const ATTACH_GATEWAY = 'Attach internet gateway';
export const ATTACH = 'Attach';
export const DETACH = 'Detach';
export const DISASSOCIATE = 'Disassociate';
export const DELETE = 'Delete';
export const DELETE_VPC = 'Delete VPC';
export const DELETE_SUBNET = 'Delete subnet';
export const DELETE_ROUTE_TABLE = 'Delete route table';
export const DELETE_ROUTE = 'Delete route';
export const CANCEL = 'Cancel';
export const REFRESH = 'Refresh';
export const CLEAR_FILTER = 'Clear filter';
export const TURN_ON = 'Turn on';
export const TURN_OFF = 'Turn off';
export const NONE = '-';
export const NAME = 'Name - optional';
export const BLOCK = 'IPv4 CIDR block';
export const VPC_FIELD = 'VPC';
export const ZONE_FIELD = 'Availability Zone - optional';
export const CHOSEN_BY_EMULATOR = 'Chosen by the emulator';
export const DESTINATION = 'Destination';
export const SUBNET_FIELD = 'Subnet';
export const PUBLIC_ON_LAUNCH = 'Public IPv4 address on launch';
export const NO_VPCS_MATCH = 'No VPCs match';
export const NO_SUBNETS = 'No subnets';
export const NO_SUBNET_ASSOCIATIONS = 'No subnet associations';
export const NO_GATEWAY_ATTACHED = 'No internet gateway is attached to this VPC.';
export const VPC_NOT_FOUND = 'VPC not found';
export const VIEW_VPCS = 'View VPCs';
export const SUBNET_NOT_FOUND = 'Subnet not found';
export const VIEW_SUBNETS = 'View subnets';
export const ROUTE_TABLE_NOT_FOUND = 'Route table not found';
export const VIEW_ROUTE_TABLES = 'View route tables';
export const GATEWAY_NOT_FOUND = 'Internet gateway not found';
export const VIEW_GATEWAYS = 'View internet gateways';
export const SIZE_RULE = "The block's size must be from /16 to /28.";
export const VPC_BLOCK_RULE = 'Enter an IPv4 block in CIDR notation, such as 10.0.0.0/16.';
export const DESTINATION_RULE = 'Enter an IPv4 block in CIDR notation, such as 0.0.0.0/0.';
export const CHOOSE_A_VPC = 'Choose a VPC.';
export const CHOOSE_A_SUBNET = 'Choose a subnet.';
export const SELECT_ONE_SUBNET = 'Select one subnet.';
export const SELECT_ONE_ASSOCIATION = 'Select one association.';
export const MAIN_TABLE_STAYS = "A VPC's main route table cannot be deleted.";
export const LOCAL_ROUTE_STAYS = 'The local route cannot be deleted.';
export const NOT_ATTACHED = 'This gateway is not attached.';
export const ALREADY_ATTACHED = 'This gateway is already attached.';
export const DETACH_FIRST = 'Detach the gateway before deleting it.';
export const SUBNET_IN_USE =
  'The emulator refuses while something is in the subnet, such as an instance or a NAT gateway.';
export const VPC_IN_USE =
  'The emulator refuses while the VPC holds a subnet, an attached internet gateway or a security group other than default.';
export const ROUTES_TURN_BLACKHOLE = 'Routes that lead to it stay in their route tables and turn to blackhole.';
export const APPLIES_AS = 'Applies as';
export const ASSOCIATED_WITH_SUBNET = 'Associated with this subnet';
export const VPCS_MAIN_TABLE = "The VPC's main route table";
export const ROUTES_OF_TABLE = 'Routes of the route table';
export const DISCARD_HEADER = 'Discard what you entered?';
export const KEEP_EDITING = 'Keep editing';
export const DISCARD = 'Discard';

/** IDs of the right form that the emulator does not hold. */
export const NO_SUCH = {
  vpc: 'vpc-0fedcba9876543210',
  subnet: 'subnet-0fedcba9876543210',
  routeTable: 'rtb-0fedcba9876543210',
  gateway: 'igw-0fedcba9876543210',
};


// ---------------------------------------------------------------------------------------------------------------
// Readers.
// ---------------------------------------------------------------------------------------------------------------

const wrapper = createWrapper();
/** A selector of Cloudscape's, usable inside a scoped locator (no leading `body`). */
function rel(selector: { toSelector(): string }): string {
  return selector.toSelector().replace(/^body /, '');
}
/** The part of a selector below its component's root, for a locator that is that root. */
function inside(selector: { toSelector(): string }): string {
  return rel(selector).replace(/^\[class\*="awsui_root_\w+"\] /, '');
}

export const TABLE = rel(wrapper.findTable());
const TABLE_ROWS = inside(wrapper.findTable().findRows());
const TABLE_HEADERS = inside(wrapper.findTable().findColumnHeaders());
const TABLE_EMPTY = inside(wrapper.findTable().findEmptySlot());
const TABLE_FILTER = inside(wrapper.findTable().findTextFilter().findInput().findNativeInput());
const ALERT = rel(wrapper.findAlert());
const MODAL = rel(wrapper.findModal());
const FORM_FIELD = rel(wrapper.findFormField());
const FORM_FIELD_LABEL = inside(wrapper.findFormField().findLabel());
const FORM_FIELD_ERROR = inside(wrapper.findFormField().findError());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_FILTER = inside(wrapper.findSelect().findFilteringInput().findNativeInput());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
/** An option of a select or a multiselect by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}

const escaped = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens `path` and waits for its `h1` `name`. */
export async function open(page: Page, path: string, h1: string): Promise<void> {
  await page.goto(path);
  await expect(heading(page, h1), `the h1 "${h1}" at ${path}`).toBeVisible({ timeout: 15_000 });
}

/**
 * The data rows of the Cloudscape table `table` as shown, each a record of its column headings' texts to its cells'
 * texts; the selection column, whose heading has no text, is left out.
 */
export async function rowsOf(table: Locator): Promise<Record<string, string>[]> {
  return table.evaluate(
    (root, sel) => {
      const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
      const headers = [...root.querySelectorAll(sel.headers)].map((th) => norm(th.textContent));
      const rows: Record<string, string>[] = [];
      for (const tr of root.querySelectorAll(sel.rows)) {
        const cells = [...tr.children];
        const row: Record<string, string> = {};
        cells.forEach((cell, i) => {
          const header = headers[i] ?? '';
          if (header !== '') row[header] = norm(cell.textContent);
        });
        rows.push(row);
      }
      return rows;
    },
    { headers: TABLE_HEADERS, rows: TABLE_ROWS },
  );
}

/** Waits until the table shows exactly the rows whose `column` values are `want`, in any order; returns the rows. */
export async function expectRows(
  table: Locator,
  column: string,
  want: string[],
  what: string,
): Promise<Record<string, string>[]> {
  await expect
    .poll(async () => (await rowsOf(table)).map((row) => row[column] ?? '').sort(), { message: what, timeout: 30_000 })
    .toEqual([...want].sort());
  return rowsOf(table);
}

/** Waits until the row whose `column` is `value` shows `want` under `other`. */
export async function expectCell(
  table: Locator,
  column: string,
  value: string,
  other: string,
  want: string,
): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(table)).find((row) => row[column] === value)?.[other], {
      message: `"${other}" of the row ${value} reads "${want}"`,
      timeout: STATE_BOUND_MS,
    })
    .toBe(want);
}

/** Selects the row of `table` whose `column` is `value`, by its selection control. */
export async function selectRow(table: Locator, column: string, value: string): Promise<void> {
  const index = (await rowsOf(table)).findIndex((row) => row[column] === value);
  if (index < 0) throw new Error(`the table shows no row whose "${column}" is ${value}`);
  await table.locator(inside(wrapper.findTable().findRowSelectionArea(index + 1))).click(ACTION);
}

/** Types `text` in the table's find field. */
export async function findBy(table: Locator, text: string): Promise<void> {
  await table.locator(TABLE_FILTER).fill(text, ACTION);
}

/** The table's find field. */
export function filterOf(table: Locator): Locator {
  return table.locator(TABLE_FILTER);
}

/** The table's empty slot (its "No …" words and their action). */
export function emptyOf(table: Locator): Locator {
  return table.locator(TABLE_EMPTY);
}

/** The text of the value of `label` in the key-value pairs inside `scope`; `null` when it has no such label. */
export async function valueOf(scope: Locator, label: string): Promise<string | null> {
  return scope.evaluate((root, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    for (const dt of root.querySelectorAll('dt')) {
      if (norm(dt.textContent) !== wanted) continue;
      const dd = dt.nextElementSibling;
      return dd === null ? null : norm(dd.textContent);
    }
    return null;
  }, label);
}

/** The texts of the parts of the value of `label` inside `scope`, in order (each element that holds text alone). */
export async function valuePartsOf(scope: Locator, label: string): Promise<string[]> {
  return scope.evaluate((root, wanted) => {
    const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();
    for (const dt of root.querySelectorAll('dt')) {
      if (norm(dt.textContent) !== wanted) continue;
      const dd = dt.nextElementSibling;
      if (dd === null) return [];
      return [...dd.querySelectorAll('*')]
        .filter((each) => each.childElementCount === 0)
        .map((each) => norm(each.textContent))
        .filter((text) => text !== '');
    }
    return [];
  }, label);
}

/** Waits until the value of `label` on the page holds `want`. */
export async function expectValue(page: Page, label: string, want: string): Promise<void> {
  await expect
    .poll(() => valueOf(page.getByRole('main'), label), { message: `"${label}" holds "${want}"`, timeout: STATE_BOUND_MS })
    .toContain(want);
}

/** Waits until the value of `label` on the page is exactly `want`. */
export async function expectValueIs(page: Page, label: string, want: string): Promise<void> {
  await expect
    .poll(() => valueOf(page.getByRole('main'), label), { message: `"${label}" is "${want}"`, timeout: STATE_BOUND_MS })
    .toBe(want);
}

type FlashType = 'success' | 'error' | 'info' | 'warning';

/** Waits until one flash item of `type` holds every text of `texts`; the items' texts are read and compared. */
export async function expectFlash(page: Page, type: FlashType, ...texts: string[]): Promise<void> {
  const items = page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
  await expect
    .poll(async () => (await items.allTextContents()).filter((text) => texts.every((each) => text.includes(each))).length, {
      message: `one ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`,
      timeout: 20_000,
    })
    .toBe(1);
}

/** The open dialog. */
export function dialogOf(page: Page): Locator {
  return page.locator(MODAL).filter({ visible: true });
}

/** Confirms the open dialog by typing `word` and choosing `action`. */
export async function confirmWith(page: Page, word: string, action: string): Promise<void> {
  const dialog = dialogOf(page);
  await expect(dialog, 'the confirmation dialog').toBeVisible();
  await dialog.getByRole('textbox').fill(word, ACTION);
  await dialog.getByRole('button', { name: action, exact: true }).click(ACTION);
}

/** Closes the open dialog with its "Cancel". */
export async function cancelDialog(page: Page): Promise<void> {
  const dialog = dialogOf(page);
  await expect(dialog, 'the dialog').toBeVisible();
  await dialog.getByRole('button', { name: CANCEL, exact: true }).click(ACTION);
  await expect(dialog, 'the dialog after "Cancel"').toHaveCount(0);
}

/** Whether a request the page sent is the EC2 action `action` (the action is in the body). */
function isAction(postData: string | null, action: string): boolean {
  return postData !== null && new URLSearchParams(postData).get('Action') === action;
}

/** Counts, from now on, the requests of the EC2 action `action` that leave the page. */
export function countActions(page: Page, action: string): { count: () => number } {
  let seen = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && isAction(request.postData(), action)) seen++;
  });
  return { count: () => seen };
}

/** A button of `scope` by its name. */
export function button(scope: Locator | Page, name: string): Locator {
  return scope.getByRole('button', { name, exact: true });
}

/** Asserts that `control` is unavailable and says `reason`. */
export async function expectUnavailable(control: Locator, reason: string | null, what: string): Promise<void> {
  await expect(control, `${what} is unavailable`).toBeDisabled({ timeout: 15_000 });
  if (reason !== null) await expect(control, `the reason of ${what}`).toHaveAccessibleDescription(reason);
}

/** The form field of `scope` whose label is exactly `label`. */
export function field(scope: Locator, label: string): Locator {
  return scope
    .locator(FORM_FIELD)
    .filter({ has: scope.page().locator(FORM_FIELD_LABEL).filter({ hasText: new RegExp(`^${escaped(label)}$`) }) })
    .last();
}

/** The error a form field shows. */
export function errorOf(formField: Locator): Locator {
  return formField.locator(FORM_FIELD_ERROR);
}

/**
 * In the select of `formField`: opens it, types `typed` in its find field when given, and chooses the option whose
 * value is `value`.
 */
export async function chooseOption(formField: Locator, value: string, typed?: string): Promise<void> {
  const select = formField.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  if (typed !== undefined) await select.locator(SELECT_FILTER).fill(typed, ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/** The select of `formField`, for what it shows as chosen. */
export function selectOf(formField: Locator): Locator {
  return formField.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** The alert a form shows for a refusal holding `text`. */
export function alertWith(scope: Locator, text: string): Locator {
  return scope.locator(ALERT).filter({ hasText: text });
}

const HEADER_TEXT = rel(wrapper.findHeader().findHeadingText());

/** The table of `main` whose header's heading text is `name` (a container table of a page of one resource). */
export function tableOf(main: Locator, name: string): Locator {
  return main.locator(TABLE).filter({
    has: main.page().locator(HEADER_TEXT).filter({ hasText: new RegExp(`^\\s*${escaped(name)}\\s*$`) }),
  });
}

// --- Readers of VPC's screens ---

const FORM_FIELD_WARNING = inside(wrapper.findFormField().findWarning());

/** The warning a form field shows. */
export function warningOf(formField: Locator): Locator {
  return formField.locator(FORM_FIELD_WARNING);
}

/** The list of a list page: the first table of `main`. */
export function listOf(page: Page): Locator {
  return page.getByRole('main').locator(TABLE).first();
}

/** Waits until `table` shows a row whose `column` is `value`; that row. */
export async function expectRow(table: Locator, column: string, value: string): Promise<Record<string, string>> {
  await expect
    .poll(async () => (await rowsOf(table)).some((row) => row[column] === value), {
      message: `a row whose "${column}" is ${value}`,
      timeout: STATE_BOUND_MS,
    })
    .toBe(true);
  const row = (await rowsOf(table)).find((each) => each[column] === value);
  if (row === undefined) throw new Error(`the row whose "${column}" is ${value} went again`);
  return row;
}

/** Waits until `table` shows no row whose `column` is `value`. */
export async function expectNoRow(table: Locator, column: string, value: string): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(table)).some((row) => row[column] === value), {
      message: `no row whose "${column}" is ${value}`,
      timeout: STATE_BOUND_MS,
    })
    .toBe(false);
}

/** Waits until the first part of the value of `label` on the page (its own text, before a sentence) is `want`. */
export async function expectFirstPart(page: Page, label: string, want: string): Promise<void> {
  await expect
    .poll(async () => (await valuePartsOf(page.getByRole('main'), label))[0], {
      message: `"${label}" reads "${want}"`,
      timeout: STATE_BOUND_MS,
    })
    .toBe(want);
}

/** A link of `scope` by its name. */
export function link(scope: Locator | Page, name: string): Locator {
  return scope.getByRole('link', { name, exact: true });
}

/** The textbox of the form field `label` of the page. */
export function entry(page: Page, label: string): Locator {
  return field(page.getByRole('main'), label).getByRole('textbox');
}

/** The table of `main` that holds the table labelled `label` (a table without a header of its own). */
export function tableLabelled(main: Locator, label: string): Locator {
  return main.locator(TABLE).filter({ has: main.page().getByRole('table', { name: label, exact: true }) });
}

/** The last segment of the page's address, decoded: the id a page of one resource is at. */
export function idOfAddress(page: Page): string {
  return decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1) ?? '');
}

/**
 * In the select of `formField`: opens it, types `typed` in its find field when given, and waits for the option whose
 * value is `value`; that option, still to be chosen (for a line that asserts what the choice shows).
 */
export async function openOption(formField: Locator, value: string, typed?: string): Promise<Locator> {
  const select = formField.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  if (typed !== undefined) await select.locator(SELECT_FILTER).fill(typed, ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  return option;
}

/**
 * Types `name` in the list's find field and waits until the list shows the row of that name alone: the filter is
 * then applied, and a selection made after it stays (a list drops its selection when its filter changes).
 */
export async function findOnly(table: Locator, name: string): Promise<void> {
  await findBy(table, name);
  await expectRows(table, 'Name', [name], `the row ${name} alone`);
}
