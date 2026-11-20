// The emulator side and the words of EC2's screens (test-criteria.md, issue 553), for the `ec2-*.spec.ts` checks.
//
// - Direct calls: `directEc2` of `support/aws-clients-general.ts` (the EC2 query protocol, XML answers), straight to
//   the emulator, SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`, never through
//   the engine.
// - `Ec2Seeded`: the key pairs, security groups, VPCs, subnets and instances a check makes, every one named under the
//   check's prefix `<p>` (an instance by its tag `Name`). When the check ends it removes all of the emulator's under
//   `<p>`, those Studio's actions made included, in the order of test-criteria.md: termination protection off, the
//   instances terminated and `terminated` waited for, the groups' rules that name another group revoked and the
//   groups deleted, the subnets, the VPCs, the key pairs.
// - The screens' words (requirement.md, "EmuForge's own text") and readers of what a screen shows. What is inside a
//   Cloudscape component (a select's options, a table's rows and cells, a flash, a modal) is found with Cloudscape's
//   own test selectors, an option by its value; a reader waits for the settled screen.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import { generateKeyPairSync } from 'node:crypto';

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

// --- Instances ---

/** An instance as `DescribeInstances` gives it. */
export interface DirectInstance {
  id: string;
  state: string;
  stateReason: string | undefined;
  type: string;
  imageId: string;
  keyName: string | undefined;
  zone: string | undefined;
  subnetId: string | undefined;
  vpcId: string | undefined;
  privateIp: string | undefined;
  publicIp: string | undefined;
  privateDns: string | undefined;
  publicDns: string | undefined;
  architecture: string | undefined;
  groups: { id: string; name: string }[];
  volumes: { device: string; volumeId: string; deleteOnTermination: string }[];
  tags: Record<string, string>;
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}

function instanceOf(node: Xml): DirectInstance {
  const tags: Record<string, string> = {};
  for (const tag of items(node, 'tagSet')) tags[textAt(tag, 'key') ?? ''] = textAt(tag, 'value') ?? '';
  return {
    id: textAt(node, 'instanceId') ?? '',
    state: textAt(node, 'instanceState', 'name') ?? '',
    stateReason: present(textAt(node, 'stateReason', 'message')),
    type: textAt(node, 'instanceType') ?? '',
    imageId: textAt(node, 'imageId') ?? '',
    keyName: present(textAt(node, 'keyName')),
    zone: present(textAt(node, 'placement', 'availabilityZone')),
    subnetId: present(textAt(node, 'subnetId')),
    vpcId: present(textAt(node, 'vpcId')),
    privateIp: present(textAt(node, 'privateIpAddress')),
    publicIp: present(textAt(node, 'ipAddress')),
    privateDns: present(textAt(node, 'privateDnsName')),
    publicDns: present(textAt(node, 'dnsName')),
    architecture: present(textAt(node, 'architecture')),
    groups: items(node, 'groupSet').map((g) => ({ id: textAt(g, 'groupId') ?? '', name: textAt(g, 'groupName') ?? '' })),
    volumes: items(node, 'blockDeviceMapping').map((b) => ({
      device: textAt(b, 'deviceName') ?? '',
      volumeId: textAt(b, 'ebs', 'volumeId') ?? '',
      deleteOnTermination: textAt(b, 'ebs', 'deleteOnTermination') ?? '',
    })),
    tags,
  };
}

/** The instances `DescribeInstances` answers for `filters`, every page. */
export async function instancesDirect(
  ctx: Ctx,
  port: number,
  filters: Record<string, string | string[]>,
): Promise<DirectInstance[]> {
  const reservations = await everyPage(ctx, port, 'DescribeInstances', 'reservationSet', filterParams(filters), true);
  return reservations.flatMap((reservation) => items(reservation, 'instancesSet').map(instanceOf));
}

/** The instance `id` by the filter `instance-id`; `null` when the emulator holds none. */
export async function instanceDirect(ctx: Ctx, port: number, id: string): Promise<DirectInstance | null> {
  return (await instancesDirect(ctx, port, { 'instance-id': id }))[0] ?? null;
}

/** The instances whose tag `Name` is exactly `name`. */
export async function instancesNamed(ctx: Ctx, port: number, name: string): Promise<DirectInstance[]> {
  return instancesDirect(ctx, port, { 'tag:Name': name });
}

/** How long a check waits for a state the emulator moves by itself. */
export const STATE_BOUND_MS = 30_000;

