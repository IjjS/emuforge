import { describe, expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const FOLDER = 'vpc';
const SCREENS_WITH_SERVICE = collectScreens([{ folder: FOLDER, screens: SCREENS }]);

const MAIN_LINKS = [
  { label: 'VPCs', path: '/aws/vpc/vpcs' },
  { label: 'Subnets', path: '/aws/vpc/subnets' },
  { label: 'Route tables', path: '/aws/vpc/route-tables' },
  { label: 'Internet gateways', path: '/aws/vpc/internet-gateways' },
];

describe("VPC's entries", () => {
  it('passes the area entry rules when collected on its own', () => {
    expect(entryFaults([{ folder: FOLDER, groups: ENTRIES }], SCREENS_WITH_SERVICE)).toEqual([]);
  });

  it('gives its single API model one unnamed group without a sub-service', () => {
    expect(ENTRIES).toHaveLength(1);
    expect(ENTRIES[0]?.name).toBeUndefined();
    expect(ENTRIES[0]?.subService).toBeUndefined();
  });

  it("keeps main's navigation labels and paths in order, with a screen at each path below the service route", () => {
    const preserved = ENTRIES.flatMap(({ entries }) => entries).slice(0, MAIN_LINKS.length);
    expect(preserved.map(({ label, path }) => ({ label, path }))).toEqual(MAIN_LINKS);
    for (const { path } of preserved) {
      expect(path).not.toBe('/aws/vpc');
      expect(entryHasScreen(SCREENS_WITH_SERVICE, `/${FOLDER}`, path)).toBe(true);
    }
  });
});
