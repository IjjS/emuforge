import { describe, expect, it } from 'vitest';

import { matchesPattern, patternParams } from '../../screen-paths';
import { TASK_PATTERN } from './format';
import { RUN_SCREENS } from './run-screens';
import { SCREENS } from './screens';

const NO_QUERY = new URLSearchParams();
const RUN = '/aws/ecs/clusters/cluster/dev/tasks/run';

describe("ECS's Run task screen", () => {
  it('S6 at its route, crumbs "Clusters > {cluster} > Run task", "Clusters" current; a task named run is not S6', () => {
    expect(RUN_SCREENS).toHaveLength(1);
    const [screen] = RUN_SCREENS;
    if (screen === undefined) {
      throw new Error('no screen');
    }
    expect(SCREENS).toContain(screen);
    const [pattern] = screen.paths;
    if (pattern === undefined) {
      throw new Error('no path');
    }
    expect(matchesPattern(pattern, RUN)).toBe(true);
    const params = patternParams(pattern, RUN) ?? {};
    expect(params).toEqual({ cluster: 'dev' });
    expect(typeof screen.title === 'string' ? screen.title : screen.title(params, NO_QUERY)).toBe('Run task');
    expect(typeof screen.crumbs === 'function' ? screen.crumbs(params, NO_QUERY) : screen.crumbs).toEqual([
      { text: 'Clusters', href: '/aws/ecs/clusters' },
      { text: 'dev', href: '/aws/ecs/clusters/cluster/dev' },
      { text: 'Run task' },
    ]);
    expect(screen.navigation.activeHref).toBe('/aws/ecs/clusters');

    // A task whose id is `run` is S5's address, under `tasks/task/`, and never S6's.
    expect(matchesPattern(pattern, '/aws/ecs/clusters/cluster/dev/tasks/task/run')).toBe(false);
    expect(matchesPattern(TASK_PATTERN, '/aws/ecs/clusters/cluster/dev/tasks/task/run')).toBe(true);
  });
});
