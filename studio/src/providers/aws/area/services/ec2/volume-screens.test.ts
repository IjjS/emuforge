import { expect, it } from 'vitest';

import { matchesPattern, patternParams } from '../../screen-paths';
import { SCREENS } from './screens';
import { VOLUME_SCREENS } from './volume-screens';

const list = '/aws/ec2/volumes';

it.each([
  [list, 'Volumes', [{ text: 'Volumes' }]],
  [`${list}/create`, 'Create volume', [{ text: 'Volumes', href: list }, { text: 'Create volume' }]],
  [`${list}/volume/vol-1`, 'vol-1', [{ text: 'Volumes', href: list }, { text: 'vol-1' }]],
] as const)('registers %s with its title, crumbs and active Volumes entry', (path, title, crumbs) => {
  const screen = SCREENS.find(({ paths }) => paths.some((pattern) => matchesPattern(pattern, path)));
  if (screen === undefined) throw new Error(`No screen for ${path}`);
  const params = screen.paths.map((pattern) => patternParams(pattern, path)).find((value) => value !== undefined) ?? {};
  const query = new URLSearchParams();
  expect(VOLUME_SCREENS).toContain(screen);
  expect(typeof screen.title === 'function' ? screen.title(params, query) : screen.title).toBe(title);
  expect(typeof screen.crumbs === 'function' ? screen.crumbs(params, query) : screen.crumbs).toEqual(crumbs);
  expect(screen.navigation.activeHref).toBe(list);
});
