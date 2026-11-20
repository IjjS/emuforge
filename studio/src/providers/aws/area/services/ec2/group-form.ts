// What S5, "Create security group", and S7, "Add rule", check before they send (issue 553, requirement S5 and S7):
// a group's name and description each have 1 to 255 characters of letters, digits, spaces and `._-:/()#,@[]+=&;{}!$*`,
// and the name does not start with `sg-`; a rule's description has at most 255 of them; each port of a TCP or UDP
// rule is a whole number from 0 to 65535 and the first is not above the last; the range or the group is given.
// Whether a CIDR block is one is the emulator's to say. The first rule that fails is the field's message.

/** The longest name and description the emulator accepts. */
export const TEXT_MAX = 255;

/** The highest port. */
export const PORT_MAX = 65535;

const SET = '._-:/()#,@[]+=&;{}!$*';
const IN_SET = /^[A-Za-z0-9 ._\-:/()#,@[\]+=&;{}!$*]*$/;

export const GROUP_NAME_RULE = `1 to 255 characters: letters, digits, spaces and ${SET}. It cannot start with sg-.`;
export const GROUP_DESCRIPTION_RULE = `1 to 255 characters: letters, digits, spaces and ${SET}.`;
export const RULE_DESCRIPTION_RULE = `Up to 255 characters: letters, digits, spaces and ${SET}.`;
export const FIRST_PORT_RULE = '0 to 65535.';
export const LAST_PORT_RULE = '0 to 65535, not below the first port. Leave empty for one port.';

export const NAME_EMPTY = 'Enter a name.';
export const NAME_TOO_LONG = 'A name can have up to 255 characters.';
export const NAME_OUTSIDE_SET = `A name can hold letters, digits, spaces and ${SET} only.`;
export const NAME_SG_PREFIX = 'A name cannot start with sg-.';
export const DESCRIPTION_EMPTY = 'Enter a description.';
export const DESCRIPTION_TOO_LONG = 'A description can have up to 255 characters.';
export const DESCRIPTION_OUTSIDE_SET = `A description can hold letters, digits, spaces and ${SET} only.`;
export const PORT_EMPTY = 'Enter a port.';
export const PORT_INVALID = 'A port is a whole number from 0 to 65535.';
export const PORT_BELOW_FIRST = 'The last port cannot be below the first.';
export const CIDR_EMPTY = 'Enter a CIDR block.';
export const GROUP_NOT_CHOSEN = 'Choose a security group.';

/** A rule's protocol as S7 offers it. */
export type RuleProtocol = 'tcp' | 'udp' | 'icmp' | 'all';

/** What a rule's source or destination is. */
export type PeerKind = 'ipv4' | 'ipv6' | 'group';

/** Whether a rule of `protocol` has ports: TCP and UDP only. */
export function hasPorts(protocol: RuleProtocol): boolean {
  return protocol === 'tcp' || protocol === 'udp';
}

/** What is wrong with a group's name, or `undefined` when nothing is. */
export function groupNameMessage(name: string): string | undefined {
  if (name === '') return NAME_EMPTY;
  if (name.length > TEXT_MAX) return NAME_TOO_LONG;
  if (!IN_SET.test(name)) return NAME_OUTSIDE_SET;
  if (name.startsWith('sg-')) return NAME_SG_PREFIX;
  return undefined;
}

/** What is wrong with a description, or `undefined` when nothing is; `required` for a group's, not a rule's. */
export function descriptionMessage(description: string, required: boolean): string | undefined {
  if (description === '') return required ? DESCRIPTION_EMPTY : undefined;
  if (description.length > TEXT_MAX) return DESCRIPTION_TOO_LONG;
  if (!IN_SET.test(description)) return DESCRIPTION_OUTSIDE_SET;
  return undefined;
}

/** The port `value` as a number, or `undefined` when it is no whole number from 0 to 65535. */
export function portOf(value: string): number | undefined {
  if (!/^\d+$/.test(value)) return undefined;
  const port = Number(value);
  return port <= PORT_MAX ? port : undefined;
}

/** What is wrong with the first port, or `undefined` when nothing is. */
export function firstPortMessage(value: string): string | undefined {
  if (value === '') return PORT_EMPTY;
  return portOf(value) === undefined ? PORT_INVALID : undefined;
}

/** What is wrong with the last port, which may be empty, against the first `first`. */
export function lastPortMessage(value: string, first: string): string | undefined {
  if (value === '') return undefined;
  const last = portOf(value);
  if (last === undefined) return PORT_INVALID;
  const from = portOf(first);
  return from !== undefined && last < from ? PORT_BELOW_FIRST : undefined;
}

/** What S5 checks. */
export interface GroupFormValues {
  name: string;
  description: string;
}

export interface GroupFormMessages {
  name?: string;
  description?: string;
}

/** What is wrong with S5's form, field by field. */
export function groupFormMessages({ name, description }: GroupFormValues): GroupFormMessages {
  const messages: GroupFormMessages = {};
  const nameMessage = groupNameMessage(name);
  if (nameMessage !== undefined) messages.name = nameMessage;
  const descriptionText = descriptionMessage(description, true);
  if (descriptionText !== undefined) messages.description = descriptionText;
  return messages;
}

/** What S7 checks. */
export interface RuleFormValues {
  protocol: RuleProtocol;
  firstPort: string;
  lastPort: string;
  peerKind: PeerKind;
  cidr: string;
  groupChosen: boolean;
  description: string;
}

export interface RuleFormMessages {
  firstPort?: string;
  lastPort?: string;
  cidr?: string;
  group?: string;
  description?: string;
}

/** What is wrong with S7's form, field by field. ICMP and All ask for no port. */
export function ruleFormMessages(values: RuleFormValues): RuleFormMessages {
  const messages: RuleFormMessages = {};
  if (hasPorts(values.protocol)) {
    const first = firstPortMessage(values.firstPort);
    if (first !== undefined) messages.firstPort = first;
    const last = lastPortMessage(values.lastPort, values.firstPort);
    if (last !== undefined) messages.lastPort = last;
  }
  if (values.peerKind === 'group') {
    if (!values.groupChosen) messages.group = GROUP_NOT_CHOSEN;
  } else if (values.cidr.trim() === '') {
    messages.cidr = CIDR_EMPTY;
  }
  const description = descriptionMessage(values.description, false);
  if (description !== undefined) messages.description = description;
  return messages;
}
