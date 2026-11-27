import { DescribeVpcsCommand } from '@aws-sdk/client-ec2';
import {
  DescribeDBEngineVersionsCommand,
  DescribeDBSubnetGroupsCommand,
  DescribeOrderableDBInstanceOptionsCommand,
  type DescribeDBEngineVersionsMessage,
  type OrderableDBInstanceOption,
} from '@aws-sdk/client-rds';

import { sendEc2 } from '../../lib/ec2-client';
import { NETWORK_CHOICE_OPERATIONS, paged as ec2Paged } from '../../lib/ec2-network-choices';

import { sendRds, text } from './api';

// The reads RDS's create forms choose from (issue 573, design task 2): an engine's versions and the DB subnet groups,
// 100 a page by the API's own marker. Each sent through `sendRds` with its operation's name, so a failed request
// rejects with its `RequestError` and an aborted one with the signal's reason. Neither takes a typed text: RDS has no
// filter by part of a name for either. Every value is the emulator's, as it came. The security groups are EC2's, read
// by the area's part (`components/security-group-choices.ts`).

/** The operations of the choices, as a failure names them. */
export const CHOICE_OPERATIONS = {
  describeDBEngineVersions: 'DescribeDBEngineVersions',
  describeDBSubnetGroups: 'DescribeDBSubnetGroups',
  describeOrderableDBInstanceOptions: 'DescribeOrderableDBInstanceOptions',
} as const;

/** How many choices one page asks for. */
export const CHOICES_PAGE_SIZE = 100;

/** One page of choices in the API's order, and its marker when it gave one. */
export interface ChoicePage<T> {
  choices: T[];
  marker?: string;
}

/** An engine's version as the field offers it. */
export interface EngineVersionChoice {
  version: string;
  description?: string;
}

/** A DB subnet group as the field offers it. */
export interface SubnetGroupChoice {
  name: string;
  description?: string;
  vpcId?: string;
  zones?: readonly string[];
  /** Present when the group has subnets but none has a zone name. */
  hasSubnets?: true;
}

/** `MaxRecords` and the marker when there is one. */
function paged(marker: string | undefined) {
  return { MaxRecords: CHOICES_PAGE_SIZE, ...(marker === undefined ? {} : { Marker: marker }) };
}

function pageOf<T>(choices: T[], next: unknown): ChoicePage<T> {
  const marker = text(next);
  return marker === undefined ? { choices } : { choices, marker };
}

function describeEngineVersions(endpoint: string, input: DescribeDBEngineVersionsMessage, signal: AbortSignal) {
  return sendRds(
    endpoint,
    CHOICE_OPERATIONS.describeDBEngineVersions,
    (client, abortSignal) => client.send(new DescribeDBEngineVersionsCommand(input), { abortSignal }),
    signal,
  );
}

export interface UpgradeTarget {
  version: string;
  major: boolean;
}

export async function readDefaultVersion(endpoint: string, engine: string, signal: AbortSignal) {
  const output = await describeEngineVersions(endpoint, { Engine: engine, DefaultOnly: true }, signal);
  return text(output.DBEngineVersions?.[0]?.EngineVersion);
}

export async function readUpgradeTargets(
  endpoint: string,
  engine: string,
  version: string,
  signal: AbortSignal,
): Promise<UpgradeTarget[]> {
  const output = await describeEngineVersions(endpoint, { Engine: engine, EngineVersion: version }, signal);
  return (output.DBEngineVersions?.find((row) => row.EngineVersion === version)?.ValidUpgradeTarget ?? []).flatMap(
    (target) => {
      const targetVersion = text(target.EngineVersion);
      return targetVersion === undefined
        ? []
        : [{ version: targetVersion, major: target.IsMajorVersionUpgrade === true }];
    },
  );
}

