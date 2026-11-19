import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import { AWS_PATH } from '../../../identity';
import type { Capacity, Index, Stream, Table, TableKey, TimeToLiveRead } from './api';
import { bytesToBase64, compactValueText, typeOf } from './item-json';

// How the DynamoDB screens write what the emulator holds (issue 496, design.md; issue 72's paths, status, key and
// capacity texts), and the routes their controls lead to. Every value comes from the emulator's answer and is
// untrusted text.

/** Shown for a value the answer lacks. */
export const NO_VALUE = '-';

/** DynamoDB's route in the area, `/aws/dynamodb`. */
export const DYNAMODB_PATH = `${AWS_PATH}/dynamodb`;

/** The table list. */
export const TABLES_PATH = `${DYNAMODB_PATH}/tables`;

/** "Create table". */
export const CREATE_TABLE_PATH = `${TABLES_PATH}/create`;

/** A table's own page, the link of its name: the name as one path segment, percent-encoded. */
export function tablePath(name: string): string {
  return `${TABLES_PATH}/table/${encodeURIComponent(name)}`;
}

/** A status as Cloudscape's `StatusIndicator` shows it. */
export interface StatusText {
  text: string;
  type: 'success' | 'in-progress' | 'info' | 'warning';
}

const IN_PROGRESS: Readonly<Record<string, string>> = {
  CREATING: 'Creating',
  UPDATING: 'Updating',
  DELETING: 'Deleting',
};

/** The table is being created, updated or deleted: its screen reads it again by itself. */
export function isChanging(status: string | undefined): boolean {
  return status !== undefined && Object.hasOwn(IN_PROGRESS, status);
}

/** "Status": `ACTIVE` as success, the three changes in progress, any other as it came. */
export function statusText(status: string | undefined): StatusText {
  if (status === 'ACTIVE') {
    return { text: 'Active', type: 'success' };
  }
  const change = status === undefined ? undefined : IN_PROGRESS[status];
  if (change !== undefined) {
    return { text: change, type: 'in-progress' };
  }
  return { text: status ?? NO_VALUE, type: 'info' };
}

/** "Partition key" and "Sort key": `<name> (<type>)`, the name alone without a type, "-" for no key. */
export function keyText(key: TableKey | undefined): string {
  if (key === undefined) {
    return NO_VALUE;
  }
  return key.type === undefined ? key.name : `${key.name} (${key.type})`;
}

/** "Indexes" of the list: the global and local secondary indexes together. */
export function indexesText(table: Pick<Table, 'indexes'>): string {
  return String(table.indexes.length);
}

/** "Capacity mode": "On-demand", or "Provisioned (5 read, 7 write)". */
export function capacityText(capacity: Capacity): string {
  if (capacity.mode === 'on-demand') {
    return 'On-demand';
  }
  const units = (count: number | undefined) => (count === undefined ? NO_VALUE : String(count));
  return `Provisioned (${units(capacity.read)} read, ${units(capacity.write)} write)`;
}

/** "Deletion protection": true is "On", false or missing "Off". */
export function deletionProtectionText(enabled: boolean | undefined): string {
  return enabled === true ? 'On' : 'Off';
}

/** An index's "Type": "Global" or "Local". */
export function indexKindText(kind: Index['kind']): string {
  return kind === 'global' ? 'Global' : 'Local';
}

/** "Projection": "All", "Keys only", "Include: a, b"; any other type as it came. */
export function projectionText({ type, nonKeyAttributes = [] }: Index['projection']): string {
  switch (type) {
    case 'ALL':
      return 'All';
    case 'KEYS_ONLY':
      return 'Keys only';
    case 'INCLUDE':
      return `Include: ${nonKeyAttributes.join(', ')}`;
    default:
      return type ?? NO_VALUE;
  }
}

const TTL_STATUS: Readonly<Record<string, string>> = {
  ENABLED: 'On',
  ENABLING: 'Turning on',
  DISABLING: 'Turning off',
};

/**
 * "Time to live": "Off", "On: {attribute}", "Turning on: {attribute}", "Turning off: {attribute}"; a failed read "Not
 * read" as a warning, a 501 "Not implemented by the emulator".
 */
export function timeToLiveText(ttl: TimeToLiveRead): { text: string; type?: StatusText['type'] } {
  if (ttl.kind === 'not-read') {
    return ttl.failure.kind === 'not-implemented'
      ? { text: 'Not implemented by the emulator', type: 'info' }
      : { text: 'Not read', type: 'warning' };
  }
  if (ttl.status === undefined || ttl.status === 'DISABLED') {
    return { text: 'Off' };
  }
  const state = TTL_STATUS[ttl.status] ?? ttl.status;
  return { text: ttl.attribute === undefined ? state : `${state}: ${ttl.attribute}` };
}

/** "Stream": "Off", or "On: {view type}" as the API names it. */
export function streamText(stream: Stream): string {
  if (!stream.enabled) {
    return 'Off';
  }
  return stream.viewType === undefined ? 'On' : `On: ${stream.viewType}`;
}

/** An item's cell: the attribute's type name, and its value as text. */
export interface CellText {
  type: string;
  text: string;
}

/**
 * A cell of the items' result: S and N as they came, B in base64, BOOL "true"/"false", NULL "null", sets, `M` and `L`
 * as their compact DynamoDB JSON. Never HTML.
 */
export function cellText(value: AttributeValue): CellText {
  const type = typeOf(value);
  switch (type) {
    case 'S':
      return { type, text: value.S ?? '' };
    case 'N':
      return { type, text: value.N ?? '' };
    case 'B':
      return { type, text: value.B === undefined ? '' : bytesToBase64(value.B) };
    case 'BOOL':
      return { type, text: value.BOOL === true ? 'true' : 'false' };
    case 'NULL':
      return { type, text: 'null' };
    case undefined:
      return { type: '', text: '' };
    default:
      return { type, text: compactValueText(value) };
  }
}
