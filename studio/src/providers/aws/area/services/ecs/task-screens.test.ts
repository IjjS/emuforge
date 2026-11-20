import { describe, expect, it } from 'vitest';

import { TASK_SCREENS } from './task-screens';

const NO_QUERY = new URLSearchParams();

describe("ECS's task screen", () => {
  it('S5 at its route, crumbs "Clusters > {cluster} > {task}" with the first two links, "Clusters" current', () => {
    const path = '/aws/ecs/clusters/cluster/{cluster}/tasks/task/{task}';
    const screen = TASK_SCREENS.find((candidate) => candidate.paths.includes(path));
    expect(screen).toBeDefined();
    if (screen === undefined) return;
    const params = { cluster: 'dev', task: '0abc' };
    const crumbs = typeof screen.crumbs === 'function' ? screen.crumbs(params, NO_QUERY) : screen.crumbs;
    expect(crumbs).toEqual([
      { text: 'Clusters', href: '/aws/ecs/clusters' },
      { text: 'dev', href: '/aws/ecs/clusters/cluster/dev' },
      { text: '0abc' },
    ]);
    const title = typeof screen.title === 'function' ? screen.title(params, NO_QUERY) : screen.title;
    expect(title).toBe('0abc');
    expect(screen.navigation.activeHref).toBe('/aws/ecs/clusters');
    expect(screen.navigation.header).toEqual({ text: 'ECS', href: '/aws/ecs' });
  });
});
