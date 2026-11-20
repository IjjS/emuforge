import type { SecurityGroupChoice } from '../../components/security-group-choices';
import type { SubnetChoice } from '../../lib/ec2-network-choices';
import type { RevisionChoice } from './definition-choices';

// What S6, "Run task", holds and checks before it sends `RunTask` (issue 575, requirement S6; design task 2): a
// family and one of its revisions, a count from 1 to 10, one subnet or more, the security groups of their VPC and the
// public IP, on at the start. The requirement's messages, and the request the design sends for a valid form.

export const CHOOSE_FAMILY = 'Choose a task definition family.';
export const CHOOSE_REVISION = 'Choose a revision.';
export const CHOOSE_SUBNET = 'Choose at least one subnet.';
export const COUNT_RULE = 'A whole number from 1 to 10.';
export const COUNT_MESSAGE = 'Enter a whole number from 1 to 10.';

/** The most tasks `RunTask` starts at once. */
export const COUNT_MAX = 10;

/** What the form holds. */
export interface RunFormState {
  family: string | undefined;
  revision: RevisionChoice | undefined;
  /** As typed. */
  count: string;
  subnets: SubnetChoice[];
  groups: SecurityGroupChoice[];
  publicIp: boolean;
}

/** The form at start: one task, the public IP on, nothing else chosen. */
export const RUN_FORM_START: RunFormState = {
  family: undefined,
  revision: undefined,
  count: '1',
  subnets: [],
  groups: [],
  publicIp: true,
};

/** The message of each field that fails its check; a field that passes has none. */
export interface RunFormMessages {
  family?: string;
  revision?: string;
  count?: string;
  subnets?: string;
}

/** The count as a number when it is a whole number from 1 to 10. */
export function countOf(count: string): number | undefined {
  if (!/^\d+$/.test(count)) {
    return undefined;
  }
  const value = Number(count);
  return value >= 1 && value <= COUNT_MAX ? value : undefined;
}

/** What is wrong with the form, field by field. */
export function runFormMessages(form: RunFormState): RunFormMessages {
  const messages: RunFormMessages = {};
  if (form.family === undefined || form.family === '') {
    messages.family = CHOOSE_FAMILY;
  }
  if (form.revision === undefined) {
    messages.revision = CHOOSE_REVISION;
  }
  if (countOf(form.count) === undefined) {
    messages.count = COUNT_MESSAGE;
  }
  if (form.subnets.length === 0) {
    messages.subnets = CHOOSE_SUBNET;
  }
  return messages;
}

/** Whether the form differs from how it opened. */
export function runFormDiffers(form: RunFormState): boolean {
  return (
    form.family !== undefined ||
    form.revision !== undefined ||
    form.count !== RUN_FORM_START.count ||
    form.subnets.length > 0 ||
    form.groups.length > 0 ||
    form.publicIp !== RUN_FORM_START.publicIp
  );
}

/** The VPC the chosen subnets are of: the first's; none while no subnet is chosen. */
export function vpcOf(form: RunFormState): string | undefined {
  return form.subnets[0]?.vpcId;
}

/** The form with the family `family`, its revision that family's newest (`undefined` until it is read). */
export function withFamily(form: RunFormState, family: string, newest: RevisionChoice | undefined): RunFormState {
  return { ...form, family, revision: newest?.family === family ? newest : undefined };
}

/** The form with its revision preset to `newest`, when it is of the family chosen and no revision is held yet. */
export function withNewest(form: RunFormState, newest: RevisionChoice): RunFormState {
  return form.family === newest.family && form.revision === undefined ? { ...form, revision: newest } : form;
}

/** The form with the subnets `subnets`; with none left, the security groups are cleared. */
export function withSubnets(form: RunFormState, subnets: SubnetChoice[]): RunFormState {
  return subnets.length === 0 ? { ...form, subnets, groups: [] } : { ...form, subnets };
}

/** What `RunTask` is sent. */
export interface RunRequest {
  cluster: string;
  /** `family:revision`. */
  taskDefinition: string;
  count: number;
  launchType: 'FARGATE';
  networkConfiguration: {
    awsvpcConfiguration: {
      subnets: string[];
      securityGroups?: string[];
      assignPublicIp: 'ENABLED' | 'DISABLED';
    };
  };
}

/** The request of a form that passes its checks, run in the cluster `cluster`; `undefined` for one that does not. */
export function runRequestOf(cluster: string, form: RunFormState): RunRequest | undefined {
  const count = countOf(form.count);
  if (
    Object.keys(runFormMessages(form)).length > 0 ||
    form.revision === undefined ||
    count === undefined ||
    form.subnets.length === 0
  ) {
    return undefined;
  }
  const groups = form.groups.map((group) => group.id);
  return {
    cluster,
    taskDefinition: form.revision.value,
    count,
    launchType: 'FARGATE',
    networkConfiguration: {
      awsvpcConfiguration: {
        subnets: form.subnets.map((subnet) => subnet.id),
        ...(groups.length === 0 ? {} : { securityGroups: groups }),
        assignPublicIp: form.publicIp ? 'ENABLED' : 'DISABLED',
      },
    },
  };
}
