import { describe, expect, it } from 'vitest';

import { entryFaults } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const originalLinks = [
  { label: 'Event Functions', path: '/aws/lambda/functions' },
  { label: 'Layers', path: '/aws/lambda/layers' },
];

describe("Lambda's entries (issue 650)", () => {
  it('follows the area entry rules when collected on its own', () => {
    const screens = collectScreens([{ folder: 'lambda', screens: SCREENS }]);
    expect(entryFaults([{ folder: 'lambda', groups: ENTRIES }], screens)).toEqual([]);
  });

  it('has one unnamed group for its model, without a sub-service', () => {
    expect(ENTRIES).toHaveLength(1);
    expect(ENTRIES[0]?.name).toBeUndefined();
    expect(ENTRIES[0]?.subService).toBeUndefined();
  });

  it('keeps the original link labels and addresses at registered screens below the service route', () => {
    const entries = ENTRIES.flatMap((group) => group.entries);
    expect(entries.map((entry) => entry.path)).not.toContain('/aws/lambda');
    for (const { label, path } of originalLinks) {
      expect(entries.find((entry) => entry.path === path)?.label, path).toBe(label);
      expect(
        SCREENS.some((screen) => screen.paths.includes(path)),
        path,
      ).toBe(true);
    }
  });

  it('writes the original links in their original order', () => {
    const paths = originalLinks.map((link) => link.path);
    const writtenPaths = ENTRIES.flatMap((group) => group.entries.map((entry) => entry.path));
    expect(writtenPaths.filter((path) => paths.includes(path))).toEqual(paths);
  });
});
