import { describe, expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const folder = 'dynamodb';
const service = '/dynamodb';
const screens = collectScreens([{ folder, screens: SCREENS }]);
const entries = ENTRIES.flatMap((group) => group.entries);

describe('dynamodb entries', () => {
  it('follows the area entry rules for this service alone', () => {
    expect(entryFaults([{ folder, groups: ENTRIES }], screens)).toEqual([]);
  });

  it('keeps the built entries and their labels and paths in navigation order', () => {
    const builtEntries = entries.filter(({ path }) => entryHasScreen(screens, service, path));
    expect(builtEntries.map(({ label, path }) => ({ label, path }))).toEqual([
      { label: 'Tables', path: '/aws/dynamodb/tables' },
    ]);
  });

  it('lists the DynamoDB and DAX models in order with the DAX entry in its group', () => {
    expect(ENTRIES.map(({ name, subService }) => [name, subService])).toEqual([
      ['DynamoDB', undefined],
      ['DynamoDB Accelerator (DAX)', { name: 'DynamoDB Accelerator (DAX)', path: '/aws/dynamodb/dax' }],
    ]);
  });

  it('marks the list entry current on every screen', () => {
    for (const { navigation } of SCREENS) {
      expect(navigation.activeHref).toBe('/aws/dynamodb/tables');
      expect(navigation).not.toHaveProperty('items');
    }
  });
});
