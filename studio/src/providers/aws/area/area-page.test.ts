import { beforeEach, describe, expect, it, vi } from 'vitest';

import { areaPage, areaPageTitle } from './area-page';
import { entryFaults, entryHasScreen, type EntryGroup } from './entries';
import type { AreaScreen } from './screens';

const registry = vi.hoisted(() => ({ entries: [] as unknown[], screens: [] as unknown[] }));
vi.mock('./screens', () => ({ SCREENS: registry.screens }));
vi.mock('./entries', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./entries')>()),
  ENTRIES: registry.entries,
}));

const service = '/dynamodb';
const route = '/aws/dynamodb';
const widgets = { label: 'Widgets', path: `${route}/widgets`, listedBy: 'ListWidgets' };
const things = {
  label: 'Things',
  path: `${route}/things`,
  listedBy: 'ListThings',
  shownIn: { entry: widgets.path, place: 'the Details tab' },
};
const subService = { name: 'Sub-service', path: `${route}/sub-service` };
const groups: EntryGroup[] = [
  { name: 'DynamoDB', entries: [widgets, things] },
  { name: subService.name, subService, entries: [] },
];
const screen: AreaScreen = {
  service,
  paths: [route, widgets.path],
  title: widgets.label,
  crumbs: [{ text: widgets.label }],
  navigation: { header: { text: 'DynamoDB', href: route }, activeHref: widgets.path },
  Page: () => null,
};

describe('entry pages and screen precedence (issue 650, R5)', () => {
  beforeEach(() => {
    registry.entries.splice(0, registry.entries.length, { service, groups });
    registry.screens.splice(0, registry.screens.length, screen);
  });

  it.each([
    [things.path, things.label],
    [subService.path, subService.name],
  ])('opens %s as an entry page with the matching title and current link', (path, label) => {
    const page = areaPage(path);
    expect(page).toMatchObject({ kind: 'entry', label, navigation: { activeHref: path } });
    expect(areaPageTitle(page)).toBe(label);
  });

  it('opens an existing screen at an entry’s path', () => {
    expect(areaPage(widgets.path)).toMatchObject({ kind: 'screen', screen });
  });

  it.each([`${things.path}/more`, `${route}/no-such-part`])(
    'opens %s as a generic page with no current link',
    (path) => {
      const page = areaPage(path);
      expect(page).toMatchObject({ kind: 'part', above: undefined, navigation: { activeHref: '' } });
      expect(areaPageTitle(page)).toBe('No screen yet');
    },
  );

  it('opens a kind’s new screen without an entry edit or a registry fault', () => {
    const folders = [{ folder: 'dynamodb', groups }];
    expect(entryFaults(folders, [screen])).toEqual([]);
    expect(entryHasScreen([screen], service, things.path)).toBe(false);
    expect(areaPage(things.path).kind).toBe('entry');

    const newScreen = { ...screen, paths: [things.path], title: things.label };
    registry.screens.push(newScreen);
    expect(entryFaults(folders, [screen, newScreen])).toEqual([]);
    expect(entryHasScreen([screen, newScreen], service, things.path)).toBe(true);
    expect(areaPage(things.path)).toMatchObject({ kind: 'screen', screen: newScreen });
  });
});
