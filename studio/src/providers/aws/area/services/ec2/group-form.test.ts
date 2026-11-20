import { describe, expect, it } from 'vitest';

import { groupFormMessages, ruleFormMessages, type RuleFormValues } from './group-form';

const SET_MESSAGE_NAME = 'A name can hold letters, digits, spaces and ._-:/()#,@[]+=&;{}!$* only.';
const SET_MESSAGE_DESCRIPTION = 'A description can hold letters, digits, spaces and ._-:/()#,@[]+=&;{}!$* only.';
/** 255 characters, every one of the set. */
const FULL = 'aZ09 ._-:/()#,@[]+=&;{}!$*'.repeat(10).slice(0, 255);

const nameOf = (name: string) => groupFormMessages({ name, description: 'd' }).name;
const descriptionOf = (description: string) => groupFormMessages({ name: 'n', description }).description;

const RULE: RuleFormValues = {
  protocol: 'tcp',
  firstPort: '22',
  lastPort: '',
  peerKind: 'ipv4',
  cidr: '10.0.0.0/16',
  groupChosen: false,
  description: '',
};
const rule = (values: Partial<RuleFormValues>) => ruleFormMessages({ ...RULE, ...values });

describe("S5's and S7's checks", () => {
  it("a group's name: empty, 256 characters, é or %, sg- → each its message; 255 of the set → none", () => {
    expect(FULL).toHaveLength(255);
    expect(nameOf('')).toBe('Enter a name.');
    expect(nameOf('n'.repeat(256))).toBe('A name can have up to 255 characters.');
    expect(nameOf('café')).toBe(SET_MESSAGE_NAME);
    expect(nameOf('100%')).toBe(SET_MESSAGE_NAME);
    expect(nameOf('sg-web')).toBe('A name cannot start with sg-.');
    expect(nameOf(FULL)).toBeUndefined();
  });

  it("a group's description: empty, 256 characters, a character outside the set → each its message; 255 → none", () => {
    expect(descriptionOf('')).toBe('Enter a description.');
    expect(descriptionOf('d'.repeat(256))).toBe('A description can have up to 255 characters.');
    expect(descriptionOf('é')).toBe(SET_MESSAGE_DESCRIPTION);
    expect(descriptionOf(FULL)).toBeUndefined();
  });

  it("a rule's description: empty → none; 256 characters and a character outside the set → each its message", () => {
    expect(rule({ description: '' }).description).toBeUndefined();
    expect(rule({ description: 'd'.repeat(256) }).description).toBe('A description can have up to 255 characters.');
    expect(rule({ description: '50%' }).description).toBe(SET_MESSAGE_DESCRIPTION);
    expect(rule({ description: FULL }).description).toBeUndefined();
  });

  it('the first port: empty, -1, 65536, 1.5, abc → each its message; 0 and 65535 → none', () => {
    expect(rule({ firstPort: '' }).firstPort).toBe('Enter a port.');
    for (const value of ['-1', '65536', '1.5', 'abc']) {
      expect(rule({ firstPort: value }).firstPort, value).toBe('A port is a whole number from 0 to 65535.');
    }
    expect(rule({ firstPort: '0' }).firstPort).toBeUndefined();
    expect(rule({ firstPort: '65535' }).firstPort).toBeUndefined();
  });

  it('the last port: empty → none; below the first → its message; equal → none', () => {
    expect(rule({ firstPort: '80', lastPort: '' }).lastPort).toBeUndefined();
    expect(rule({ firstPort: '80', lastPort: '79' }).lastPort).toBe('The last port cannot be below the first.');
    expect(rule({ firstPort: '80', lastPort: '80' }).lastPort).toBeUndefined();
    expect(rule({ firstPort: '80', lastPort: '65536' }).lastPort).toBe('A port is a whole number from 0 to 65535.');
  });

  it('ICMP and All ask for no port', () => {
    for (const protocol of ['icmp', 'all'] as const) {
      expect(rule({ protocol, firstPort: '', lastPort: 'x' })).toEqual({});
    }
    expect(rule({ protocol: 'udp', firstPort: '' }).firstPort).toBe('Enter a port.');
  });

  it('no CIDR block → "Enter a CIDR block."; no group → "Choose a security group."', () => {
    expect(rule({ peerKind: 'ipv4', cidr: '' }).cidr).toBe('Enter a CIDR block.');
    expect(rule({ peerKind: 'ipv6', cidr: '' }).cidr).toBe('Enter a CIDR block.');
    expect(rule({ peerKind: 'group', cidr: '', groupChosen: false })).toEqual({ group: 'Choose a security group.' });
    expect(rule({ peerKind: 'group', cidr: '', groupChosen: true })).toEqual({});
  });
});
