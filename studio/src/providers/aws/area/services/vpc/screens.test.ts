import { describe, expect, it } from 'vitest';

import { patternFault, samePatterns } from '../../screen-paths';
import { SCREENS } from './screens';
import service from './service.json';

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

describe("VPC's screens", () => {
  it('S1 answers at /aws/vpc and /aws/vpc/vpcs with the title "VPCs", the crumb "VPCs" and "VPCs" active', () => {
    expect(screenAt('/aws/vpc')).toBe(screenAt('/aws/vpc/vpcs'));
    expect(title('/aws/vpc')).toBe('VPCs');
    expect(crumbs('/aws/vpc')).toEqual([{ text: 'VPCs' }]);
    expect(screenAt('/aws/vpc').navigation.activeHref).toBe('/aws/vpc/vpcs');
    expect(screenAt('/aws/vpc').navigation.header).toEqual({ text: 'VPC', href: '/aws/vpc' });
  });

  it('every screen has a path below /aws/vpc, a title, crumbs and a navigation, and no path twice', () => {
    const paths: string[] = [];
    for (const screen of SCREENS) {
      expect(screen.paths.length).toBeGreaterThan(0);
      for (const path of screen.paths) {
        expect(patternFault(path)).toBeUndefined();
        expect(path === '/aws/vpc' || path.startsWith('/aws/vpc/')).toBe(true);
        expect(paths.some((other) => samePatterns(other, path))).toBe(false);
        paths.push(path);
        const sample = Object.fromEntries([...path.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, 'x-1']));
        expect(title(path, sample)).not.toBe('');
        expect(crumbs(path, sample).length).toBeGreaterThan(0);
      }
      expect(screen.navigation.header.text).toBe('VPC');
      expect(screen.navigation.items.length).toBe(4);
    }
  });

  it('service.json gives the label "Amazon Virtual Private Cloud" and the crumb "VPC"', () => {
    expect(service).toEqual({ label: 'Amazon Virtual Private Cloud', crumb: 'VPC' });
  });
});
