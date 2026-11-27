// What the checks of issue 651 need beside `rds.ts`: the network a form's choices are narrowed by (a VPC with a subnet
// in two zones, its DB subnet group and its security groups), the members of a DB instance's or DB cluster's direct
// answer that `rds.ts` does not read, and the emulator's orderable rows.
//
// `RdsNetwork` is made BEFORE the check's `RdsSeeded`, so it is disposed of after it: the DB instances and clusters
// that use the subnet group are gone by then.

import { directEc2 } from '../../support/aws-clients-general';
import { EnvError, type Ctx } from '../../support/check';
import { parseXml, rds, type Xml } from './rds';

function find(node: Xml | undefined, name: string): Xml | undefined {
  if (node === undefined) return undefined;
  for (const each of node.children) {
    if (each.name === name) return each;
    const deeper = find(each, name);
    if (deeper !== undefined) return deeper;
  }
  return undefined;
}

/** Every element named `name` below `node`, in document order. */
function all(node: Xml | undefined, name: string, into: Xml[] = []): Xml[] {
  for (const each of node?.children ?? []) {
    if (each.name === name) into.push(each);
    all(each, name, into);
  }
  return into;
}

async function ec2(ctx: Ctx, port: number, action: string, params: Record<string, string>) {
  const answer = await directEc2(ctx, port, action, params);
  if ('error' in answer) throw new EnvError(`direct ${action}: ${answer.error}`);
  ctx.log(`direct ec2 ${action}: status ${String(answer.status)}`);
  return { status: answer.status, root: parseXml(answer.body) };
}

async function made(ctx: Ctx, port: number, action: string, params: Record<string, string>, id: string) {
  const answer = await ec2(ctx, port, action, params);
  const found = find(answer.root, id)?.text;
  if (answer.status !== 200 || found === undefined || found === '') {
    throw new EnvError(`direct ${action} answered ${String(answer.status)} with no ${id}`);
  }
  return found;
}

export const ZONE_B = 'us-east-1b';
export const ZONE_C = 'us-east-1c';

/** The VPC `<p>-v` with a subnet in `us-east-1b` and one in `us-east-1c`, the DB subnet group `<p>-sng`, the group `<p>-in`. */
export class RdsNetwork {
  vpcId = '';
  subnets: string[] = [];
  readonly subnetGroup: string;
  /** `<p>-in`, in the VPC. */
  inId = '';
  private readonly groups: string[] = [];

  private constructor(
    private readonly ctx: Ctx,
    private readonly port: number,
    readonly prefix: string,
  ) {
    this.subnetGroup = `${prefix}-sng`;
    ctx.own(this);
  }

  /** `third` is the second octet's neighbour of the VPC's block `10.<third>.0.0/16`, one per check of a run. */
  static async make(ctx: Ctx, port: number, prefix: string, third: number): Promise<RdsNetwork> {
    const net = new RdsNetwork(ctx, port, prefix);
    const name = (value: string, type: string) => ({
      'TagSpecification.1.ResourceType': type,
      'TagSpecification.1.Tag.1.Key': 'Name',
      'TagSpecification.1.Tag.1.Value': value,
    });
    net.vpcId = await made(
      ctx,
      port,
      'CreateVpc',
      { CidrBlock: `10.${String(third)}.0.0/16`, ...name(`${prefix}-v`, 'vpc') },
      'vpcId',
    );
    for (const [i, zone] of [ZONE_B, ZONE_C].entries()) {
      net.subnets.push(
        await made(
          ctx,
          port,
          'CreateSubnet',
          { VpcId: net.vpcId, CidrBlock: `10.${String(third)}.${String(i + 1)}.0/24`, AvailabilityZone: zone },
          'subnetId',
        ),
      );
    }
    const group = await rds(ctx, port, 'CreateDBSubnetGroup', {
      DBSubnetGroupName: net.subnetGroup,
      DBSubnetGroupDescription: `Check ${prefix}`,
      'SubnetIds.SubnetIdentifier.1': net.subnets[0]!,
      'SubnetIds.SubnetIdentifier.2': net.subnets[1]!,
    });
    if (group.status !== 200) throw new EnvError(`direct CreateDBSubnetGroup answered ${String(group.status)} ${group.code ?? ''}`);
    net.inId = await net.group(`${prefix}-in`, net.vpcId);
    return net;
  }

  /** `CreateSecurityGroup name` with the description `description of <name>`, in `vpcId` or the default VPC; its id. */
  async group(name: string, vpcId?: string): Promise<string> {
    const id = await made(
      this.ctx,
      this.port,
      'CreateSecurityGroup',
      { GroupName: name, GroupDescription: `description of ${name}`, ...(vpcId === undefined ? {} : { VpcId: vpcId }) },
      'groupId',
    );
    this.groups.push(id);
    return id;
  }

