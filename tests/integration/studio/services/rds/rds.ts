// The emulator side and the words of RDS's screens (test-criteria.md, issue 573), for the `rds-*.spec.ts` checks.
//
// - Direct calls: `directRds` and `directEc2` of `support/aws-clients-general.ts` (the query protocol, XML answers),
//   straight to the emulator, SigV4-signed with the key it wrote for this run, TLS verified against its `ca.pem`,
//   never through the engine. A body is never logged, and no password is.
// - `RdsSeeded`: the security groups, DB instances and DB clusters a check makes, every one named under the check's
//   prefix `<p>`. When the check ends it removes all of the emulator's under `<p>`, those Studio's actions made
//   included, in the order of test-criteria.md: deletion protection off, the DB instances deleted with
//   `SkipFinalSnapshot` and waited for until the emulator reports none, the DB clusters the same way, the security
//   groups.
// - The screens' words (requirement.md, "EmuForge's own text") and readers of what a screen shows. What is inside a
//   Cloudscape component (a select's options, a table's rows and cells, a flash, a modal) is found with Cloudscape's
//   own test selectors, an option by its value; a reader waits for the settled screen.

import createWrapper from '@cloudscape-design/components/test-utils/selectors';
import type { Locator, Page } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { directEc2, directRds, type DirectAnswer } from '../../support/aws-clients-general';
import { EnvError, expect, type Ctx } from '../../support/check';
import { ACTION, heading } from '../../support/frame';
import { shortPrefix } from '../../support/screen-rules';
import { waitFor } from '../../support/wait';

// ---------------------------------------------------------------------------------------------------------------
// Names.
// ---------------------------------------------------------------------------------------------------------------

const IDENTIFIER = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/i;

/** Throws unless `id` is an identifier RDS takes: letters, digits and single hyphens, a letter first, 63 at most. */
export function identifier(id: string): string {
  if (id.length > 63 || !IDENTIFIER.test(id)) throw new Error(`${id} is not an identifier RDS takes`);
  return id;
}

/** The check's prefix `<p>` for `tag` (letters and digits): `shortPrefix`, which fits RDS's identifiers. */
export function rdsPrefix(ctx: Pick<Ctx, 'runId'>, tag: string): string {
  if (!/^[a-z0-9]+$/.test(tag)) throw new Error(`the tag ${tag} holds more than letters and digits`);
  return identifier(shortPrefix(ctx, tag));
}

/** A password made for this run alone: 20 letters and digits. It is given to the emulator and never logged. */
export function runPassword(): string {
  return `Pw${randomBytes(9).toString('hex')}`;
}

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
function child(node: Xml | undefined, name: string): Xml | undefined {
  return node?.children.find((each) => each.name === name);
}

/** The text of the element at `path` below `node`, when it is there and not empty. */
function textAt(node: Xml | undefined, ...path: string[]): string | undefined {
  let at = node;
  for (const step of path) at = child(at, step);
  return at === undefined || at.text === '' ? undefined : at.text;
}

