import { describe, expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const folder = 'kms';
const service = '/kms';
const screens = collectScreens([{ folder, screens: SCREENS }]);
const entries = ENTRIES.flatMap((group) => group.entries);

describe('kms entries', () => {
  it('follows the area entry rules for this service alone', () => {
    expect(entryFaults([{ folder, groups: ENTRIES }], screens)).toEqual([]);
  });

  it('keeps the built entries and their labels and paths in navigation order', () => {
    const builtEntries = entries.filter(({ path }) => entryHasScreen(screens, service, path));
    expect(builtEntries.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: 'Customer managed keys', path: '/aws/kms/keys' },
    ]);
  });

  it('has one unnamed group', () => {
    expect(ENTRIES.map(({ name, subService }) => [name, subService])).toEqual([[undefined, undefined]]);
  });

  it('registers the list at both the service route and the entry path', () => {
    const list = SCREENS.find((screen) => screen.paths.includes('/aws/kms'));
    expect(list?.title).toBe('Customer managed keys');
    expect(SCREENS.find((screen) => screen.paths.includes('/aws/kms/keys'))).toBe(list);
  });

  it('keeps the service header and marks the list entry current on every screen', () => {
    for (const { navigation } of SCREENS) {
      expect(navigation.header).toEqual({ text: 'KMS', href: '/aws/kms' });
      expect(navigation.activeHref).toBe('/aws/kms/keys');
      expect(navigation).not.toHaveProperty('items');
    }
  });
});