  async dispose(): Promise<void> {
    const { ctx, port } = this;
    const quiet = async (what: string, body: () => Promise<unknown>) => {
      try {
        await body();
      } catch (e) {
        ctx.log(`cleanup of ${what} failed: ${(e as Error).message}`);
      }
    };
    await quiet('the DB subnet group', () => rds(ctx, port, 'DeleteDBSubnetGroup', { DBSubnetGroupName: this.subnetGroup }));
    for (const id of this.groups) await quiet(`the group ${id}`, () => ec2(ctx, port, 'DeleteSecurityGroup', { GroupId: id }));
    for (const id of this.subnets) await quiet(`the subnet ${id}`, () => ec2(ctx, port, 'DeleteSubnet', { SubnetId: id }));
    if (this.vpcId !== '') await quiet('the VPC', () => ec2(ctx, port, 'DeleteVpc', { VpcId: this.vpcId }));
  }
}

/** The id of the default VPC. */
export async function defaultVpcId(ctx: Ctx, port: number): Promise<string> {
  const answer = await ec2(ctx, port, 'DescribeVpcs', { 'Filter.1.Name': 'is-default', 'Filter.1.Value.1': 'true' });
  const id = find(answer.root, 'vpcId')?.text;
  if (id === undefined) throw new EnvError('the emulator reports no default VPC');
  return id;
}

/** The zone id (`use1-az…`) the emulator gives each zone name. */
export async function zoneIds(ctx: Ctx, port: number): Promise<Record<string, string>> {
  const answer = await ec2(ctx, port, 'DescribeAvailabilityZones', {});
  const ids: Record<string, string> = {};
  for (const item of all(answer.root, 'item')) {
    const zone = item.children.find((each) => each.name === 'zoneName')?.text;
    const id = item.children.find((each) => each.name === 'zoneId')?.text;
    if (zone !== undefined && id !== undefined) ids[zone] = id;
  }
  return ids;
}

/**
 * The direct answer's row of the DB instance or DB cluster `id`, read member by member: `text('Iops')`,
 * `text('StorageType')`, `texts('AvailabilityZone')` for a list, `tags()`; `null` when the emulator holds none.
 */
export async function rowDirect(ctx: Ctx, port: number, kind: 'instance' | 'cluster' | 'cluster-snapshot', id: string) {
  const [action, param, member] =
    kind === 'instance'
      ? ['DescribeDBInstances', 'DBInstanceIdentifier', 'DBInstance']
      : kind === 'cluster'
        ? ['DescribeDBClusters', 'DBClusterIdentifier', 'DBCluster']
        : ['DescribeDBClusterSnapshots', 'DBClusterSnapshotIdentifier', 'DBClusterSnapshot'];
  const answer = await rds(ctx, port, action!, { [param!]: id });
  if (answer.status !== 200) return null;
  const row = find(answer.root, member!);
  if (row === undefined) return null;
  const top = (name: string) => row.children.find((each) => each.name === name);
  return {
    /** The text of the row's own member `name`. */
    text: (name: string) => top(name)?.text,
    /** The texts of every element `name` below the row's member `list`. */
    texts: (list: string, name: string) => all(top(list), name).map((each) => each.text),
    /** The row's `TagList`. */
    tags: () =>
      Object.fromEntries(
        (top('TagList')?.children ?? []).map((tag) => [
          tag.children.find((each) => each.name === 'Key')?.text ?? '',
          tag.children.find((each) => each.name === 'Value')?.text ?? '',
        ]),
      ) as Record<string, string>,
  };
}

/** An orderable row: a class with one storage type and that type's ranges. */
export interface OrderableRow {
  instanceClass: string;
  storageType: string | undefined;
  minStorage: string | undefined;
  maxStorage: string | undefined;
}

/** `DescribeOrderableDBInstanceOptions` for `engine` and `version`, every page. */
export async function orderableRows(ctx: Ctx, port: number, engine: string, version: string): Promise<OrderableRow[]> {
  const rows: OrderableRow[] = [];
  let marker: string | undefined;
  for (let i = 0; i < 50; i++) {
    const answer = await rds(ctx, port, 'DescribeOrderableDBInstanceOptions', {
      Engine: engine,
      EngineVersion: version,
      MaxRecords: '100',
      ...(marker === undefined ? {} : { Marker: marker }),
    });
    if (answer.status !== 200) throw new EnvError(`direct DescribeOrderableDBInstanceOptions answered ${String(answer.status)}`);
    for (const row of all(answer.root, 'OrderableDBInstanceOption')) {
      const text = (name: string) => row.children.find((each) => each.name === name)?.text;
      rows.push({
        instanceClass: text('DBInstanceClass') ?? '',
        storageType: text('StorageType'),
        minStorage: text('MinStorageSize'),
        maxStorage: text('MaxStorageSize'),
      });
    }
    marker = find(answer.root, 'Marker')?.text;
    if (marker === undefined || marker === '') break;
  }
  return rows;
}

/** The version the emulator gives `engine` by itself (`DescribeDBEngineVersions` with `DefaultOnly`). */
export async function defaultVersion(ctx: Ctx, port: number, engine: string): Promise<string> {
  const answer = await rds(ctx, port, 'DescribeDBEngineVersions', { Engine: engine, DefaultOnly: 'true' });
  const version = find(answer.root, 'EngineVersion')?.text;
  if (answer.status !== 200 || version === undefined) throw new EnvError(`the emulator names no default version of ${engine}`);
  return version;
}