/** The rows of one concrete engine version. An unversioned read would list every version. */
export async function readOrderableRows(
  endpoint: string,
  engine: string,
  version: string | undefined,
  signal: AbortSignal,
): Promise<OrderableDBInstanceOption[]> {
  if (!version) return [];

  const rows: OrderableDBInstanceOption[] = [];
  let marker: string | undefined;
  do {
    const output = await sendRds(
      endpoint,
      CHOICE_OPERATIONS.describeOrderableDBInstanceOptions,
      (client, abortSignal) =>
        client.send(
          new DescribeOrderableDBInstanceOptionsCommand({ Engine: engine, EngineVersion: version, ...paged(marker) }),
          { abortSignal },
        ),
      signal,
    );
    rows.push(...(output.OrderableDBInstanceOptions ?? []));
    marker = text(output.Marker);
  } while (marker !== undefined);
  return rows;
}

/** The versions of `engine`: `DescribeDBEngineVersions` with the `Engine`, 100 a page. */
export async function listEngineVersionChoices(
  endpoint: string,
  engine: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<EngineVersionChoice>> {
  const output = await describeEngineVersions(endpoint, { Engine: engine, ...paged(marker) }, signal);
  const choices = (output.DBEngineVersions ?? []).flatMap((each): EngineVersionChoice[] => {
    const version = text(each.EngineVersion);
    if (version === undefined) {
      return [];
    }
    const description = text(each.DBEngineVersionDescription);
    return [description === undefined ? { version } : { version, description }];
  });
  return pageOf(choices, output.Marker);
}

/** The DB subnet groups: `DescribeDBSubnetGroups`, 100 a page. */
export async function listSubnetGroupChoices(
  endpoint: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<SubnetGroupChoice>> {
  const output = await sendRds(
    endpoint,
    CHOICE_OPERATIONS.describeDBSubnetGroups,
    (client, abortSignal) => client.send(new DescribeDBSubnetGroupsCommand(paged(marker)), { abortSignal }),
    signal,
  );
  const choices = (output.DBSubnetGroups ?? []).flatMap((group): SubnetGroupChoice[] => {
    const name = text(group.DBSubnetGroupName);
    if (name === undefined) {
      return [];
    }
    const choice: SubnetGroupChoice = { name };
    const description = text(group.DBSubnetGroupDescription);
    if (description !== undefined) {
      choice.description = description;
    }
    const vpcId = text(group.VpcId);
    if (vpcId !== undefined) {
      choice.vpcId = vpcId;
    }
    const subnets = group.Subnets ?? [];
    const zones = [
      ...new Set(
        subnets.flatMap((subnet) => {
          const zone = text(subnet.SubnetAvailabilityZone?.Name);
          return zone === undefined ? [] : [zone];
        }),
      ),
    ].sort();
    if (zones.length > 0) choice.zones = zones;
    if (subnets.length > 0 && zones.length === 0) choice.hasSubnets = true;
    return [choice];
  });
  choices.sort((left, right) => left.name.localeCompare(right.name));
  return pageOf(choices, output.Marker);
}

/** Read only up to the page containing the requested group. */
export async function findSubnetGroup(endpoint: string, name: string, signal: AbortSignal) {
  let marker: string | undefined;
  do {
    const page = await listSubnetGroupChoices(endpoint, marker, signal);
    const group = page.choices.find((choice) => choice.name === name);
    if (group !== undefined) return group;
    marker = page.marker;
  } while (marker !== undefined);
  return undefined;
}

export async function readDefaultVpcId(endpoint: string, signal: AbortSignal) {
  let token: string | undefined;
  do {
    const output = await sendEc2(
      endpoint,
      NETWORK_CHOICE_OPERATIONS.describeVpcs,
      (client, abortSignal) =>
        client.send(new DescribeVpcsCommand(ec2Paged([{ Name: 'is-default', Values: ['true'] }], token)), {
          abortSignal,
        }),
      signal,
    );
    const vpcId = text(output.Vpcs?.find((vpc) => vpc.IsDefault === true)?.VpcId);
    if (vpcId !== undefined) return vpcId;
    token = text(output.NextToken);
  } while (token !== undefined);
  return undefined;
}
