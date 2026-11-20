import { DescribeDBEngineVersionsCommand, DescribeDBSubnetGroupsCommand } from '@aws-sdk/client-rds';

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
}

/** `MaxRecords` and the marker when there is one. */
function paged(marker: string | undefined) {
  return { MaxRecords: CHOICES_PAGE_SIZE, ...(marker === undefined ? {} : { Marker: marker }) };
}

function pageOf<T>(choices: T[], next: unknown): ChoicePage<T> {
  const marker = text(next);
  return marker === undefined ? { choices } : { choices, marker };
}

/** The versions of `engine`: `DescribeDBEngineVersions` with the `Engine`, 100 a page. */
export async function listEngineVersionChoices(
  endpoint: string,
  engine: string,
  marker: string | undefined,
  signal: AbortSignal,
): Promise<ChoicePage<EngineVersionChoice>> {
  const output = await sendRds(
    endpoint,
    CHOICE_OPERATIONS.describeDBEngineVersions,
    (client, abortSignal) =>
      client.send(new DescribeDBEngineVersionsCommand({ Engine: engine, ...paged(marker) }), { abortSignal }),
    signal,
  );
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
    return [choice];
  });
  return pageOf(choices, output.Marker);
}
