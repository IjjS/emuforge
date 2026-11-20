import { describe, expect, it } from 'vitest';

import { CREATE_SCREENS } from './create-screens';
import { CreateClusterPage } from './pages/create-cluster-page';
import { CreateInstancePage } from './pages/create-instance-page';
import { SCREENS } from './screens';

describe("RDS's create screens", () => {
  it('S2 answers at /aws/rds/instances/create with its title, the crumbs "DB instances" then "Create DB instance", and "DB instances" active', () => {
    const screen = SCREENS.find((candidate) => candidate.paths.includes('/aws/rds/instances/create'));
    expect(screen).toBeDefined();
    expect(CREATE_SCREENS).toContain(screen);
    expect(screen?.Page).toBe(CreateInstancePage);
    expect(screen?.title).toBe('Create DB instance');
    expect(screen?.crumbs).toEqual([
      { text: 'DB instances', href: '/aws/rds/instances' },
      { text: 'Create DB instance' },
    ]);
    expect(screen?.navigation.activeHref).toBe('/aws/rds/instances');
    expect(screen?.navigation.header).toEqual({ text: 'RDS', href: '/aws/rds' });
  });

  it('S5 answers at /aws/rds/clusters/create with its title, the crumbs "DB clusters" then "Create DB cluster", and "DB clusters" active', () => {
    const screen = SCREENS.find((candidate) => candidate.paths.includes('/aws/rds/clusters/create'));
    expect(screen).toBeDefined();
    expect(CREATE_SCREENS).toContain(screen);
    expect(screen?.Page).toBe(CreateClusterPage);
    expect(screen?.title).toBe('Create DB cluster');
    expect(screen?.crumbs).toEqual([{ text: 'DB clusters', href: '/aws/rds/clusters' }, { text: 'Create DB cluster' }]);
    expect(screen?.navigation.activeHref).toBe('/aws/rds/clusters');
    expect(screen?.navigation.header).toEqual({ text: 'RDS', href: '/aws/rds' });
  });
});
