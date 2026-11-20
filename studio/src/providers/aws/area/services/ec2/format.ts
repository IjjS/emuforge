import { AWS_PATH } from '../../../identity';
import { nameOf, type Tag } from '../../lib/ec2-client';

// Every address of EC2's nine screens, their titles and notice words (issue 553, design "Code layout and the cut"):
// a unit links to another unit's screen by this file alone. An instance and a security group are addressed by the id
// the emulator gave, percent-encoded once as one segment.

/** Shown for a value the answer lacks. */
export const NONE = '-';

/** EC2's route in the area, `/aws/ec2`. */
export const EC2_PATH = `${AWS_PATH}/ec2`;

/** S1, the instances. */
export const INSTANCES_PATH = `${EC2_PATH}/instances`;

/** S2, "Launch instance". */
export const LAUNCH_INSTANCE_PATH = `${INSTANCES_PATH}/launch`;

/** S3's pattern, an instance. */
export const INSTANCE_PATTERN = `${INSTANCES_PATH}/instance/{id}`;

/** S4, the security groups. */
export const SECURITY_GROUPS_PATH = `${EC2_PATH}/security-groups`;

/** S5, "Create security group". */
export const CREATE_SECURITY_GROUP_PATH = `${SECURITY_GROUPS_PATH}/create`;

/** S6's pattern, a security group. */
export const SECURITY_GROUP_PATTERN = `${SECURITY_GROUPS_PATH}/group/{id}`;

/** S7's pattern, "Add rule" of a security group. */
export const ADD_RULE_PATTERN = `${SECURITY_GROUP_PATTERN}/add-rule`;

/** S8, the key pairs. */
export const KEY_PAIRS_PATH = `${EC2_PATH}/key-pairs`;

/** S9, "Create key pair". */
export const CREATE_KEY_PAIR_PATH = `${KEY_PAIRS_PATH}/create`;

/** S3 of the instance `id`. */
export function instanceHref(id: string): string {
  return `${INSTANCES_PATH}/instance/${encodeURIComponent(id)}`;
}

/** S6 of the security group `id`. */
export function securityGroupHref(id: string): string {
  return `${SECURITY_GROUPS_PATH}/group/${encodeURIComponent(id)}`;
}

/** S7 of the security group `id`. */
export function addRuleHref(id: string): string {
  return `${securityGroupHref(id)}/add-rule`;
}

/** The screens' titles, each its `h1` and its crumb. */
export const INSTANCES_TITLE = 'Instances';
export const LAUNCH_INSTANCE_TITLE = 'Launch instance';
export const SECURITY_GROUPS_TITLE = 'Security groups';
export const CREATE_SECURITY_GROUP_TITLE = 'Create security group';
export const ADD_RULE_TITLE = 'Add rule';
export const KEY_PAIRS_TITLE = 'Key pairs';
export const CREATE_KEY_PAIR_TITLE = 'Create key pair';

/** The notice's plural word, per section: S1 to S3, S4 to S7, S8 and S9. */
export const INSTANCES_WORD = 'instances';
export const SECURITY_GROUPS_WORD = 'security groups';
export const KEY_PAIRS_WORD = 'key pairs';

/** An instance's name as a list shows it: the value of its tag `Name`, "-" without one. */
export function instanceName(tags: readonly Tag[]): string {
  return nameOf(tags) ?? NONE;
}

/** S3's heading: the instance's name when it has one, else its ID. */
export function instanceHeading(id: string, tags: readonly Tag[]): string {
  return nameOf(tags) ?? id;
}
