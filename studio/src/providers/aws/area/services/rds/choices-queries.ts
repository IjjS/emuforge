import { securityGroupChoices, type SecurityGroupChoice } from '../../components/security-group-choices';
import type { ChoiceSource } from '../../components/use-paged-choices';
import {
  CHOICE_OPERATIONS,
  listEngineVersionChoices,
  listSubnetGroupChoices,
  type ChoicePage,
  type EngineVersionChoice,
  type SubnetGroupChoice,
} from './choices-api';
import { RDS_KEYS } from './queries';

// Where RDS's create forms take their choices from (issue 573, design task 2): each list a source of the area's paged
// choice field, read a page at a time when its field opens. The versions are those of one engine, which is in their
// key, so another engine's are another list; neither they nor the subnet groups take a typed text. The security
// groups are the area's source, of every VPC: the emulator accepts a group of another VPC than the subnet group's.

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

/** The DB subnet groups: each its name, with its VPC ID and its description. */
export function subnetGroupChoices(endpoint: string | undefined): ChoiceSource<SubnetGroupChoice> {
  return {
    key: RDS_KEYS.choices('subnet-groups'),
    endpoint,
    operation: CHOICE_OPERATIONS.describeDBSubnetGroups,
    filtering: 'none',
    read: async (at, _text, marker, signal) => markerPage(await listSubnetGroupChoices(at, marker, signal)),
    optionOf: (group) => ({
      value: group.name,
      label: group.name,
      ...(group.vpcId === undefined ? {} : { tags: [group.vpcId] }),
      ...(group.description === undefined ? {} : { description: group.description }),
    }),
  };
}

/** The security groups of every VPC, from the area's source. */
export function groupChoices(endpoint: string | undefined): ChoiceSource<SecurityGroupChoice> {
  return securityGroupChoices(endpoint);
}
