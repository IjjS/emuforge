import { describe, expect, it } from 'vitest';

import { matchesPattern, patternParams } from '../../screen-paths';
import { FAMILY_PATTERN } from './format';
import { REGISTER_SCREENS } from './register-screens';
import { SCREENS } from './screens';

// Test criteria, "Unit s7 — services/ecs/register-screens.test.ts" (issue 575).

const NO_QUERY = new URLSearchParams();
const REGISTER = '/aws/ecs/task-definitions/register';

describe("ECS's Register task definition screen", () => {
  it('S10 at its route, crumbs "Task definitions > Register task definition", "Task definitions" current; a family named register still opens S8', () => {
    expect(REGISTER_SCREENS).toHaveLength(1);
    const [screen] = REGISTER_SCREENS;
    if (screen === undefined) {
      throw new Error('no screen');
    }
    expect(SCREENS).toContain(screen);
    const [pattern] = screen.paths;
    if (pattern === undefined) {
      throw new Error('no path');
    }
    expect(matchesPattern(pattern, REGISTER)).toBe(true);
    const params = patternParams(pattern, REGISTER) ?? {};
    expect(typeof screen.title === 'string' ? screen.title : screen.title(params, NO_QUERY)).toBe(
      'Register task definition',
    );
    expect(typeof screen.crumbs === 'function' ? screen.crumbs(params, NO_QUERY) : screen.crumbs).toEqual([
      { text: 'Task definitions', href: '/aws/ecs/task-definitions' },
      { text: 'Register task definition' },
    ]);
    expect(screen.navigation.activeHref).toBe('/aws/ecs/task-definitions');

    // A family named `register` is S8's address, under `family/`, and never S10's.
    const family = '/aws/ecs/task-definitions/family/register';
    expect(matchesPattern(pattern, family)).toBe(false);
    expect(matchesPattern(FAMILY_PATTERN, family)).toBe(true);
    expect(patternParams(FAMILY_PATTERN, family)).toEqual({ family: 'register' });
    const s8 = SCREENS.find((each) => each.paths.some((path) => matchesPattern(path, family)));
    expect(s8?.paths).toEqual([FAMILY_PATTERN]);
  });
});