/** Waits, with a bound, until the emulator reports the instance `id` in `state`; whether it did. */
export async function reportsState(ctx: Ctx, port: number, id: string, state: string): Promise<boolean> {
  const found = await waitFor(STATE_BOUND_MS, async () =>
    (await instanceDirect(ctx, port, id))?.state === state ? true : undefined,
  );
  ctx.log(`the emulator ${found ? 'reports' : 'does not report'} ${id} as ${state}`);
  return found === true;
}

// --- Security groups ---

export interface DirectGroup {
  id: string;
  name: string;
  description: string;
  vpcId: string;
  arn: string | undefined;
}

function groupOf(node: Xml): DirectGroup {
  return {
    id: textAt(node, 'groupId') ?? '',
    name: textAt(node, 'groupName') ?? '',
    description: textAt(node, 'groupDescription') ?? '',
    vpcId: textAt(node, 'vpcId') ?? '',
    arn: present(textAt(node, 'securityGroupArn')),
  };
}

/** The security groups `DescribeSecurityGroups` answers for `filters`. */
export async function groupsDirect(
  ctx: Ctx,
  port: number,
  filters: Record<string, string | string[]> = {},
): Promise<DirectGroup[]> {
  return (await everyPage(ctx, port, 'DescribeSecurityGroups', 'securityGroupInfo', filterParams(filters), false)).map(
    groupOf,
  );
}

/** The security groups named exactly `name`, in any VPC. */
export async function groupsNamed(ctx: Ctx, port: number, name: string): Promise<DirectGroup[]> {
  return groupsDirect(ctx, port, { 'group-name': name });
}

/** The security group `id`; `null` when the emulator holds none (`InvalidGroup.NotFound`). */
export async function groupDirect(ctx: Ctx, port: number, id: string): Promise<DirectGroup | null> {
  const answer = await ec2(ctx, port, 'DescribeSecurityGroups', { 'GroupId.1': id });
  if (answer.code === 'InvalidGroup.NotFound') return null;
  if (answer.status !== 200) throw new Error(`direct DescribeSecurityGroups ${id} answered ${String(answer.status)}`);
  const found = items(answer.root, 'securityGroupInfo')[0];
  return found === undefined ? null : groupOf(found);
}

/** A rule as `DescribeSecurityGroupRules` gives it. */
export interface DirectRule {
  id: string;
  egress: boolean;
  protocol: string;
  from: string | undefined;
  to: string | undefined;
  cidr4: string | undefined;
  cidr6: string | undefined;
  group: string | undefined;
  description: string | undefined;
}

/** Every rule of the security group `id`. */
export async function rulesDirect(ctx: Ctx, port: number, id: string): Promise<DirectRule[]> {
  const found = await everyPage(
    ctx,
    port,
    'DescribeSecurityGroupRules',
    'securityGroupRuleSet',
    filterParams({ 'group-id': id }),
    true,
  );
  return found.map((node) => ({
    id: textAt(node, 'securityGroupRuleId') ?? '',
    egress: textAt(node, 'isEgress') === 'true',
    protocol: textAt(node, 'ipProtocol') ?? '',
    from: present(textAt(node, 'fromPort')),
    to: present(textAt(node, 'toPort')),
    cidr4: present(textAt(node, 'cidrIpv4')),
    cidr6: present(textAt(node, 'cidrIpv6')),
    group: present(textAt(node, 'referencedGroupInfo', 'groupId')),
    description: present(textAt(node, 'description')),
  }));
}

// --- Key pairs ---

export interface DirectKeyPair {
  name: string;
  id: string;
  type: string;
  fingerprint: string;
}

/** Every key pair of the emulator, and the answer's body as it came (to see that it holds no private key). */
export async function keyPairsDirect(ctx: Ctx, port: number): Promise<{ pairs: DirectKeyPair[]; body: string }> {
  const answer = await ec2(ctx, port, 'DescribeKeyPairs');
  if (answer.status !== 200) throw new Error(`direct DescribeKeyPairs answered ${String(answer.status)}`);
  const pairs = items(answer.root, 'keySet').map((node) => ({
    name: textAt(node, 'keyName') ?? '',
    id: textAt(node, 'keyPairId') ?? '',
    type: textAt(node, 'keyType') ?? '',
    fingerprint: textAt(node, 'keyFingerprint') ?? '',
  }));
  return { pairs, body: answer.body };
}

