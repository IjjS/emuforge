import { describe, expect, it } from 'vitest';

import { SUBNET_SCREENS } from './subnet-screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = SUBNET_SCREENS.find((candidate) => candidate.paths.includes(path));
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

describe("the subnets' screens", () => {
  it('S4 answers at /aws/vpc/subnets ("Subnets")', () => {
    expect(title('/aws/vpc/subnets')).toBe('Subnets');
    expect(crumbs('/aws/vpc/subnets')).toEqual([{ text: 'Subnets' }]);
  });

  it('S5 answers at /aws/vpc/subnets/create with the crumbs "Subnets" (to S4) then "Create subnet"', () => {
    expect(title('/aws/vpc/subnets/create')).toBe('Create subnet');
    expect(crumbs('/aws/vpc/subnets/create')).toEqual([
      { text: 'Subnets', href: '/aws/vpc/subnets' },
      { text: 'Create subnet' },
    ]);
  });

  it('S6 answers at /aws/vpc/subnets/subnet/{id} with "Subnets" then the id', () => {
    const pattern = '/aws/vpc/subnets/subnet/{id}';
    expect(title(pattern, { id: 'subnet-1' })).toBe('subnet-1');
    expect(crumbs(pattern, { id: 'subnet-1' })).toEqual([
      { text: 'Subnets', href: '/aws/vpc/subnets' },
      { text: 'subnet-1' },
    ]);
  });

  it('each has "Subnets" active', () => {
    expect(SUBNET_SCREENS).toHaveLength(3);
    for (const screen of SUBNET_SCREENS) {
      expect(screen.navigation.activeHref).toBe('/aws/vpc/subnets');
    }
  });
});
