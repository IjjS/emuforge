import type { AttributeValue } from '@aws-sdk/client-dynamodb';
import { describe, expect, it } from 'vitest';

import {
  capacityText,
  cellText,
  deletionProtectionText,
  indexesText,
  keyText,
  projectionText,
  statusText,
  streamText,
  tablePath,
  timeToLiveText,
} from './format';

// How the DynamoDB screens write what the emulator holds (test-criteria.md, issue 496, "Unit s1 —
// .../dynamodb/format.test.ts").

describe('a table', () => {
  it('statuses: Active, Creating, Updating, Deleting, any other as it came', () => {
    expect(statusText('ACTIVE')).toEqual({ text: 'Active', type: 'success' });
    expect(statusText('CREATING')).toEqual({ text: 'Creating', type: 'in-progress' });
    expect(statusText('UPDATING')).toEqual({ text: 'Updating', type: 'in-progress' });
    expect(statusText('DELETING')).toEqual({ text: 'Deleting', type: 'in-progress' });
    expect(statusText('ARCHIVED')).toEqual({ text: 'ARCHIVED', type: 'info' });
  });

  it('keys: pk (S), none "-"', () => {
    expect(keyText({ name: 'pk', type: 'S' })).toBe('pk (S)');
    expect(keyText({ name: 'id', type: 'B' })).toBe('id (B)');
    expect(keyText(undefined)).toBe('-');
  });

  it('capacity: "On-demand" or "Provisioned (5 read, 7 write)"', () => {
    expect(capacityText({ mode: 'on-demand' })).toBe('On-demand');
    expect(capacityText({ mode: 'provisioned', read: 5, write: 7 })).toBe('Provisioned (5 read, 7 write)');
  });

  it('indexes, global and local together; deletion protection On and Off', () => {
    const index = { name: 'i', projection: {} };
    expect(indexesText({ indexes: [] })).toBe('0');
    expect(
      indexesText({
        indexes: [
          { ...index, kind: 'global' },
          { ...index, kind: 'local' },
        ],
      }),
    ).toBe('2');
    expect(deletionProtectionText(true)).toBe('On');
    expect(deletionProtectionText(false)).toBe('Off');
    expect(deletionProtectionText(undefined)).toBe('Off');
  });

  it('the path of its page holds its name as one segment', () => {
    expect(tablePath('a.b-c')).toBe('/aws/dynamodb/tables/table/a.b-c');
  });
});

describe('its details', () => {
  it('projection: "All", "Keys only", "Include: a, b"', () => {
    expect(projectionText({ type: 'ALL' })).toBe('All');
    expect(projectionText({ type: 'KEYS_ONLY' })).toBe('Keys only');
    expect(projectionText({ type: 'INCLUDE', nonKeyAttributes: ['a', 'b'] })).toBe('Include: a, b');
  });

  it('time to live: "Off", "On: x", "Turning on: x", "Turning off: x"', () => {
    expect(timeToLiveText({ kind: 'read', status: 'DISABLED' })).toEqual({ text: 'Off' });
    expect(timeToLiveText({ kind: 'read' })).toEqual({ text: 'Off' });
    expect(timeToLiveText({ kind: 'read', status: 'ENABLED', attribute: 'x' })).toEqual({ text: 'On: x' });
    expect(timeToLiveText({ kind: 'read', status: 'ENABLING', attribute: 'x' })).toEqual({ text: 'Turning on: x' });
    expect(timeToLiveText({ kind: 'read', status: 'DISABLING', attribute: 'x' })).toEqual({ text: 'Turning off: x' });
  });

  it('time to live not read: "Not read" as a warning', () => {
    expect(
      timeToLiveText({
        kind: 'not-read',
        failure: { kind: 'other', operation: 'DescribeTimeToLive', code: 'ValidationException' },
      }),
    ).toEqual({ text: 'Not read', type: 'warning' });
  });

  it('stream: "Off", "On: {view type}"', () => {
    expect(streamText({ enabled: false })).toBe('Off');
    expect(streamText({ enabled: true, viewType: 'NEW_AND_OLD_IMAGES' })).toBe('On: NEW_AND_OLD_IMAGES');
  });
});

describe('a cell of each of the ten types', () => {
  const bytes = (text: string) => new Uint8Array([...text].map((char) => char.charCodeAt(0)));
  it.each<[string, AttributeValue, string, string]>([
    ['S', { S: 'text' }, 'S', 'text'],
    ['N, as it came', { N: '12.5' }, 'N', '12.5'],
    ['B in base64', { B: bytes('hello') }, 'B', 'aGVsbG8='],
    ['BOOL true', { BOOL: true }, 'BOOL', 'true'],
    ['BOOL false', { BOOL: false }, 'BOOL', 'false'],
    ['NULL', { NULL: true }, 'NULL', 'null'],
    [
      'M as compact DynamoDB JSON',
      { M: { nested: { M: { z: { N: '1' } } }, a: { S: 'x' } } },
      'M',
      '{"a":{"S":"x"},"nested":{"M":{"z":{"N":"1"}}}}',
    ],
    ['L as compact DynamoDB JSON', { L: [{ S: 'a' }, { N: '2' }] }, 'L', '[{"S":"a"},{"N":"2"}]'],
    ['SS', { SS: ['a', 'b'] }, 'SS', '["a","b"]'],
    ['NS', { NS: ['1', '2'] }, 'NS', '["1","2"]'],
    ['BS in base64', { BS: [bytes('hi')] }, 'BS', '["aGk="]'],
  ])('%s', (_name, value, type, text) => {
    expect(cellText(value)).toEqual({ type, text });
  });

  it('text that looks like HTML stays text', () => {
    expect(cellText({ S: '<b>x</b>' })).toEqual({ type: 'S', text: '<b>x</b>' });
  });
});