/** The children of the child `list` of `node` (a list's members, whatever each is named). */
function members(node: Xml | undefined, list: string): Xml[] {
  return child(node, list)?.children ?? [];
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

function answerOf(ctx: Ctx, service: string, action: string, answer: { status: number; body: string }): Answer {
  const root = parseXml(answer.body);
  const code = answer.status === 200 ? null : (anywhere(root, 'Code')?.text ?? null);
  const message = answer.status === 200 ? null : (anywhere(root, 'Message')?.text ?? null);
  ctx.log(`direct ${service} ${action}: status ${String(answer.status)}${code ? ` ${code}` : ''}`);
  return { ...answer, root, code, message };
}

/** An RDS action with its parameters, straight to the emulator; logs its status. The body is never logged. */
export async function rds(ctx: Ctx, port: number, action: string, params: Record<string, string> = {}): Promise<Answer> {
  return answerOf(ctx, 'rds', action, arrived(await directRds(ctx, port, action, params), `direct ${action}`));
}

async function ec2(ctx: Ctx, port: number, action: string, params: Record<string, string>): Promise<Answer> {
  return answerOf(ctx, 'ec2', action, arrived(await directEc2(ctx, port, action, params), `direct ${action}`));
}

/** An action that must answer 200; an `EnvError` otherwise (a check's Given that does not hold). */
function mustHold(action: string, answer: Answer): Answer {
  if (answer.status !== 200) {
    throw new EnvError(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''} ${answer.message ?? ''}`);
  }
  return answer;
}

/** Every member of `list` in the result of the describe `action`, following its `Marker`. */
async function everyPage(
  ctx: Ctx,
  port: number,
  action: string,
  list: string,
  params: Record<string, string>,
): Promise<Xml[]> {
  const found: Xml[] = [];
  let marker: string | undefined;
  for (let i = 0; i < 50; i++) {
    const answer: Answer = await rds(ctx, port, action, {
      ...params,
      MaxRecords: '100',
      ...(marker === undefined ? {} : { Marker: marker }),
    });
    if (answer.status !== 200) throw new Error(`direct ${action} answered ${String(answer.status)} ${answer.code ?? ''}`);
    const result = child(answer.root, `${action}Result`);
    const page = members(result, list);
    found.push(...page);
    marker = textAt(result, 'Marker');
    if (marker === undefined || page.length === 0) break;
  }
  return found;
}

// --- DB instances ---

/** A DB instance as `DescribeDBInstances` gives it. */
export interface DirectInstance {
  id: string;
  status: string;
  engine: string;
  version: string | undefined;
  instanceClass: string;
  storage: string | undefined;
  storageType: string | undefined;
  masterUsername: string | undefined;
  dbName: string | undefined;
  address: string | undefined;
  port: string | undefined;
  zone: string | undefined;
  arn: string | undefined;
  resourceId: string | undefined;
  parameterGroups: string[];
  subnetGroup: string | undefined;
  vpcId: string | undefined;
  subnets: string[];
  groups: { id: string; status: string | undefined }[];
  clusterId: string | undefined;
  protection: boolean;
  created: string | undefined;
  tags: Record<string, string>;
}

function tagsOf(node: Xml): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const tag of members(node, 'TagList')) tags[textAt(tag, 'Key') ?? ''] = textAt(tag, 'Value') ?? '';
  return tags;
}

function instanceOf(node: Xml): DirectInstance {
  return {
    id: textAt(node, 'DBInstanceIdentifier') ?? '',
    status: textAt(node, 'DBInstanceStatus') ?? '',
    engine: textAt(node, 'Engine') ?? '',
    version: textAt(node, 'EngineVersion'),
    instanceClass: textAt(node, 'DBInstanceClass') ?? '',
    storage: textAt(node, 'AllocatedStorage'),
    storageType: textAt(node, 'StorageType'),
    masterUsername: textAt(node, 'MasterUsername'),
    dbName: textAt(node, 'DBName'),
    address: textAt(node, 'Endpoint', 'Address'),
    port: textAt(node, 'Endpoint', 'Port'),
    zone: textAt(node, 'AvailabilityZone'),
    arn: textAt(node, 'DBInstanceArn'),
    resourceId: textAt(node, 'DbiResourceId'),
    parameterGroups: members(node, 'DBParameterGroups').flatMap((g) => textAt(g, 'DBParameterGroupName') ?? []),
    subnetGroup: textAt(node, 'DBSubnetGroup', 'DBSubnetGroupName'),
    vpcId: textAt(node, 'DBSubnetGroup', 'VpcId'),
    subnets: members(child(node, 'DBSubnetGroup'), 'Subnets').flatMap((s) => textAt(s, 'SubnetIdentifier') ?? []),
    groups: members(node, 'VpcSecurityGroups').map((g) => ({
      id: textAt(g, 'VpcSecurityGroupId') ?? '',
      status: textAt(g, 'Status'),
    })),
    clusterId: textAt(node, 'DBClusterIdentifier'),
    protection: textAt(node, 'DeletionProtection') === 'true',
    created: textAt(node, 'InstanceCreateTime'),
    tags: tagsOf(node),
  };
}

/** Every DB instance of the emulator. */
export async function instancesDirect(ctx: Ctx, port: number): Promise<DirectInstance[]> {
  return (await everyPage(ctx, port, 'DescribeDBInstances', 'DBInstances', {})).map(instanceOf);
}

/**
 * The DB instance `id` by `DBInstanceIdentifier`, with the answer's body as it came (to see what it does not
 * hold); `null` when the emulator holds none (`DBInstanceNotFound`).
 */
export async function instanceAnswer(
  ctx: Ctx,
  port: number,
  id: string,
): Promise<{ instance: DirectInstance; body: string } | null> {
  const answer = await rds(ctx, port, 'DescribeDBInstances', { DBInstanceIdentifier: id });
  if (answer.code === 'DBInstanceNotFound') return null;
  if (answer.status !== 200) throw new Error(`direct DescribeDBInstances ${id} answered ${String(answer.status)}`);
  const found = members(child(answer.root, 'DescribeDBInstancesResult'), 'DBInstances')[0];
  return found === undefined ? null : { instance: instanceOf(found), body: answer.body };
}

/** The DB instance `id`, or `null`. */
export async function instanceDirect(ctx: Ctx, port: number, id: string): Promise<DirectInstance | null> {
  return (await instanceAnswer(ctx, port, id))?.instance ?? null;
}

/** How long a check waits for a status the emulator moves by itself. */
export const STATUS_BOUND_MS = 60_000;

/** Waits, with a bound, until the emulator reports the DB instance `id` as `status`; whether it did. */
export async function reportsStatus(ctx: Ctx, port: number, id: string, status: string): Promise<boolean> {
  const found = await waitFor(STATUS_BOUND_MS, async () =>
    (await instanceDirect(ctx, port, id))?.status === status ? true : undefined,
  );
  ctx.log(`the emulator ${found ? 'reports' : 'does not report'} ${id} as ${status}`);
  return found === true;
}

/** Waits, with a bound, until the emulator reports no DB instance `id`; whether it did. */
export async function reportsNoInstance(ctx: Ctx, port: number, id: string): Promise<boolean> {
  const gone = await waitFor(STATUS_BOUND_MS, async () =>
    (await instanceDirect(ctx, port, id)) === null ? true : undefined,
  );
  ctx.log(`the emulator ${gone ? 'reports no' : 'still reports the'} DB instance ${id}`);
  return gone === true;
}

/** The identifiers of the DB snapshots the emulator holds of the DB instance `id`. */
export async function snapshotsOf(ctx: Ctx, port: number, id: string): Promise<string[]> {
  return (await everyPage(ctx, port, 'DescribeDBSnapshots', 'DBSnapshots', {}))
    .filter((each) => textAt(each, 'DBInstanceIdentifier') === id)
    .map((each) => textAt(each, 'DBSnapshotIdentifier') ?? '');
}

// --- DB clusters ---

/** A DB cluster as `DescribeDBClusters` gives it. */
export interface DirectCluster {
  id: string;
  status: string;
  engine: string;
  version: string | undefined;
  endpoint: string | undefined;
  readerEndpoint: string | undefined;
  port: string | undefined;
  masterUsername: string | undefined;
  databaseName: string | undefined;
  arn: string | undefined;
  resourceId: string | undefined;
  subnetGroup: string | undefined;
  groups: string[];
  parameterGroup: string | undefined;
  members: { id: string; writer: boolean }[];
  protection: boolean;
  created: string | undefined;
  tags: Record<string, string>;
}

function clusterOf(node: Xml): DirectCluster {
  return {
    id: textAt(node, 'DBClusterIdentifier') ?? '',
    status: textAt(node, 'Status') ?? '',
    engine: textAt(node, 'Engine') ?? '',
    version: textAt(node, 'EngineVersion'),
    endpoint: textAt(node, 'Endpoint'),
    readerEndpoint: textAt(node, 'ReaderEndpoint'),
    port: textAt(node, 'Port'),
    masterUsername: textAt(node, 'MasterUsername'),
    databaseName: textAt(node, 'DatabaseName'),
    arn: textAt(node, 'DBClusterArn'),
    resourceId: textAt(node, 'DbClusterResourceId'),
    subnetGroup: textAt(node, 'DBSubnetGroup'),
    groups: members(node, 'VpcSecurityGroups').flatMap((g) => textAt(g, 'VpcSecurityGroupId') ?? []),
    parameterGroup: textAt(node, 'DBClusterParameterGroup'),
    members: members(node, 'DBClusterMembers').map((m) => ({
      id: textAt(m, 'DBInstanceIdentifier') ?? '',
      writer: textAt(m, 'IsClusterWriter') === 'true',
    })),
    protection: textAt(node, 'DeletionProtection') === 'true',
    created: textAt(node, 'ClusterCreateTime'),
    tags: tagsOf(node),
  };
}

/** Every DB cluster of the emulator. */
export async function clustersDirect(ctx: Ctx, port: number): Promise<DirectCluster[]> {
  return (await everyPage(ctx, port, 'DescribeDBClusters', 'DBClusters', {})).map(clusterOf);
}

/** The DB cluster `id`; `null` when the emulator holds none (`DBClusterNotFoundFault`). */
export async function clusterDirect(ctx: Ctx, port: number, id: string): Promise<DirectCluster | null> {
  const answer = await rds(ctx, port, 'DescribeDBClusters', { DBClusterIdentifier: id });
  if (answer.code === 'DBClusterNotFoundFault') return null;
  if (answer.status !== 200) throw new Error(`direct DescribeDBClusters ${id} answered ${String(answer.status)}`);
  const found = members(child(answer.root, 'DescribeDBClustersResult'), 'DBClusters')[0];
  return found === undefined ? null : clusterOf(found);
}

/** Waits, with a bound, until the emulator reports the DB cluster `id` as `status`; whether it did. */
export async function reportsClusterStatus(ctx: Ctx, port: number, id: string, status: string): Promise<boolean> {
  const found = await waitFor(STATUS_BOUND_MS, async () =>
    (await clusterDirect(ctx, port, id))?.status === status ? true : undefined,
  );
  ctx.log(`the emulator ${found ? 'reports' : 'does not report'} the DB cluster ${id} as ${status}`);
  return found === true;
}

/** Waits, with a bound, until the emulator reports no DB cluster `id`; whether it did. */
export async function reportsNoCluster(ctx: Ctx, port: number, id: string): Promise<boolean> {
  const gone = await waitFor(STATUS_BOUND_MS, async () =>
    (await clusterDirect(ctx, port, id)) === null ? true : undefined,
  );
  ctx.log(`the emulator ${gone ? 'reports no' : 'still reports the'} DB cluster ${id}`);
  return gone === true;
}

/** The identifiers of the DB cluster snapshots the emulator holds of the DB cluster `id`. */
export async function clusterSnapshotsOf(ctx: Ctx, port: number, id: string): Promise<string[]> {
  return (await everyPage(ctx, port, 'DescribeDBClusterSnapshots', 'DBClusterSnapshots', {}))
    .filter((each) => textAt(each, 'DBClusterIdentifier') === id)
    .map((each) => textAt(each, 'DBClusterSnapshotIdentifier') ?? '');
}

/** The versions the emulator lists for `engine`, in its order. */
export async function engineVersions(ctx: Ctx, port: number, engine: string): Promise<string[]> {
  const versions = (await everyPage(ctx, port, 'DescribeDBEngineVersions', 'DBEngineVersions', { Engine: engine })).flatMap(
    (each) => textAt(each, 'EngineVersion') ?? [],
  );
  if (versions.length === 0) throw new EnvError(`the emulator lists no version of ${engine}`);
  return versions;
}

// ---------------------------------------------------------------------------------------------------------------
// What a check makes.
// ---------------------------------------------------------------------------------------------------------------

/** A DB instance a check makes directly. */
export interface MakeInstance {
  id: string;
  engine: string;
  instanceClass: string;
  storage?: number;
  masterUsername?: string;
  password?: string;
  dbName?: string;
  groupIds?: string[];
  tags?: Record<string, string>;
  protection?: boolean;
  /** A member of this DB cluster, at `version`. */
  clusterId?: string;
  version?: string;
}

/** A DB cluster a check makes directly. */
export interface MakeCluster {
  id: string;
  engine: string;
  version?: string;
  masterUsername?: string;
  password?: string;
  databaseName?: string;
  groupIds?: string[];
  tags?: Record<string, string>;
  protection?: boolean;
}

function tagParams(tags: Record<string, string> | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  Object.entries(tags ?? {}).forEach(([key, value], i) => {
    params[`Tags.Tag.${String(i + 1)}.Key`] = key;
    params[`Tags.Tag.${String(i + 1)}.Value`] = value;
  });
  return params;
}

function groupParams(ids: string[] | undefined): Record<string, string> {
  const params: Record<string, string> = {};
  (ids ?? []).forEach((id, i) => {
    params[`VpcSecurityGroupIds.VpcSecurityGroupId.${String(i + 1)}`] = id;
  });
  return params;
}

const IN_PROGRESS = new Set(['creating', 'starting', 'stopping', 'rebooting', 'modifying']);

/**
 * The security groups, DB instances and DB clusters a check makes directly on the emulator on `port`, each named
 * under the check's prefix. Making one that the emulator refuses is an environment failure: the check's Given would
 * not hold.
 */
export class RdsSeeded {
  constructor(
    private readonly ctx: Ctx,
    readonly port: number,
    readonly prefix: string,
  ) {
    ctx.own(this);
  }

  private named(name: string): string {
    if (!name.startsWith(this.prefix)) throw new Error(`${name} is not under the check's prefix ${this.prefix}`);
    return identifier(name);
  }

  /** `CreateSecurityGroup name` in the default VPC; its id. */
  async group(name: string): Promise<string> {
    this.named(name);
    const answer = mustHold(
      'CreateSecurityGroup',
      await ec2(this.ctx, this.port, 'CreateSecurityGroup', { GroupName: name, GroupDescription: `Check ${name}` }),
    );
    const id = textAt(answer.root, 'groupId');
    if (id === undefined) throw new EnvError(`the emulator gave the group ${name} no id`);
    return id;
  }

  /** `CreateDBInstance`, waited for until it is `available`. */
  async instance(make: MakeInstance): Promise<string> {
    this.named(make.id);
    const params: Record<string, string> = {
      DBInstanceIdentifier: make.id,
      Engine: make.engine,
      DBInstanceClass: make.instanceClass,
      ...groupParams(make.groupIds),
      ...tagParams(make.tags),
    };
    if (make.storage !== undefined) params.AllocatedStorage = String(make.storage);
    if (make.masterUsername !== undefined) params.MasterUsername = make.masterUsername;
    if (make.password !== undefined) params.MasterUserPassword = make.password;
    if (make.dbName !== undefined) params.DBName = make.dbName;
    if (make.protection === true) params.DeletionProtection = 'true';
    if (make.clusterId !== undefined) params.DBClusterIdentifier = make.clusterId;
    if (make.version !== undefined) params.EngineVersion = make.version;
    mustHold('CreateDBInstance', await rds(this.ctx, this.port, 'CreateDBInstance', params));
    if (!(await reportsStatus(this.ctx, this.port, make.id, 'available'))) {
      throw new EnvError(`the DB instance ${make.id} did not reach available`);
    }
    return make.id;
  }

  /** `StopDBInstance id`, waited for until it is `stopped`. */
  async stop(id: string): Promise<void> {
    mustHold('StopDBInstance', await rds(this.ctx, this.port, 'StopDBInstance', { DBInstanceIdentifier: id }));
    if (!(await reportsStatus(this.ctx, this.port, id, 'stopped'))) {
      throw new EnvError(`the DB instance ${id} did not reach stopped`);
    }
  }

  /** `CreateDBCluster`, waited for until it is `available`; the cluster as the emulator then reports it. */
  async cluster(make: MakeCluster): Promise<DirectCluster> {
    this.named(make.id);
    const params: Record<string, string> = {
      DBClusterIdentifier: make.id,
      Engine: make.engine,
      ...groupParams(make.groupIds),
      ...tagParams(make.tags),
    };
    if (make.version !== undefined) params.EngineVersion = make.version;
    if (make.masterUsername !== undefined) params.MasterUsername = make.masterUsername;
    if (make.password !== undefined) params.MasterUserPassword = make.password;
    if (make.databaseName !== undefined) params.DatabaseName = make.databaseName;
    if (make.protection === true) params.DeletionProtection = 'true';
    mustHold('CreateDBCluster', await rds(this.ctx, this.port, 'CreateDBCluster', params));
    if (!(await reportsClusterStatus(this.ctx, this.port, make.id, 'available'))) {
      throw new EnvError(`the DB cluster ${make.id} did not reach available`);
    }
    return (await clusterDirect(this.ctx, this.port, make.id))!;
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
    /** Waits until `read` reports a status that is not in progress, so a modify or a delete is taken. */
    const settled = (read: () => Promise<string | undefined>) =>
      waitFor(STATUS_BOUND_MS, async () => {
        const status = await read();
        return status === undefined || !IN_PROGRESS.has(status) ? true : undefined;
      });
    await step(`the DB instances ${this.prefix}*`, async () => {
      const mine = (await instancesDirect(ctx, port)).filter((each) => each.id.startsWith(this.prefix));
      for (const each of mine) {
        const status = () => instanceDirect(ctx, port, each.id).then((found) => found?.status);
        await settled(status);
        if (each.protection) {
          await rds(ctx, port, 'ModifyDBInstance', {
            DBInstanceIdentifier: each.id,
            DeletionProtection: 'false',
            ApplyImmediately: 'true',
          });
          await settled(status);
        }
        await rds(ctx, port, 'DeleteDBInstance', { DBInstanceIdentifier: each.id, SkipFinalSnapshot: 'true' });
      }
      for (const each of mine) await reportsNoInstance(ctx, port, each.id);
    });
    await step(`the DB clusters ${this.prefix}*`, async () => {
      const mine = (await clustersDirect(ctx, port)).filter((each) => each.id.startsWith(this.prefix));
      for (const each of mine) {
        const status = () => clusterDirect(ctx, port, each.id).then((found) => found?.status);
        await settled(status);
        if (each.protection) {
          await rds(ctx, port, 'ModifyDBCluster', {
            DBClusterIdentifier: each.id,
            DeletionProtection: 'false',
            ApplyImmediately: 'true',
          });
          await settled(status);
        }
        await rds(ctx, port, 'DeleteDBCluster', { DBClusterIdentifier: each.id, SkipFinalSnapshot: 'true' });
      }
      for (const each of mine) await reportsNoCluster(ctx, port, each.id);
    });
    await step(`the security groups ${this.prefix}*`, async () => {
      const answer = await ec2(ctx, port, 'DescribeSecurityGroups', {
        'Filter.1.Name': 'group-name',
        'Filter.1.Value.1': `${this.prefix}*`,
      });
      for (const group of members(answer.root, 'securityGroupInfo')) {
        const id = textAt(group, 'groupId');
        if (id !== undefined) await ec2(ctx, port, 'DeleteSecurityGroup', { GroupId: id });
      }
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The screens' words.
// ---------------------------------------------------------------------------------------------------------------

export const INSTANCES_PATH = '/aws/rds/instances';
export const CREATE_INSTANCE_PATH = '/aws/rds/instances/create';
export const CLUSTERS_PATH = '/aws/rds/clusters';
export const CREATE_CLUSTER_PATH = '/aws/rds/clusters/create';
export function instancePath(id: string): string {
  return `${INSTANCES_PATH}/instance/${encodeURIComponent(id)}`;
}
export function clusterPath(id: string): string {
  return `${CLUSTERS_PATH}/cluster/${encodeURIComponent(id)}`;
}
export function addInstancePath(id: string): string {
  return `${clusterPath(id)}/add-instance`;
}

export const NONE = '-';
export const INSTANCES_H1 = 'DB instances';
export const CREATE_INSTANCE = 'Create DB instance';
export const CLUSTERS_H1 = 'DB clusters';
export const CREATE_CLUSTER = 'Create DB cluster';
export const ADD_INSTANCE = 'Add DB instance';
export const START = 'Start';
export const STOP = 'Stop';
export const REBOOT = 'Reboot';
export const DELETE = 'Delete';
export const CANCEL = 'Cancel';
export const REFRESH = 'Refresh';
export const NO_INSTANCES = 'No DB instances';
export const NO_CLUSTERS = 'No DB clusters';
export const INSTANCE_NOT_FOUND = 'DB instance not found';
export const VIEW_INSTANCES = 'View DB instances';
export const CLUSTER_NOT_FOUND = 'DB cluster not found';
export const VIEW_CLUSTERS = 'View DB clusters';
export const ONLY_STOPPED_STARTS = 'Only a stopped DB instance can be started.';
export const ONLY_AVAILABLE_STOPS = 'Only an available DB instance can be stopped.';
export const ONLY_AVAILABLE_REBOOTS = 'Only an available DB instance can be rebooted.';
export const AURORA_NOT_BY_ITSELF = 'An Aurora DB instance starts and stops only with its DB cluster.';
export const PROTECTION_IS_ON = 'Deletion protection is on.';
export const MEMBERS_FIRST = "Delete the cluster's DB instances first, each from its own page.";
export const CHANGED_WITH_INSTANCE = 'Changed with ModifyDBInstance.';
export const CHANGED_WITH_CLUSTER = 'Changed with ModifyDBCluster.';
export const IDENTIFIER_BEGINS = 'An identifier begins with a letter.';
export const PASSWORD_AT_LEAST = 'A master password has at least 8 characters.';
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
const ALERT = rel(wrapper.findAlert());
const MODAL = rel(wrapper.findModal());
const FORM_FIELD = rel(wrapper.findFormField());
const FORM_FIELD_LABEL = inside(wrapper.findFormField().findLabel());
const FORM_FIELD_ERROR = inside(wrapper.findFormField().findError());
const SELECT = rel(wrapper.findSelect());
const SELECT_TRIGGER = inside(wrapper.findSelect().findTrigger());
const SELECT_OPEN = inside(wrapper.findSelect().findDropdown().findOpenDropdown());
const MULTISELECT = rel(wrapper.findMultiselect());
const MULTISELECT_TRIGGER = inside(wrapper.findMultiselect().findTrigger());
const MULTISELECT_FILTER = inside(wrapper.findMultiselect().findFilteringInput().findNativeInput());
const MULTISELECT_OPEN = inside(wrapper.findMultiselect().findDropdown().findOpenDropdown());
const MULTISELECT_TOKENS = inside(wrapper.findMultiselect().findTokens());
const HEADER_TEXT = rel(wrapper.findHeader().findHeadingText());
/** An option of a select or a multiselect by its value. */
function optionByValue(value: string): string {
  return inside(wrapper.findSelect().findDropdown().findOptionByValue(value));
}
function radioByValue(value: string): string {
  return rel(wrapper.findRadioGroup().findInputByValue(value));
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
        const row: Record<string, string> = {};
        [...tr.children].forEach((cell, i) => {
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

/**
 * Waits until the table shows a row whose `column` is `value` and returns it. The lists have no filter and hold
 * other checks' rows, so a check finds its own by its identifier and asserts nothing of the others.
 */
export async function rowOf(table: Locator, column: string, value: string): Promise<Record<string, string>> {
  await expect
    .poll(async () => (await rowsOf(table)).some((row) => row[column] === value), {
      message: `a row whose "${column}" is ${value}`,
      timeout: 30_000,
    })
    .toBe(true);
  return (await rowsOf(table)).find((row) => row[column] === value)!;
}

/** Waits until the table, its rows read, shows no row whose `column` is `value`. */
export async function expectNoRow(table: Locator, column: string, value: string): Promise<void> {
  await expect
    .poll(async () => (await rowsOf(table)).some((row) => row[column] === value), {
      message: `no row whose "${column}" is ${value}`,
      timeout: 30_000,
    })
    .toBe(false);
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
      timeout: STATUS_BOUND_MS,
    })
    .toBe(want);
}

/** Selects the row of `table` whose `column` is `value`, by its selection control. */
export async function selectRow(table: Locator, column: string, value: string): Promise<void> {
  await rowOf(table, column, value);
  const index = (await rowsOf(table)).findIndex((row) => row[column] === value);
  await table.locator(inside(wrapper.findTable().findRowSelectionArea(index + 1))).click(ACTION);
}

/** The table's empty slot (its "No …" words and their action). */
export function emptyOf(table: Locator): Locator {
  return table.locator(TABLE_EMPTY);
}

/** The table of `main` whose header's heading text is `name` (a container table of a page of one resource). */
export function tableOf(main: Locator, name: string): Locator {
  return main.locator(TABLE).filter({
    has: main.page().locator(HEADER_TEXT).filter({ hasText: new RegExp(`^\\s*${escaped(name)}\\s*$`) }),
  });
}

/** An engine with its version as the screens write it ("postgres 18.3"); the engine alone without a version. */
export function engineText(engine: string, version: string | undefined): string {
  return version === undefined ? engine : `${engine} ${version}`;
}

/** The value (`dd`) of `label` in the key-value pairs inside `scope`, for a link or a text inside it. */
export function valueLocator(scope: Locator, label: string): Locator {
  return scope
    .locator('dt')
    .filter({ hasText: new RegExp(`^\\s*${escaped(label)}\\s*$`) })
    .locator('xpath=following-sibling::dd[1]');
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

/** Waits until the value of `label` on the page is exactly `want`. */
export async function expectValueIs(page: Page, label: string, want: string): Promise<void> {
  await expect
    .poll(() => valueOf(page.getByRole('main'), label), { message: `"${label}" is "${want}"`, timeout: STATUS_BOUND_MS })
    .toBe(want);
}

/** Waits until the parts of the value of `label` on the page are exactly `want`, in order. */
export async function expectValueParts(page: Page, label: string, want: string[]): Promise<void> {
  await expect
    .poll(() => valuePartsOf(page.getByRole('main'), label), {
      message: `"${label}" reads ${want.map((each) => `"${each}"`).join(', ')}`,
      timeout: STATUS_BOUND_MS,
    })
    .toEqual(want);
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

/** Counts, from now on, the requests of the RDS action `action` that leave the page (the action is in the body). */
export function countActions(page: Page, action: string): { count: () => number } {
  let seen = 0;
  page.on('request', (request) => {
    const body = request.method() === 'POST' ? request.postData() : null;
    if (body !== null && new URLSearchParams(body).get('Action') === action) seen++;
  });
  return { count: () => seen };
}

/** A button of `scope` by its name. */
export function button(scope: Locator | Page, name: string): Locator {
  return scope.getByRole('button', { name, exact: true });
}

/** Asserts that `control` is unavailable and, with a `reason`, that it says it. */
export async function expectUnavailable(control: Locator, reason: string | null, what: string): Promise<void> {
  await expect(control, `${what} is unavailable`).toBeDisabled({ timeout: 15_000 });
  if (reason !== null) await expect(control, `the reason of ${what}`).toHaveAccessibleDescription(reason);
}

/** Asserts that `control` is available. */
export async function expectAvailable(control: Locator, what: string): Promise<void> {
  await expect(control, `${what} is available`).toBeEnabled({ timeout: 15_000 });
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

/** In the select of `formField`: opens it and chooses the option whose value is `value`. */
export async function chooseOption(formField: Locator, value: string): Promise<void> {
  const select = formField.locator(SELECT).first();
  await select.locator(SELECT_TRIGGER).click(ACTION);
  const option = select.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(select.locator(SELECT_OPEN), 'the list after the choice').toHaveCount(0);
}

/** The select of `formField`, for what it shows as chosen. */
export function selectOf(formField: Locator): Locator {
  return formField.locator(SELECT).first().locator(SELECT_TRIGGER);
}

/** The chosen items of the multiselect of `formField`. */
export function tokensOf(formField: Locator): Locator {
  return formField.locator(MULTISELECT).first().locator(MULTISELECT_TOKENS);
}

/** In the multiselect of `formField`: types `typed`, chooses the option of `value` and closes the list. */
export async function chooseInMultiselect(formField: Locator, value: string, typed: string): Promise<void> {
  const root = formField.locator(MULTISELECT).first();
  const list = root.locator(MULTISELECT_OPEN);
  if ((await list.count()) === 0) await root.locator(MULTISELECT_TRIGGER).click(ACTION);
  await root.locator(MULTISELECT_FILTER).fill(typed, ACTION);
  const option = root.locator(optionByValue(value));
  await expect(option, `the option ${value}`).toBeVisible({ timeout: 20_000 });
  await option.click(ACTION);
  await expect(root.locator(MULTISELECT_TOKENS), 'the chosen groups').toHaveCount(1, { timeout: 10_000 });
  await formField.page().keyboard.press('Escape');
  await expect(list, 'the list after Escape').toHaveCount(0);
}

/** The radio of a radio group by its value. */
export function radio(scope: Locator, value: string): Locator {
  return scope.locator(radioByValue(value));
}

/** The alert a form shows for a refusal holding `text`. */
export function alertWith(scope: Locator, text: string): Locator {
  return scope.locator(ALERT).filter({ hasText: text });
}
