import { describe, expect, it } from 'vitest';

import { ROUTE_TABLE_SCREENS } from './route-table-screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = ROUTE_TABLE_SCREENS.find((candidate) => candidate.paths.includes(path));
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

describe("VPC's route table screens", () => {
  it('S7 answers at /aws/vpc/route-tables ("Route tables")', () => {
    expect(title('/aws/vpc/route-tables')).toBe('Route tables');
    expect(crumbs('/aws/vpc/route-tables')).toEqual([{ text: 'Route tables' }]);
  });

  it('S8 answers at /aws/vpc/route-tables/create with the crumbs "Route tables" (to S7) then "Create route table"', () => {
    expect(title('/aws/vpc/route-tables/create')).toBe('Create route table');
    expect(crumbs('/aws/vpc/route-tables/create')).toEqual([
      { text: 'Route tables', href: '/aws/vpc/route-tables' },
      { text: 'Create route table' },
    ]);
  });

  it('S9 answers at /aws/vpc/route-tables/route-table/{id} with "Route tables" then the id', () => {
    const path = '/aws/vpc/route-tables/route-table/{id}';
    expect(title(path, { id: 'rtb-1' })).toBe('rtb-1');
    expect(crumbs(path, { id: 'rtb-1' })).toEqual([
      { text: 'Route tables', href: '/aws/vpc/route-tables' },
      { text: 'rtb-1' },
    ]);
  });

  it('S10 answers at …/route-table/{id}/add-route with "Route tables" (to S7), the id (to S9), "Add route"', () => {
    const path = '/aws/vpc/route-tables/route-table/{id}/add-route';
    expect(title(path, { id: 'rtb-1' })).toBe('Add route');
    expect(crumbs(path, { id: 'rtb-1' })).toEqual([
      { text: 'Route tables', href: '/aws/vpc/route-tables' },
      { text: 'rtb-1', href: '/aws/vpc/route-tables/route-table/rtb-1' },
      { text: 'Add route' },
    ]);
  });

  it('S11 answers at …/route-table/{id}/associate-subnet with "Route tables", the id (to S9), "Associate subnet"', () => {
    const path = '/aws/vpc/route-tables/route-table/{id}/associate-subnet';
    expect(title(path, { id: 'rtb-1' })).toBe('Associate subnet');
    expect(crumbs(path, { id: 'rtb-1' })).toEqual([
      { text: 'Route tables', href: '/aws/vpc/route-tables' },
      { text: 'rtb-1', href: '/aws/vpc/route-tables/route-table/rtb-1' },
      { text: 'Associate subnet' },
    ]);
  });

  it('each with "Route tables" active', () => {
    for (const path of [
      '/aws/vpc/route-tables',
      '/aws/vpc/route-tables/create',
      '/aws/vpc/route-tables/route-table/{id}',
      '/aws/vpc/route-tables/route-table/{id}/add-route',
      '/aws/vpc/route-tables/route-table/{id}/associate-subnet',
    ]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/vpc/route-tables');
    }
  });
});
