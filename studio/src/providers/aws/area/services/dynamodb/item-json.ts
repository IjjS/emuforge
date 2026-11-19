import type { AttributeValue } from '@aws-sdk/client-dynamodb';

import type { Item, Keys } from './api';

// The item editor's text (issue 496, requirement "EmuForge's own text", design task 3): an item in DynamoDB's own JSON,
// as the API and the AWS CLI write it (`{"pk": {"S": "a"}, "n": {"N": "1"}}`), parsed into the client's
// `AttributeValue` map and written back from it. A binary value (`B`, each member of `BS`) is base64 in the text and
// bytes in the map; that is the one conversion made. Numbers stay text. Whether a number string is a number, a set is
// empty or holds a member twice, a key value is empty, and the item's size are the emulator's rules, not checked here.

/** The ten type names of an attribute value. */
const TYPES = ['S', 'N', 'B', 'BOOL', 'NULL', 'M', 'L', 'SS', 'NS', 'BS'] as const;
type TypeName = (typeof TYPES)[number];

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** The bytes base64 text `text` stands for (padded, the standard alphabet; empty for empty); `undefined` if not base64. */
export function base64ToBytes(text: string): Uint8Array | undefined {
  if (!BASE64.test(text)) {
    return undefined;
  }
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** Bytes as base64 text. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** Compares two names by code point, as the result's columns and the editor's attributes are ordered. */
export function compareCodePoints(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return left.length - right.length;
}

// ---------------------------------------------------------------------------------------------------------------
// Messages

export const NOT_AN_OBJECT = 'Enter the item as a JSON object of attribute values.';
export const KEY_CHANGED = 'The key cannot change. Create a new item to copy this one.';

export function notAttributeValue(path: string): string {
  return `${path} is not an attribute value. Write it as {"S": "text"}, {"N": "1"} and so on.`;
}

export function notBase64(path: string): string {
  return `${path} is not base64. Write a binary value in base64.`;
}

export function missingKey(name: string, type: string): string {
  return `The item must hold its key attribute ${name} of type ${type}.`;
}

// ---------------------------------------------------------------------------------------------------------------
// Text to item

/** The text's item, or the message of the first rule it fails. */
export type ParsedItem = { ok: true; item: Item } | { ok: false; message: string };

class Refusal extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((member) => typeof member === 'string');
}

function bytesOf(text: string, path: string): Uint8Array {
  const bytes = base64ToBytes(text);
  if (bytes === undefined) {
    throw new Refusal(notBase64(path));
  }
  return bytes;
}

/** The attribute value `value` at `path`, or a `Refusal` with the first rule it fails, depth first. */
function attributeValue(value: unknown, path: string): AttributeValue {
  if (!isObject(value)) {
    throw new Refusal(notAttributeValue(path));
  }
  const names = Object.keys(value);
  const [type] = names;
  if (names.length !== 1 || type === undefined || !(TYPES as readonly string[]).includes(type)) {
    throw new Refusal(notAttributeValue(path));
  }
  const inner = value[type];
  switch (type as TypeName) {
    case 'S':
    case 'N':
      if (typeof inner !== 'string') break;
      return type === 'S' ? { S: inner } : { N: inner };
    case 'B':
      if (typeof inner !== 'string') break;
      return { B: bytesOf(inner, path) };
    case 'BOOL':
      if (typeof inner !== 'boolean') break;
      return { BOOL: inner };
    case 'NULL':
      if (inner !== true) break;
      return { NULL: true };
    case 'M':
      if (!isObject(inner)) break;
      return { M: attributeMap(inner, (name) => `${path}.${name}`) };
    case 'L':
      if (!Array.isArray(inner)) break;
      return { L: inner.map((member, index) => attributeValue(member, `${path}[${String(index)}]`)) };
    case 'SS':
      if (!isStrings(inner)) break;
      return { SS: [...inner] };
    case 'NS':
      if (!isStrings(inner)) break;
      return { NS: [...inner] };
    case 'BS':
      if (!isStrings(inner)) break;
      return { BS: inner.map((member, index) => bytesOf(member, `${path}[${String(index)}]`)) };
  }
  throw new Refusal(notAttributeValue(path));
}

function attributeMap(value: Record<string, unknown>, pathOf: (name: string) => string): Item {
  const map: Item = {};
  for (const [name, member] of Object.entries(value)) {
    map[name] = attributeValue(member, pathOf(name));
  }
  return map;
}

/** The type name of `value`, the one member the client's union holds. */
export function typeOf(value: AttributeValue): TypeName | undefined {
  return TYPES.find((type) => (value as unknown as Record<string, unknown>)[type] !== undefined);
}

/**
 * The editor's text as the client's item, checked by the rules of requirement "EmuForge's own text" in their order;
 * only the first failure is given. `keys` are the table's key attributes; on edit, `original` is the key the opened
 * item was read with, which the text's key attributes must equal.
 */
