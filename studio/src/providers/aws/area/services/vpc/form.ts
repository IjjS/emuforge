import type { ResourceType, TagSpecification } from '@aws-sdk/client-ec2';

import type { TagRow } from '../../lib/tag-rows';

// The checks VPC's forms make before sending (issue 574, requirement "The create forms"): a name of at most 256
// characters, and an IPv4 block `a.b.c.d/n` with four numbers from 0 to 255 and, for a VPC's and a subnet's block, a
// size from /16 to /28. Each limit is one the emulator refused past it (probe-1, probe-4, probe-5). A message is
// `undefined` when the value passes.

/** The most characters a name can have. */
export const NAME_MAX = 256;

/** A name's constraint text. */
export const NAME_CONSTRAINT = 'Up to 256 characters. Stored as the Name tag.';

/** The message of a name, `undefined` when it passes; an empty name passes (it is optional). */
export function nameMessage(name: string): string | undefined {
  return name.length > NAME_MAX ? `A name can have up to ${String(NAME_MAX)} characters.` : undefined;
}

/** How a field's IPv4 block is checked. */
export interface BlockRule {
  /** The message of an empty field ("Enter a CIDR block."). */
  empty: string;
  /** The block the messages give as an example ("10.0.0.0/16"). */
  example: string;
  /** The sizes the block may have, inclusive; any from 0 to 32 when absent. */
  sizes?: { min: number; max: number };
}

/** The sizes a VPC's and a subnet's block may have. */
const NETWORK_SIZES = { min: 16, max: 28 };

/** S2's "IPv4 CIDR block". */
export const VPC_BLOCK: BlockRule = { empty: 'Enter a CIDR block.', example: '10.0.0.0/16', sizes: NETWORK_SIZES };

/** S5's "IPv4 CIDR block". */
export const SUBNET_BLOCK: BlockRule = { empty: 'Enter a CIDR block.', example: '10.0.1.0/24', sizes: NETWORK_SIZES };

/** S10's "Destination". */
export const ROUTE_DESTINATION: BlockRule = { empty: 'Enter a destination.', example: '0.0.0.0/0' };

const BLOCK = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/;

/** The message of the block `value` by `rule`, `undefined` when it passes. Host bits are the emulator's to clear. */
export function blockMessage(value: string, rule: BlockRule): string | undefined {
  if (value === '') {
    return rule.empty;
  }
  const parts = BLOCK.exec(value);
  const numbers = parts === null ? [] : parts.slice(1).map(Number);
  const size = numbers[4];
  if (size === undefined || numbers.slice(0, 4).some((part) => part > 255) || size > 32) {
    return `Enter an IPv4 block in CIDR notation, such as ${rule.example}.`;
  }
  if (rule.sizes !== undefined && (size < rule.sizes.min || size > rule.sizes.max)) {
    return `The block's size must be from /${String(rule.sizes.min)} to /${String(rule.sizes.max)}.`;
  }
  return undefined;
}

/** The create request's tags, with the optional form name first. */
export function tagSpecifications(
  resourceType: ResourceType,
  name: string | undefined,
  rows: readonly TagRow[] = [],
): { TagSpecifications?: TagSpecification[] } {
  const tags = rows.map(({ key, value }) => ({ Key: key, Value: value }));
  if (name !== undefined && name !== '') {
    tags.unshift({ Key: 'Name', Value: name });
  }
  return tags.length === 0 ? {} : { TagSpecifications: [{ ResourceType: resourceType, Tags: tags }] };
}