/** The key pair `name` as the emulator reports it, or `null`. */
export async function keyPairDirect(ctx: Ctx, port: number, name: string): Promise<DirectKeyPair | null> {
  return (await keyPairsDirect(ctx, port)).pairs.find((each) => each.name === name) ?? null;
}

/** A public key in OpenSSH format (`ssh-ed25519 <base64> <comment>`), made here for this check alone. */
export function openSshPublicKey(comment: string): string {
  const { publicKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(-32);
  const part = (data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    return Buffer.concat([length, data]);
  };
  const blob = Buffer.concat([part(Buffer.from('ssh-ed25519')), part(raw)]);
  return `ssh-ed25519 ${blob.toString('base64')} ${comment}`;
}

// --- The default world ---

export interface DirectSubnet {
  id: string;
  vpcId: string;
  zone: string;
  defaultForAz: boolean;
}

/** Every subnet of the emulator. */
export async function subnetsDirect(ctx: Ctx, port: number): Promise<DirectSubnet[]> {
  return (await everyPage(ctx, port, 'DescribeSubnets', 'subnetSet', {}, false)).map((node) => ({
    id: textAt(node, 'subnetId') ?? '',
    vpcId: textAt(node, 'vpcId') ?? '',
    zone: textAt(node, 'availabilityZone') ?? '',
    defaultForAz: textAt(node, 'defaultForAz') === 'true',
  }));
}

/** What a check launches with, read from the emulator: the default VPC, its subnets by zone, an image, a type. */
export interface World {
  defaultVpc: string;
  /** The default subnet of each zone of the default VPC, by the zone's name. */
  subnet: Record<string, string>;
  /** An x86_64 Linux image of the catalogue that has a name. */
  image: { id: string; name: string };
  type: string;
}

/** Reads the default world; an `EnvError` when the emulator lacks a part of it. */
export async function world(ctx: Ctx, port: number): Promise<World> {
  const vpcs = await given(ctx, port, 'DescribeVpcs', filterParams({ 'is-default': 'true' }));
  const defaultVpc = textAt(items(vpcs.root, 'vpcSet')[0], 'vpcId');
  if (defaultVpc === undefined) throw new EnvError('the emulator has no default VPC');
  const subnet: Record<string, string> = {};
  for (const each of await subnetsDirect(ctx, port)) {
    if (each.vpcId === defaultVpc && each.defaultForAz) subnet[each.zone] = each.id;
  }
  for (const zone of ['us-east-1a', 'us-east-1b', 'us-east-1c']) {
    if (subnet[zone] === undefined) throw new EnvError(`the emulator has no default subnet in ${zone}`);
  }
  const images = await given(ctx, port, 'DescribeImages', {
    ...filterParams({ architecture: 'x86_64' }),
    MaxResults: '50',
  });
  const image = items(images.root, 'imagesSet')
    .map((node) => ({
      id: textAt(node, 'imageId') ?? '',
      name: textAt(node, 'name') ?? '',
      platform: textAt(node, 'platformDetails') ?? '',
    }))
    .find((each) => each.name !== '' && each.platform.startsWith('Linux'));
  if (image === undefined) throw new EnvError('the emulator lists no x86_64 Linux image with a name');
  return { defaultVpc, subnet, image: { id: image.id, name: image.name }, type: 't3.micro' };
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** One permission of a rule a check adds directly. */
export interface Permission {
  protocol: string;
  from?: number;
  to?: number;
  cidr4?: string;
  cidr6?: string;
  group?: string;
  description?: string;
}

/** What a check launches directly. */
export interface Launch {
  name: string;
  subnetId?: string;
  keyName?: string;
  groupIds?: string[];
  tags?: Record<string, string>;
  protection?: boolean;
}

/**
 * The key pairs, groups, VPCs, subnets and instances a check makes directly on the emulator on `port`, each named
 * under the check's prefix. Making one that the emulator refuses is an environment failure: the check's Given would
 * not hold.
 */
export class Ec2Seeded {
  private readonly vpcs: string[] = [];
  private readonly subnets: string[] = [];

  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
    readonly world: World,
  ) {
    ctx.own(this);
  }

  private named(name: string): void {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
  }

  /** `CreateKeyPair name`; only its name is kept (the private key of the answer is dropped here). */
  async keyPair(name: string): Promise<string> {
    this.named(name);
    await given(this.ctx, this.port, 'CreateKeyPair', { KeyName: name, KeyType: 'ed25519' });
    return name;
  }

  /** `CreateSecurityGroup name` in `vpcId`, or the default VPC; its id. */
  async group(name: string, description: string, vpcId?: string): Promise<string> {
    this.named(name);
    const answer = await given(this.ctx, this.port, 'CreateSecurityGroup', {
      GroupName: name,
      GroupDescription: description,
      ...(vpcId === undefined ? {} : { VpcId: vpcId }),
    });
    const id = textAt(answer.root, 'groupId');
    if (id === undefined || id === '') throw new EnvError(`the emulator gave the group ${name} no id`);
    return id;
  }

  /** `AuthorizeSecurityGroupIngress` of one permission on the group `groupId`. */
  async ingress(groupId: string, permission: Permission): Promise<void> {
    const p = 'IpPermissions.1';
    const params: Record<string, string> = { GroupId: groupId, [`${p}.IpProtocol`]: permission.protocol };
    if (permission.from !== undefined) params[`${p}.FromPort`] = String(permission.from);
    if (permission.to !== undefined) params[`${p}.ToPort`] = String(permission.to);
    const describe = (at: string) => {
      if (permission.description !== undefined) params[`${at}.Description`] = permission.description;
    };
    if (permission.cidr4 !== undefined) {
      params[`${p}.IpRanges.1.CidrIp`] = permission.cidr4;
      describe(`${p}.IpRanges.1`);
    }
    if (permission.cidr6 !== undefined) {
      params[`${p}.Ipv6Ranges.1.CidrIpv6`] = permission.cidr6;
      describe(`${p}.Ipv6Ranges.1`);
    }
    if (permission.group !== undefined) {
      params[`${p}.Groups.1.GroupId`] = permission.group;
      describe(`${p}.Groups.1`);
    }
    await given(this.ctx, this.port, 'AuthorizeSecurityGroupIngress', params);
  }

  /** A VPC `cidr` with one subnet `subnetCidr` in `zone`, both of the check; their ids. */
  async vpcWithSubnet(cidr: string, subnetCidr: string, zone: string): Promise<{ vpcId: string; subnetId: string }> {
    const vpc = await given(this.ctx, this.port, 'CreateVpc', { CidrBlock: cidr });
    const vpcId = textAt(vpc.root, 'vpc', 'vpcId');
    if (vpcId === undefined || vpcId === '') throw new EnvError('the emulator gave the VPC no id');
    this.vpcs.push(vpcId);
    const subnet = await given(this.ctx, this.port, 'CreateSubnet', {
      VpcId: vpcId,
      CidrBlock: subnetCidr,
      AvailabilityZone: zone,
    });
    const subnetId = textAt(subnet.root, 'subnet', 'subnetId');
    if (subnetId === undefined || subnetId === '') throw new EnvError('the emulator gave the subnet no id');
    this.subnets.push(subnetId);
    return { vpcId, subnetId };
  }

  /** `RunInstances` of one instance of the world's image and type, waited for until it is `running`; its id. */
  async instance(launch: Launch): Promise<string> {
    this.named(launch.name);
    const params: Record<string, string> = {
      ImageId: this.world.image.id,
      InstanceType: this.world.type,
      MinCount: '1',
      MaxCount: '1',
      'TagSpecification.1.ResourceType': 'instance',
      'TagSpecification.1.Tag.1.Key': 'Name',
      'TagSpecification.1.Tag.1.Value': launch.name,
    };
    Object.entries(launch.tags ?? {}).forEach(([key, value], i) => {
      params[`TagSpecification.1.Tag.${String(i + 2)}.Key`] = key;
      params[`TagSpecification.1.Tag.${String(i + 2)}.Value`] = value;
    });
    if (launch.subnetId !== undefined) params.SubnetId = launch.subnetId;
    if (launch.keyName !== undefined) params.KeyName = launch.keyName;
    (launch.groupIds ?? []).forEach((id, i) => {
      params[`SecurityGroupId.${String(i + 1)}`] = id;
    });
    if (launch.protection === true) params.DisableApiTermination = 'true';
    const answer = await given(this.ctx, this.port, 'RunInstances', params);
    const id = textAt(items(answer.root, 'instancesSet')[0], 'instanceId');
    if (id === undefined || id === '') throw new EnvError(`the emulator gave the instance ${launch.name} no id`);
    if (!(await reportsState(this.ctx, this.port, id, 'running'))) {
      throw new EnvError(`the instance ${id} did not reach running`);
    }
    return id;
  }

  /** `StopInstances id`, waited for until it is `stopped`. */
  async stop(id: string): Promise<void> {
    await given(this.ctx, this.port, 'StopInstances', { 'InstanceId.1': id });
    if (!(await reportsState(this.ctx, this.port, id, 'stopped'))) {
      throw new EnvError(`the instance ${id} did not reach stopped`);
    }
  }

  /** Removes everything of the emulator under the check's prefix, in the order the criteria name. */
  async dispose(): Promise<void> {
    const { ctx, port } = this;
    const step = async (what: string, body: () => Promise<void>) => {
      try {
        await body();
      } catch (e) {
        ctx.log(`cleanup of ${what} failed: ${(e as Error).message}`);
      }
    };
    await step(`the instances ${this.prefix}*`, async () => {
      const live = (await instancesDirect(ctx, port, { 'tag:Name': `${this.prefix}*` })).filter(
        (each) => each.state !== 'terminated',
      );
      for (const each of live) {
        await ec2(ctx, port, 'ModifyInstanceAttribute', { InstanceId: each.id, 'DisableApiTermination.Value': 'false' });
        await ec2(ctx, port, 'TerminateInstances', { 'InstanceId.1': each.id });
      }
      for (const each of live) await reportsState(ctx, port, each.id, 'terminated');
    });
    await step(`the security groups ${this.prefix}*`, async () => {
      const groups = [
        ...(await groupsDirect(ctx, port, { 'group-name': `${this.prefix}*` })),
        ...(await groupsDirect(ctx, port, { 'group-name': `sg-${this.prefix}*` })),
      ];
      // A group another group's rule names is refused: the rules that name a group go first.
      for (const group of groups) {
        for (const rule of await rulesDirect(ctx, port, group.id)) {
          if (rule.group === undefined) continue;
          await ec2(ctx, port, rule.egress ? 'RevokeSecurityGroupEgress' : 'RevokeSecurityGroupIngress', {
            GroupId: group.id,
            'SecurityGroupRuleId.1': rule.id,
          });
        }
      }
      for (const group of groups) await ec2(ctx, port, 'DeleteSecurityGroup', { GroupId: group.id });
    });
    await step('the subnets', async () => {
      for (const id of this.subnets) await ec2(ctx, port, 'DeleteSubnet', { SubnetId: id });
    });
    await step('the VPCs', async () => {
      for (const id of this.vpcs) await ec2(ctx, port, 'DeleteVpc', { VpcId: id });
    });
    await step(`the key pairs ${this.prefix}*`, async () => {
      for (const pair of (await keyPairsDirect(ctx, port)).pairs) {
        if (pair.name.startsWith(this.prefix)) await ec2(ctx, port, 'DeleteKeyPair', { KeyName: pair.name });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens' words.
// ---------------------------------------------------------------------------------------------------------------

export const INSTANCES_PATH = '/aws/ec2/instances';
export const LAUNCH_PATH = '/aws/ec2/instances/launch';
export const GROUPS_PATH = '/aws/ec2/security-groups';
export const CREATE_GROUP_PATH = '/aws/ec2/security-groups/create';
export const KEY_PAIRS_PATH = '/aws/ec2/key-pairs';
export const CREATE_KEY_PAIR_PATH = '/aws/ec2/key-pairs/create';
export function instancePath(id: string): string {
  return `${INSTANCES_PATH}/instance/${encodeURIComponent(id)}`;
}
export function groupPath(id: string): string {
  return `${GROUPS_PATH}/group/${encodeURIComponent(id)}`;
}
export function addRulePath(id: string): string {
  return `${groupPath(id)}/add-rule`;
}

export const INSTANCES_H1 = 'Instances';
export const LAUNCH = 'Launch instance';
export const GROUPS_H1 = 'Security groups';
export const CREATE_GROUP = 'Create security group';
export const ADD_RULE = 'Add rule';
export const KEY_PAIRS_H1 = 'Key pairs';
export const CREATE_KEY_PAIR = 'Create key pair';
export const IMPORT_KEY_PAIR = 'Import key pair';
export const START = 'Start';
export const STOP = 'Stop';
export const REBOOT = 'Reboot';
export const TERMINATE = 'Terminate';
export const DELETE = 'Delete';
export const CANCEL = 'Cancel';
export const REFRESH = 'Refresh';
export const NO_INSTANCES = 'No instances';
export const NO_INSTANCES_MATCH = 'No instances match';
export const CLEAR_FILTERS = 'Clear filters';
export const INSTANCE_NOT_FOUND = 'Instance not found';
export const VIEW_INSTANCES = 'View instances';
export const GROUP_NOT_FOUND = 'Security group not found';
export const VIEW_GROUPS = 'View security groups';
export const NO_KEY_PAIRS = 'No key pairs';
export const VIEW_KEY_PAIRS = 'View key pairs';
export const NO_GROUPS_MATCH = 'No security groups match';
export const CHOOSE_IMAGE = 'Choose an image.';
export const ONLY_STOPPED_STARTS = 'Only a stopped instance can be started.';
export const ONLY_RUNNING_STOPS = 'Only a running instance can be stopped.';
export const ONLY_RUNNING_REBOOTS = 'Only a running instance can be rebooted.';
export const ALREADY_TERMINATED = 'This instance is already terminated.';
export const DEFAULT_GROUP_STAYS = 'The default security group cannot be deleted.';
export const PORT_RULE = 'A port is a whole number from 0 to 65535.';
export const NAME_NOT_SG = 'A name cannot start with sg-.';
export const KEY_NAME_ASCII = 'A name can hold ASCII characters only.';
export const DISCARD_HEADER = 'Discard what you entered?';
export const KEEP_EDITING = 'Keep editing';
export const DISCARD = 'Discard';

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
const MULTISELECT = rel(wrapper.findMultiselect());
const MULTISELECT_TRIGGER = inside(wrapper.findMultiselect().findTrigger());
const MULTISELECT_FILTER = inside(wrapper.findMultiselect().findFilteringInput().findNativeInput());
const MULTISELECT_OPEN = inside(wrapper.findMultiselect().findDropdown().findOpenDropdown());
const MULTISELECT_TOKENS = inside(wrapper.findMultiselect().findTokens());
/** An option of a select or a multiselect by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}
function radioByValue(value: string): string {
  return rel(wrapper.findRadioGroup().findInputByValue(value));
}
function tileByValue(value: string): string {
  return rel(wrapper.findTiles().findInputByValue(value));
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

/** Waits for one flash item of `type` holding every text of `texts`. */
export async function expectFlash(page: Page, type: FlashType, ...texts: string[]): Promise<void> {
  let item = page.locator(wrapper.findFlashbar().findItemsByType(type).toSelector());
  for (const text of texts) item = item.filter({ hasText: text });
  await expect(item, `a ${type} flash holding ${texts.map((t) => `"${t}"`).join(', ')}`).toHaveCount(1, {
    timeout: 20_000,
  });
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

/** The parts of the multiselect of `formField`. */
export function multiselectOf(formField: Locator) {
  const root = formField.locator(MULTISELECT).first();
  return {
    root,
    trigger: root.locator(MULTISELECT_TRIGGER),
    filter: root.locator(MULTISELECT_FILTER),
    list: root.locator(MULTISELECT_OPEN),
    option: (value: string) => root.locator(optionByValue(value)),
    tokens: root.locator(MULTISELECT_TOKENS),
  };
}

/** In the multiselect of `formField`: opens it and types `typed`; the list stays open. */
export async function typeInMultiselect(formField: Locator, typed: string): Promise<void> {
  const m = multiselectOf(formField);
  if ((await m.list.count()) === 0) await m.trigger.click(ACTION);
  await m.filter.fill(typed, ACTION);
}

/** In the multiselect of `formField`: types `typed`, chooses the option of `value` and closes the list. */
export async function chooseInMultiselect(formField: Locator, value: string, typed: string): Promise<void> {
  const m = multiselectOf(formField);
  await typeInMultiselect(formField, typed);
  await expect(m.option(value), `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await m.option(value).click(ACTION);
  await expect(m.tokens, 'the chosen groups').toHaveCount(1, { timeout: 10_000 });
  await formField.page().keyboard.press('Escape');
  await expect(m.list, 'the list after Escape').toHaveCount(0);
}

/** The radio of a radio group, and the tile of a tiles group, by its value. */
export function radio(scope: Locator, value: string): Locator {
  return scope.locator(radioByValue(value));
}
export function tile(scope: Locator, value: string): Locator {
  return scope.locator(tileByValue(value));
}

/** The alert a form shows for a refusal holding `text`. */
export function alertWith(scope: Locator, text: string): Locator {
  return scope.locator(ALERT).filter({ hasText: text });
}

/** The table of `main` below the section heading `name` (a container table of a page of one resource). */
export function tableOf(main: Locator, name: string): Locator {
  return main.locator(TABLE).filter({ has: main.page().getByRole('heading', { name, exact: true }) });
}