export function parseItem(text: string, keys: Keys, original?: Item): ParsedItem {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return { ok: false, message: NOT_AN_OBJECT };
  }
  if (!isObject(json)) {
    return { ok: false, message: NOT_AN_OBJECT };
  }
  let item: Item;
  try {
    item = attributeMap(json, (name) => name);
  } catch (error) {
    if (error instanceof Refusal) {
      return { ok: false, message: error.message };
    }
    throw error;
  }
  const keyAttributes = [keys.partition, ...(keys.sort === undefined ? [] : [keys.sort])];
  for (const { name, type } of keyAttributes) {
    const value = item[name];
    if (value === undefined || (type !== undefined && typeOf(value) !== type)) {
      return { ok: false, message: missingKey(name, type ?? 'S, N or B') };
    }
  }
  if (original !== undefined) {
    for (const { name } of keyAttributes) {
      const before = original[name];
      const after = item[name];
      if (before === undefined || after === undefined || compactText(before) !== compactText(after)) {
        return { ok: false, message: KEY_CHANGED };
      }
    }
  }
  return { ok: true, item };
}

// ---------------------------------------------------------------------------------------------------------------
// Item to text

/** JSON whose objects keep their members' order, also for names that look like array indexes. */
type Json = string | boolean | Json[] | { entries: [string, Json][] };

function ordered(names: Iterable<string>): string[] {
  return [...names].sort(compareCodePoints);
}

function jsonOfMap(map: Item, names: string[]): Json {
  return {
    entries: names.flatMap((name) => {
      const value = map[name];
      return value === undefined ? [] : [[name, jsonOf(value)] as [string, Json]];
    }),
  };
}

/** An attribute value as DynamoDB JSON, binary values in base64, the members of `M` in code point order. */
function jsonOf(value: AttributeValue): Json {
  const type = typeOf(value);
  const inner = (value as unknown as Record<string, unknown>)[type ?? ''];
  switch (type) {
    case 'B':
      return { entries: [['B', bytesToBase64(inner as Uint8Array)]] };
    case 'BS':
      return { entries: [['BS', (inner as Uint8Array[]).map(bytesToBase64)]] };
    case 'M': {
      const map = inner as Item;
      return { entries: [['M', jsonOfMap(map, ordered(Object.keys(map)))]] };
    }
    case 'L':
      return { entries: [['L', (inner as AttributeValue[]).map(jsonOf)]] };
    case 'SS':
    case 'NS':
      return { entries: [[type, [...(inner as string[])]]] };
    case 'BOOL':
    case 'NULL':
      return { entries: [[type, inner as boolean]] };
    case 'S':
    case 'N':
      return { entries: [[type, inner as string]] };
    default:
      return { entries: [] };
  }
}

/** `json` as text: compact with `indent` undefined, else indented by it as `JSON.stringify` does. */
function write(json: Json, indent: string | undefined, depth = 0): string {
  if (typeof json === 'string' || typeof json === 'boolean') {
    return JSON.stringify(json);
  }
  const parts = Array.isArray(json)
    ? json.map((member) => write(member, indent, depth + 1))
    : json.entries.map(
        ([name, member]) =>
          `${JSON.stringify(name)}:${indent === undefined ? '' : ' '}${write(member, indent, depth + 1)}`,
      );
  const [open, close] = Array.isArray(json) ? ['[', ']'] : ['{', '}'];
  if (parts.length === 0) {
    return `${open}${close}`;
  }
  if (indent === undefined) {
    return `${open}${parts.join(',')}${close}`;
  }
  const inside = indent.repeat(depth + 1);
  return `${open}\n${parts.map((part) => `${inside}${part}`).join(',\n')}\n${indent.repeat(depth)}${close}`;
}

/** An attribute value as compact DynamoDB JSON: `{"S":"x"}`. */
export function compactText(value: AttributeValue): string {
  return write(jsonOf(value), undefined);
}

/** The value part of an attribute value as compact DynamoDB JSON, without its type name: `["a","b"]`, `{"a":{"S":"x"}}`. */
export function compactValueText(value: AttributeValue): string {
  const json = jsonOf(value);
  const [entry] = typeof json === 'object' && !Array.isArray(json) ? json.entries : [];
  return entry === undefined ? '' : write(entry[1], undefined);
}

/** The editor's text of `item`: key attributes first, then the others in code point order, two-space indented. */
export function itemText(item: Item, keys: Keys): string {
  const keyNames = [keys.partition.name, ...(keys.sort === undefined ? [] : [keys.sort.name])];
  const others = ordered(Object.keys(item).filter((name) => !keyNames.includes(name)));
  return write(jsonOfMap(item, [...keyNames, ...others]), '  ');
}

/** "Create item"'s text: the key attributes with empty values of their types (String when a type is not known). */
export function newItemText(keys: Keys): string {
  const empty = (type: string | undefined): Json => ({ entries: [[type === 'N' || type === 'B' ? type : 'S', '']] });
  const entries: [string, Json][] = [[keys.partition.name, empty(keys.partition.type)]];
  if (keys.sort !== undefined) {
    entries.push([keys.sort.name, empty(keys.sort.type)]);
  }
  return write({ entries }, '  ');
}
