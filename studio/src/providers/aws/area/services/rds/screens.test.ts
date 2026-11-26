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

function title(path: string, params: Record<string, string> = {}) {
  const value = screenAt(path).title;
  return typeof value === 'string' ? value : value(params, NO_QUERY);
}

function crumbs(path: string, params: Record<string, string> = {}) {
  const value = screenAt(path).crumbs;
  return typeof value === 'function' ? value(params, NO_QUERY) : value;
}

describe("RDS's screens", () => {
  it('S1 at /aws/rds and /aws/rds/instances, S3 at its instance path, with titles, crumbs and "DB instances" active', () => {
    expect(screenAt('/aws/rds')).toBe(screenAt('/aws/rds/instances'));
    expect(title('/aws/rds')).toBe('DB instances');
    expect(crumbs('/aws/rds')).toEqual([{ text: 'DB instances' }]);

    const instance = '/aws/rds/instances/instance/{id}';
    expect(title(instance, { id: 'app-db' })).toBe('app-db');
    expect(crumbs(instance, { id: 'app-db' })).toEqual([
      { text: 'DB instances', href: '/aws/rds/instances' },
      { text: 'app-db' },
    ]);
    for (const path of ['/aws/rds', instance]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/rds/instances');
      expect(screenAt(path).navigation.header).toEqual({ text: 'RDS', href: '/aws/rds' });
    }
  });

  it('every screen has a path below /aws/rds, a title, crumbs and a navigation, and no path twice', () => {
    const paths: string[] = [];
    for (const screen of SCREENS) {
      expect(screen.paths.length).toBeGreaterThan(0);
      for (const path of screen.paths) {
        expect(patternFault(path)).toBeUndefined();
        expect(path === '/aws/rds' || path.startsWith('/aws/rds/')).toBe(true);
        expect(paths.some((other) => samePatterns(other, path))).toBe(false);
        paths.push(path);
        const sample = Object.fromEntries([...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, 'x-1']));
        expect(title(path, sample)).not.toBe('');
        expect(crumbs(path, sample).length).toBeGreaterThan(0);
      }
      expect(screen.navigation.header.text).toBe('RDS');
      expect(screen.navigation.items).toBeUndefined();
      expect(findResourceEntry(ENTRIES, screen.navigation.activeHref)).toBeDefined();
    }
  });
});
