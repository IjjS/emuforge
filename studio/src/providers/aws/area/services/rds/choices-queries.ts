import type { OrderableDBInstanceOption } from '@aws-sdk/client-rds';
import { useQuery } from '@tanstack/react-query';

import type { RequestFailure } from '../../../../../lib/aws/request';
import { securityGroupChoices, type SecurityGroupChoice } from '../../components/security-group-choices';
import type { ChoiceSource } from '../../components/use-paged-choices';
import { failureOf, noEndpoint } from '../../components/use-token-listing';
import { NETWORK_CHOICE_OPERATIONS } from '../../lib/ec2-network-choices';
import {
  CHOICE_OPERATIONS,
  findSubnetGroup,
  listEngineVersionChoices,
  listSubnetGroupChoices,
  readDefaultVersion,
  readDefaultVpcId,
  readOrderableRows,
  readUpgradeTargets,
  type ChoicePage,
  type EngineVersionChoice,
  type SubnetGroupChoice,
  type UpgradeTarget,
} from './choices-api';
import { availableUpgradeTargets } from './orderable';
import { RDS_KEYS } from './queries';

// Where RDS's create forms take their choices from (issue 573, design task 2): each list a source of the area's paged
// choice field, read a page at a time when its field opens. The versions are those of one engine, which is in their
// key, so another engine's are another list; neither they nor the subnet groups take a typed text. The security
// groups are the area's source, scoped to the selected subnet group's VPC when known.

function markerPage<T>(page: ChoicePage<T>) {
  return page.marker === undefined ? { items: page.choices } : { items: page.choices, next: page.marker };
}

/** The versions of `engine`: each the version, with its description. */
export function engineVersionChoices(endpoint: string | undefined, engine: string): ChoiceSource<EngineVersionChoice> {
  return {
    key: RDS_KEYS.choices('engine-versions', engine),
    endpoint,
    operation: CHOICE_OPERATIONS.describeDBEngineVersions,
    filtering: 'none',
    read: async (at, _text, marker, signal) => markerPage(await listEngineVersionChoices(at, engine, marker, signal)),
    optionOf: (choice) =>
      choice.description === undefined
        ? { value: choice.version, label: choice.version }
        : { value: choice.version, label: choice.version, description: choice.description },
  };
}

/** The DB subnet groups with their VPC, zones and description, refreshed on opening. */
export function subnetGroupChoices(endpoint: string | undefined): ChoiceSource<SubnetGroupChoice> {
  return {
    key: RDS_KEYS.choices('subnet-groups'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeDBSubnetGroups,
    filtering: 'none',
    readAgainOnOpen: true,
    read: async (at, _text, marker, signal) => markerPage(await listSubnetGroupChoices(at, marker, signal)),
    optionOf: (group) => {
      const placement = [group.vpcId, ...(group.zones ?? [])].filter(Boolean).join(' · ');
      return {
        value: group.name,
        label: group.name,
        ...(placement === '' ? {} : { tags: [placement] }),
        ...(group.description === undefined ? {} : { description: group.description }),
      };
    },
  };
}

export function groupChoices(endpoint: string | undefined, vpcId?: string): ChoiceSource<SecurityGroupChoice> {
  return vpcId === undefined ? securityGroupChoices(endpoint) : securityGroupChoices(endpoint, vpcId);
}

export interface ChoiceRead<T> {
  data: T | undefined;
  loading: boolean;
  failure: RequestFailure | undefined;
  retry: () => void;
}

function useChoiceRead<T>(
  endpoint: string | undefined,
  key: readonly unknown[],
  operation: string,
  read: (endpoint: string, signal: AbortSignal) => Promise<T>,
  enabled = true,
): ChoiceRead<T> {
  const query = useQuery({
    queryKey: [...key, endpoint],
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : read(endpoint, signal)),
    enabled: enabled && endpoint !== undefined,
    staleTime: 0,
    gcTime: 0,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });

  return {
    data: query.isFetching || query.isError ? undefined : query.data,
    loading: enabled && (query.isFetching || query.isPending),
    failure: query.isError ? failureOf(query.error, operation) : undefined,
    retry: () => {
      if (enabled && endpoint !== undefined) void query.refetch();
    },
  };
}

