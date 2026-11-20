import { describe, expect, it } from 'vitest';

import { patternParams } from '../../screen-paths';
import { SCREENS } from './screens';
import { SERVICE_SCREENS } from './service-screens';

const NO_QUERY = new URLSearchParams();

describe("ECS's service screen", () => {
  it('S4 at its route, crumbs "Clusters > {cluster} > {service}", "Clusters" current', () => {
    expect(SERVICE_SCREENS).toHaveLength(1);
    const [screen] = SERVICE_SCREENS;
    if (screen === undefined) {
      throw new Error('no screen');
    }
    expect(SCREENS).toContain(screen);
    expect(screen.paths).toEqual(['/aws/ecs/clusters/cluster/{cluster}/services/service/{service}']);
    const [pattern] = screen.paths;
    if (pattern === undefined) {
      throw new Error('no path');
    }
    const params = patternParams(pattern, '/aws/ecs/clusters/cluster/dev/services/service/api') ?? {};
    expect(params).toEqual({ cluster: 'dev', service: 'api' });
    expect(typeof screen.title === 'string' ? screen.title : screen.title(params, NO_QUERY)).toBe('api');
    expect(typeof screen.crumbs === 'function' ? screen.crumbs(params, NO_QUERY) : screen.crumbs).toEqual([
      { text: 'Clusters', href: '/aws/ecs/clusters' },
      { text: 'dev', href: '/aws/ecs/clusters/cluster/dev' },
      { text: 'api' },
    ]);
    expect(screen.navigation.activeHref).toBe('/aws/ecs/clusters');
    expect(screen.navigation.header).toEqual({ text: 'ECS', href: '/aws/ecs' });
  });
});
