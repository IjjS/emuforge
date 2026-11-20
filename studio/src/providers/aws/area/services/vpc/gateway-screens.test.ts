import { describe, expect, it } from 'vitest';

import { GATEWAY_SCREENS } from './gateway-screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = GATEWAY_SCREENS.find((candidate) => candidate.paths.includes(path));
  expect(screen, path).toBeDefined();
  return screen as NonNullable<typeof screen>;
}

function title(path: string) {
  const value = screenAt(path).title;
  return typeof value === 'string' ? value : value({ id: 'igw-1' }, NO_QUERY);
}

function crumbs(path: string) {
  const value = screenAt(path).crumbs;
  return typeof value === 'function' ? value({ id: 'igw-1' }, NO_QUERY) : value;
}

const LIST = { text: 'Internet gateways', href: '/aws/vpc/internet-gateways' };

describe("VPC's internet gateway screens", () => {
  it('S12 answers at /aws/vpc/internet-gateways ("Internet gateways")', () => {
    expect(title('/aws/vpc/internet-gateways')).toBe('Internet gateways');
    expect(crumbs('/aws/vpc/internet-gateways')).toEqual([{ text: 'Internet gateways' }]);
  });

  it('S13 answers at …/internet-gateways/create with the crumbs "Internet gateways" (to S12) then "Create internet gateway"', () => {
    expect(title('/aws/vpc/internet-gateways/create')).toBe('Create internet gateway');
    expect(crumbs('/aws/vpc/internet-gateways/create')).toEqual([LIST, { text: 'Create internet gateway' }]);
  });

  it('S14 answers at …/internet-gateways/gateway/{id}/attach with "Internet gateways" (to S12) then "Attach internet gateway"', () => {
    const path = '/aws/vpc/internet-gateways/gateway/{id}/attach';
    expect(title(path)).toBe('Attach internet gateway');
    expect(crumbs(path)).toEqual([LIST, { text: 'Attach internet gateway' }]);
  });

  it('each with "Internet gateways" active', () => {
    for (const path of [
      '/aws/vpc/internet-gateways',
      '/aws/vpc/internet-gateways/create',
      '/aws/vpc/internet-gateways/gateway/{id}/attach',
    ]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/vpc/internet-gateways');
    }
  });
});
