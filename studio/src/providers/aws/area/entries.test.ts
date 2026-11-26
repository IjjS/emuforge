import { describe, expect, it } from 'vitest';

import {
  collectEntries,
  ENTRY_FOLDERS,
  entryFaults,
  entryFolders,
  entryHasScreen,
  type EntryGroup,
  type ResourceEntry,
} from './entries';
import { SCREENS, type AreaScreen } from './screens';

const accounts: ResourceEntry = { label: 'Accounts', path: '/aws/example/accounts', listedBy: 'ListAccounts' };
const groups: ResourceEntry = { label: 'Groups', path: '/aws/example/groups', listedBy: 'ListGroups' };
const screen: AreaScreen = {
  service: '/example',
  paths: [accounts.path],
  title: accounts.label,
  crumbs: [{ text: accounts.label }],
  navigation: { header: { text: 'Example', href: '/aws/example' }, activeHref: accounts.path },
  Page: () => null,
};

function faults(entries: readonly ResourceEntry[], screens: readonly AreaScreen[] = [screen]) {
  return entryFaults([{ folder: 'example', groups: [{ entries }] }], screens);
}

describe('the AWS area entry registry (issue 650, D2)', () => {
  it('collects entries under their folder routes in the order written', () => {
    const example: EntryGroup[] = [
      { name: 'Main', entries: [groups, accounts] },
      { name: 'Second', entries: [] },
    ];
    const other = [{ entries: [{ ...accounts, path: '/aws/other/accounts' }] }];
    expect(
      collectEntries(
        entryFolders({
          './services/example/entries.ts': { ENTRIES: example },
          './services/other/entries.ts': { ENTRIES: other },
        }),
      ),
    ).toEqual([
      { service: '/example', groups: example },
      { service: '/other', groups: other },
    ]);
  });

  it('accepts the collected entries of the real service folders', () => {
    expect(entryFaults(ENTRY_FOLDERS, SCREENS)).toEqual([]);
  });

  it.each(['/aws/other/accounts', '/aws/example'])('reports %s outside the entries below the folder route', (path) => {
    expect(faults([{ ...accounts, path }])).toEqual([expect.stringContaining(`example: the entry path ${path}`)]);
  });

  it('reports a duplicate path and a duplicate label within one service', () => {
    expect(faults([accounts, { ...groups, path: accounts.path }, { ...groups, label: accounts.label }])).toEqual([
      expect.stringContaining(`${accounts.path} appears twice`),
      expect.stringContaining('"Accounts" appears twice'),
    ]);
  });

  it('allows the same label in two services', () => {
    const other = { ...accounts, path: '/aws/other/accounts' };
    expect(
      entryFaults(
        [
          { folder: 'example', groups: [{ entries: [accounts] }] },
          { folder: 'other', groups: [{ entries: [other] }] },
        ],
        [screen, { ...screen, service: '/other', paths: [other.path] }],
      ),
    ).toEqual([]);
  });

  it('reports a missing or foreign parent and a missing or foreign destination', () => {
    const entry = {
      ...groups,
      listedInside: '/aws/other/accounts',
      shownIn: { entry: '/aws/example/missing', place: 'details' },
    };
    expect(faults([accounts, entry])).toEqual([
      expect.stringContaining('"Groups" is listed inside /aws/other/accounts'),
      expect.stringContaining('"Groups" is shown today in /aws/example/missing'),
    ]);
  });

  it('requires a screen for the shown-in destination even if the listed kind is elsewhere', () => {
    const entry = { ...accounts, shownIn: { entry: groups.path, place: 'details' } };
    expect(faults([entry, groups])).toEqual([expect.stringContaining(`${groups.path}, which has no screen`)]);
  });

  it('accepts a shown-in destination when the listed kind has also gained a screen', () => {
    const entry = { ...groups, shownIn: { entry: accounts.path, place: 'details' } };
    expect(faults([accounts, entry])).toEqual([]);
    expect(faults([accounts, entry], [screen, { ...screen, paths: [groups.path] }])).toEqual([]);
  });

  it('reports unnamed groups and a sub-service on the first group', () => {
    const subService = { name: 'Sub-service', path: '/aws/example/sub-service' };
    expect(
      entryFaults(
        [
          {
            folder: 'example',
            groups: [
              { entries: [], subService },
              { name: 'Second', entries: [] },
            ],
          },
        ],
        [screen],
      ),
    ).toEqual([expect.stringContaining('every group'), expect.stringContaining('first group')]);
  });

  it('reports entries without screens and screens with their own items alongside entries', () => {
    expect(faults([accounts], [])).toEqual([expect.stringContaining('requires a screens.ts')]);
    expect(faults([accounts], [{ ...screen, navigation: { ...screen.navigation, items: [] } }])).toEqual([
      expect.stringContaining('gives navigation items alongside entries.ts'),
    ]);
  });

  it('derives screen availability from matching registered paths', () => {
    expect(entryHasScreen([screen], '/example', accounts.path)).toBe(true);
    expect(entryHasScreen([], '/example', accounts.path)).toBe(false);
  });
});
