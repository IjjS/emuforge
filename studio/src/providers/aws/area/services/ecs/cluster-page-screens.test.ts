import { describe, expect, it } from 'vitest';

import { matchesPattern, patternParams } from '../../screen-paths';
import { CLUSTER_PAGE_SCREENS } from './cluster-page-screens';
import { CREATE_CLUSTER_PATH } from './format';
import { SCREENS } from './screens';

const NO_QUERY = new URLSearchParams();

describe("ECS's cluster screen", () => {
  it('S3 at its route, crumbs "Clusters > {cluster}", "Clusters" current; a cluster named create opens S3', () => {
    expect(CLUSTER_PAGE_SCREENS).toHaveLength(1);
    const [screen] = CLUSTER_PAGE_SCREENS;
    if (screen === undefined) {
      throw new Error('no screen');
    }
    expect(SCREENS).toContain(screen);
    expect(screen.paths).toEqual(['/aws/ecs/clusters/cluster/{cluster}']);
    const [pattern] = screen.paths;
    if (pattern === undefined) {
      throw new Error('no path');
    }
    const params = patternParams(pattern, '/aws/ecs/clusters/cluster/dev') ?? {};
    expect(params).toEqual({ cluster: 'dev' });
    expect(typeof screen.title === 'string' ? screen.title : screen.title(params, NO_QUERY)).toBe('dev');
    expect(typeof screen.crumbs === 'function' ? screen.crumbs(params, NO_QUERY) : screen.crumbs).toEqual([
      { text: 'Clusters', href: '/aws/ecs/clusters' },
      { text: 'dev' },
    ]);
    expect(screen.navigation.activeHref).toBe('/aws/ecs/clusters');
    expect(screen.navigation.header).toEqual({ text: 'ECS', href: '/aws/ecs' });

    // A cluster named `create` is S3's address, under `cluster/`, and never S2's.
    const create = '/aws/ecs/clusters/cluster/create';
    expect(matchesPattern(pattern, create)).toBe(true);
    expect(patternParams(pattern, create)).toEqual({ cluster: 'create' });
    expect(matchesPattern(CREATE_CLUSTER_PATH, create)).toBe(false);
  });
});