export function useOrderableRows(
  endpoint: string | undefined,
  engine: string,
  version: string | undefined,
): ChoiceRead<OrderableDBInstanceOption[]> {
  return useChoiceRead(
    endpoint,
    RDS_KEYS.choices('orderable-rows', engine, version),
    CHOICE_OPERATIONS.describeOrderableDBInstanceOptions,
    (at, signal) => readOrderableRows(at, engine, version, signal),
    Boolean(engine && version),
  );
}

export interface DefaultVersions {
  versions: Readonly<Record<string, string | undefined>>;
  failures: Readonly<Record<string, RequestFailure | undefined>>;
}

export function useDefaultVersions(
  endpoint: string | undefined,
  engines: readonly string[],
): ChoiceRead<DefaultVersions> {
  const operation = CHOICE_OPERATIONS.describeDBEngineVersions;
  return useChoiceRead(endpoint, RDS_KEYS.choices('default-versions', ...engines), operation, async (at, signal) => {
    const answers = await Promise.allSettled(engines.map((engine) => readDefaultVersion(at, engine, signal)));
    const versions: Record<string, string | undefined> = {};
    const failures: Record<string, RequestFailure | undefined> = {};
    for (const [index, engine] of engines.entries()) {
      const answer = answers[index];
      if (answer?.status === 'fulfilled') versions[engine] = answer.value;
      if (answer?.status === 'rejected') failures[engine] = failureOf(answer.reason, operation);
    }
    return { versions, failures };
  });
}

export function upgradeVersionChoices(
  endpoint: string | undefined,
  engine: string,
  version: string,
): ChoiceSource<UpgradeTarget> {
  return {
    key: RDS_KEYS.choices('upgrade-versions', engine, version),
    endpoint,
    operation: CHOICE_OPERATIONS.describeDBEngineVersions,
    read: async (at, _text, _marker, signal) => {
      const targets = await readUpgradeTargets(at, engine, version, signal);
      const versions: EngineVersionChoice[] = [];
      let marker: string | undefined;
      do {
        const page = await listEngineVersionChoices(at, engine, marker, signal);
        versions.push(...page.choices);
        marker = page.marker;
      } while (marker !== undefined);
      return { items: availableUpgradeTargets(targets, versions) };
    },
    optionOf: (target) => ({
      value: target.version,
      label: target.version,
      description: target.major ? 'Major upgrade' : 'Minor upgrade',
    }),
  };
}

export function useSubnetGroup(
  endpoint: string | undefined,
  name: string | undefined,
): ChoiceRead<SubnetGroupChoice | null> {
  return useChoiceRead(
    endpoint,
    RDS_KEYS.choices('subnet-group', name),
    CHOICE_OPERATIONS.describeDBSubnetGroups,
    async (at, signal) => (await findSubnetGroup(at, name ?? '', signal)) ?? null,
    name !== undefined,
  );
}

export function useDefaultVpc(endpoint: string | undefined, enabled: boolean): ChoiceRead<string | null> {
  return useChoiceRead(
    endpoint,
    RDS_KEYS.choices('default-vpc'),
    NETWORK_CHOICE_OPERATIONS.describeVpcs,
    async (at, signal) => (await readDefaultVpcId(at, signal)) ?? null,
    enabled,
  );
}

/** The selected group supplies zones. An empty group on create or restore uses the emulator's default VPC. */
export function useSubnetGroupPlacement(
  endpoint: string | undefined,
  group: SubnetGroupChoice | undefined,
  groupName: string | undefined,
  useDefaultForEmpty: boolean,
): ChoiceRead<string | null> & { zones: readonly string[] | undefined } {
  const groupRead = useSubnetGroup(endpoint, group === undefined ? groupName : undefined);
  const current = group ?? groupRead.data;
  const needsVpc =
    useDefaultForEmpty && current != null && current.hasSubnets !== true && (current.zones?.length ?? 0) === 0;
  const vpcRead = useDefaultVpc(endpoint, needsVpc);
  return {
    data: needsVpc ? vpcRead.data : current === undefined ? undefined : (current?.vpcId ?? null),
    zones: current?.zones,
    loading: groupRead.loading || (needsVpc && vpcRead.loading),
    failure: groupRead.failure ?? (needsVpc ? vpcRead.failure : undefined),
    retry: needsVpc ? vpcRead.retry : groupRead.retry,
  };
}
