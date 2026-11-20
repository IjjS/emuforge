import { describe, expect, it } from 'vitest';

import { patternFault, samePatterns } from '../../screen-paths';
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

describe("EC2's screens", () => {
  it('S1 at /aws/ec2 and /aws/ec2/instances, S3 at its instance path, with titles, crumbs and "Instances" active', () => {
    expect(screenAt('/aws/ec2')).toBe(screenAt('/aws/ec2/instances'));
    expect(title('/aws/ec2')).toBe('Instances');
    expect(crumbs('/aws/ec2')).toEqual([{ text: 'Instances' }]);

    const instance = '/aws/ec2/instances/instance/{id}';
    expect(title(instance, { id: 'i-0abc' })).toBe('i-0abc');
    expect(crumbs(instance, { id: 'i-0abc' })).toEqual([
      { text: 'Instances', href: '/aws/ec2/instances' },
      { text: 'i-0abc' },
    ]);
    for (const path of ['/aws/ec2', instance]) {
      expect(screenAt(path).navigation.activeHref).toBe('/aws/ec2/instances');
      expect(screenAt(path).navigation.header).toEqual({ text: 'EC2', href: '/aws/ec2' });
    }
  });

  it('every screen has a path below /aws/ec2, a title, crumbs and a navigation, and no path twice', () => {
    const paths: string[] = [];
    for (const screen of SCREENS) {
      expect(screen.paths.length).toBeGreaterThan(0);
      for (const path of screen.paths) {
        expect(patternFault(path)).toBeUndefined();
        expect(path === '/aws/ec2' || path.startsWith('/aws/ec2/')).toBe(true);
        expect(paths.some((other) => samePatterns(other, path))).toBe(false);
        paths.push(path);
        const sample = Object.fromEntries([...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, 'x-1']));
        expect(title(path, sample)).not.toBe('');
        expect(crumbs(path, sample).length).toBeGreaterThan(0);
      }
      expect(screen.navigation.header.text).toBe('EC2');
      expect(screen.navigation.items).toContainEqual({ type: 'link', text: 'Volumes', href: '/aws/ec2/volumes' });
      expect(screen.navigation.items).toHaveLength(4);
    }
  });
});
