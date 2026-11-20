import { describe, expect, it } from 'vitest';

import { DEFINITION_SCREENS } from './definition-screens';

const NO_QUERY = new URLSearchParams();

function screenAt(path: string) {
  const screen = DEFINITION_SCREENS.find((candidate) => candidate.paths.includes(path));
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

describe("ECS's task definition screens", () => {
  it('S7, S8 and S9 at their routes with the crumbs of R3, "Task definitions" current', () => {
    const list = '/aws/ecs/task-definitions';
    expect(title(list)).toBe('Task definitions');
    expect(crumbs(list)).toEqual([{ text: 'Task definitions' }]);

    const family = '/aws/ecs/task-definitions/family/{family}';
    expect(title(family, { family: 'web' })).toBe('web');
    expect(crumbs(family, { family: 'web' })).toEqual([
      { text: 'Task definitions', href: '/aws/ecs/task-definitions' },
      { text: 'web' },
    ]);

    const revision = '/aws/ecs/task-definitions/family/{family}/revision/{revision}';
    expect(title(revision, { family: 'web', revision: '3' })).toBe('web:3');
    expect(crumbs(revision, { family: 'web', revision: '3' })).toEqual([
      { text: 'Task definitions', href: '/aws/ecs/task-definitions' },
      { text: 'web', href: '/aws/ecs/task-definitions/family/web' },
      { text: '3' },
    ]);

    expect(DEFINITION_SCREENS).toHaveLength(3);
    for (const path of [list, family, revision]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/ecs/task-definitions');
      expect(screenAt(path).navigation.header).toEqual({ text: 'ECS', href: '/aws/ecs' });
    }
  });
});
