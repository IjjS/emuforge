import { describe, expect, it } from 'vitest';

import { blockMessage, nameMessage, ROUTE_DESTINATION, SUBNET_BLOCK, VPC_BLOCK } from './form';

describe('a name', () => {
  it('257 characters → "A name can have up to 256 characters."; 256 and empty → none', () => {
    expect(nameMessage('n'.repeat(257))).toBe('A name can have up to 256 characters.');
    expect(nameMessage('n'.repeat(256))).toBeUndefined();
    expect(nameMessage('')).toBeUndefined();
  });
});

describe('an IPv4 block', () => {
  it('empty → the field\'s "Enter …" message', () => {
    expect(blockMessage('', VPC_BLOCK)).toBe('Enter a CIDR block.');
    expect(blockMessage('', SUBNET_BLOCK)).toBe('Enter a CIDR block.');
    expect(blockMessage('', ROUTE_DESTINATION)).toBe('Enter a destination.');
  });

  it('no IPv4 block in CIDR notation → "Enter an IPv4 block in CIDR notation, such as …" with the field\'s example', () => {
    for (const value of ['not-a-cidr', '10.0.0.0', '10.0.0.0/33', '300.1.0.0/16', '10.0.0.0/16 x', '10.0.0.0/16x']) {
      expect(blockMessage(value, VPC_BLOCK), value).toBe('Enter an IPv4 block in CIDR notation, such as 10.0.0.0/16.');
      expect(blockMessage(value, SUBNET_BLOCK), value).toBe(
        'Enter an IPv4 block in CIDR notation, such as 10.0.1.0/24.',
      );
      expect(blockMessage(value, ROUTE_DESTINATION), value).toBe(
        'Enter an IPv4 block in CIDR notation, such as 0.0.0.0/0.',
      );
    }
  });

  it('host bits (10.0.0.5/16) → none', () => {
    expect(blockMessage('10.0.0.5/16', VPC_BLOCK)).toBeUndefined();
    expect(blockMessage('10.0.0.5/16', SUBNET_BLOCK)).toBeUndefined();
  });
});

describe("a VPC's and a subnet's block", () => {
  it('/15 and /29 → "The block\'s size must be from /16 to /28."; /16 and /28 → none', () => {
    for (const rule of [VPC_BLOCK, SUBNET_BLOCK]) {
      expect(blockMessage('10.0.0.0/15', rule)).toBe("The block's size must be from /16 to /28.");
      expect(blockMessage('10.0.0.0/29', rule)).toBe("The block's size must be from /16 to /28.");
      expect(blockMessage('10.0.0.0/16', rule)).toBeUndefined();
      expect(blockMessage('10.0.0.0/28', rule)).toBeUndefined();
    }
  });
});

describe("a route's destination", () => {
  it('0.0.0.0/0 and 10.1.2.3/32 → none; no message about a size from /16 to /28', () => {
    expect(blockMessage('0.0.0.0/0', ROUTE_DESTINATION)).toBeUndefined();
    expect(blockMessage('10.1.2.3/32', ROUTE_DESTINATION)).toBeUndefined();
    expect(blockMessage('10.0.0.0/8', ROUTE_DESTINATION)).toBeUndefined();
    expect(blockMessage('10.0.0.0/29', ROUTE_DESTINATION)).toBeUndefined();
  });
});
