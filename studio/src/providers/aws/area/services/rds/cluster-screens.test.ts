import { describe, expect, it } from 'vitest';

import { CLUSTER_SCREENS } from './cluster-screens';
import { SCREENS } from './screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = CLUSTER_SCREENS.find((candidate) => candidate.paths.includes(path));
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

const CLUSTER = '/aws/rds/clusters/cluster/{id}';
const ADD = '/aws/rds/clusters/cluster/{id}/add-instance';

describe("RDS's DB cluster screens", () => {
  it('S4, S6 and S7 at their addresses with their titles and crumbs, all with "DB clusters" active', () => {
    expect(title('/aws/rds/clusters')).toBe('DB clusters');
    expect(crumbs('/aws/rds/clusters')).toEqual([{ text: 'DB clusters' }]);

    expect(title(CLUSTER, { id: 'app-aur' })).toBe('app-aur');
    expect(crumbs(CLUSTER, { id: 'app-aur' })).toEqual([
      { text: 'DB clusters', href: '/aws/rds/clusters' },
      { text: 'app-aur' },
    ]);

    expect(title(ADD, { id: 'app-aur' })).toBe('Add DB instance');
    expect(crumbs(ADD, { id: 'app-aur' })).toEqual([
      { text: 'DB clusters', href: '/aws/rds/clusters' },
      { text: 'app-aur', href: '/aws/rds/clusters/cluster/app-aur' },
      { text: 'Add DB instance' },
    ]);

    for (const path of ['/aws/rds/clusters', CLUSTER, ADD]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/rds/clusters');
      expect(SCREENS).toContain(screenAt(path));
    }
  });

  it("an identifier that needs encoding is one segment in S7's crumb to S6", () => {
    expect(crumbs(ADD, { id: 'a/b' })[1]).toEqual({ text: 'a/b', href: '/aws/rds/clusters/cluster/a%2Fb' });
  });
});
