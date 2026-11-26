import { expect, it } from 'vitest';

import { ENTRIES } from './entries';
import { apisPath, servicePath } from './format';
import { SCREENS } from './screens';
import { SCREENS as chooseApiScreens } from './screens/choose-api';

it('lists 35 distinct resource entry points, with unique names within a group', () => {
  expect(ENTRIES).toHaveLength(35);
  expect(new Set(ENTRIES.map(({ path }) => path)).size).toBe(ENTRIES.length);
  expect(new Set(ENTRIES.map(({ group, name }) => `${group}:${name}`)).size).toBe(ENTRIES.length);
  for (const { path, name, group } of ENTRIES) {
    expect(['core', 'REST APIs', 'HTTP and WebSocket APIs']).toContain(group);
    expect(name).not.toBe('');
    expect(path.startsWith(`${servicePath}/`) || path === servicePath).toBe(true);
  }
});

it('opens the built APIs screen at the core entry', () => {
  expect(ENTRIES.find((entry) => entry.name === 'APIs')).toEqual({
    group: 'core',
    name: 'APIs',
    path: apisPath,
    built: true,
  });
});

it.each([
  ['resources', 'Resources'],
  ['stages', 'Stages'],
  ['v2/routes', 'Routes'],
  ['v2/integrations', 'Integrations'],
  ['v2/stages', 'Stages'],
])('registers the built %s entry as a Choose an API screen', (suffix, name) => {
  const path = `${servicePath}/${suffix}`;
  expect(ENTRIES.find((entry) => entry.path === path)).toMatchObject({ name, built: true });
  expect(chooseApiScreens.find((screen) => screen.paths.includes(path))).toMatchObject({
    title: name,
    crumbs: [{ text: name }],
    navigation: { activeHref: path },
  });
  expect(SCREENS.filter((screen) => screen.paths.includes(path))).toHaveLength(1);
  expect(SCREENS.find((screen) => screen.paths.includes(apisPath))?.leadsTo).not.toContain(path);
});
