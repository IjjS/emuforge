import { describe, expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const folder = 'sns';
const service = '/sns';
const screens = collectScreens([{ folder, screens: SCREENS }]);
const entries = ENTRIES.flatMap((group) => group.entries);

describe('sns entries', () => {
  it('follows the area entry rules for this service alone', () => {
    expect(entryFaults([{ folder, groups: ENTRIES }], screens)).toEqual([]);
  });

  it('keeps the built entries and their labels and paths in navigation order', () => {
    const builtEntries = entries.filter(({ path }) => entryHasScreen(screens, service, path));
    expect(builtEntries.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: 'Topics', path: '/aws/sns/topics' },
    ]);
  });

  it('has one unnamed group', () => {
    expect(ENTRIES.map(({ name, subService }) => [name, subService])).toEqual([[undefined, undefined]]);
  });
});
