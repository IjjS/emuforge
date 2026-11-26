import { expect, it } from 'vitest';

import { ENTRIES } from './entries';
import { apisPath, servicePath } from './format';

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
