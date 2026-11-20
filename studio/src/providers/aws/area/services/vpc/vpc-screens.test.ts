import { describe, expect, it } from 'vitest';

import { VPC_SCREENS } from './vpc-screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = VPC_SCREENS.find((candidate) => candidate.paths.includes(path));
  expect(screen, path).toBeDefined();
  return screen as NonNullable<typeof screen>;
}

function title(path: string, params: Record<string, string> = {}) {
  const value = screenAt(path).title;
  return typeof value === 'string' ? value : value(params, NO_QUERY);
}

function crumbs(path: string, params: Record<string, string> = {}) {
  const value = screenAt(path).crumbs;
  return typeof value === 'function' ? value(params, NO_QUERY) : value;
}

describe("VPC's VPC screens", () => {
  it('S2 at /aws/vpc/vpcs/create with "Create VPC" and its crumbs; S3 at its VPC path; both with "VPCs" active', () => {
    const create = '/aws/vpc/vpcs/create';
    expect(title(create)).toBe('Create VPC');
    expect(crumbs(create)).toEqual([{ text: 'VPCs', href: '/aws/vpc/vpcs' }, { text: 'Create VPC' }]);

    const page = '/aws/vpc/vpcs/vpc/{id}';
    expect(title(page, { id: 'vpc-0abc' })).toBe('vpc-0abc');
    expect(crumbs(page, { id: 'vpc-0abc' })).toEqual([{ text: 'VPCs', href: '/aws/vpc/vpcs' }, { text: 'vpc-0abc' }]);

    for (const path of [create, page]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/vpc/vpcs');
    }
  });

  it('S1 still answers at /aws/vpc and /aws/vpc/vpcs, with "VPCs" active', () => {
    for (const path of ['/aws/vpc', '/aws/vpc/vpcs']) {
      expect(title(path)).toBe('VPCs');
      expect(crumbs(path)).toEqual([{ text: 'VPCs' }]);
      expect(screenAt(path).navigation.activeHref).toBe('/aws/vpc/vpcs');
    }
  });
});
