import { describe, expect, it } from 'vitest';

import { findResourceEntry } from '../../entries';
import { patternFault, samePatterns } from '../../screen-paths';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = SCREENS.find((candidate) => candidate.paths.includes(path));
  expect(screen, path).toBeDefined();
  return screen as NonNullable<typeof screen>;
}

function title(path: string) {
  const value = screenAt(path).title;
  return typeof value === 'string' ? value : value({}, NO_QUERY);
}

function crumbs(path: string) {
  const value = screenAt(path).crumbs;
  return typeof value === 'function' ? value({}, NO_QUERY) : value;
}

describe("ECS's screens", () => {
  it('S1 at /aws/ecs and /aws/ecs/clusters, S2 at /aws/ecs/clusters/create, with the crumbs of R3 and "Clusters" current', () => {
    expect(screenAt('/aws/ecs')).toBe(screenAt('/aws/ecs/clusters'));
    expect(title('/aws/ecs')).toBe('Clusters');
    expect(crumbs('/aws/ecs')).toEqual([{ text: 'Clusters' }]);
    expect(crumbs('/aws/ecs/clusters')).toEqual([{ text: 'Clusters' }]);

    expect(title('/aws/ecs/clusters/create')).toBe('Create cluster');
    expect(crumbs('/aws/ecs/clusters/create')).toEqual([
      { text: 'Clusters', href: '/aws/ecs/clusters' },
      { text: 'Create cluster' },
    ]);
    for (const path of ['/aws/ecs', '/aws/ecs/clusters/create']) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/ecs/clusters');
      expect(screenAt(path).navigation.header).toEqual({ text: 'ECS', href: '/aws/ecs' });
    }
  });

  it('marks the entry for the section of each screen current', () => {
    for (const { paths, navigation } of SCREENS) {
      const isTaskDefinitionScreen = paths[0]?.startsWith('/aws/ecs/task-definitions');
      const activeHref = isTaskDefinitionScreen ? '/aws/ecs/task-definitions' : '/aws/ecs/clusters';
      expect(navigation.activeHref, paths[0]).toBe(activeHref);
      expect(findResourceEntry(ENTRIES, navigation.activeHref)).toBeDefined();
      expect(navigation).not.toHaveProperty('items');
    }
  });

  it('every screen has a path below /aws/ecs, and no path twice', () => {
    const paths: string[] = [];
    for (const screen of SCREENS) {
      for (const path of screen.paths) {
        expect(patternFault(path)).toBeUndefined();
        expect(path === '/aws/ecs' || path.startsWith('/aws/ecs/')).toBe(true);
        expect(paths.some((other) => samePatterns(other, path))).toBe(false);
        paths.push(path);
      }
    }
  });
});
