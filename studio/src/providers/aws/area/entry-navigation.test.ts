import { describe, expect, it } from 'vitest';

import type { EntryGroup, ResourceEntry } from './entries';
import { entryNavigation } from './entry-navigation';
import type { AreaScreen, ScreenNavigation } from './screens';

function resource(label: string): ResourceEntry {
  return { label, path: `/aws/example/${label.toLowerCase()}`, listedBy: `List${label}` };
}

const widgets = resource('Widgets');
const bins = resource('Bins');
const tags = resource('Tags');
const alerts = resource('Alerts');
const navigation: ScreenNavigation = {
  header: { text: 'Example', href: '/aws/example' },
  activeHref: widgets.path,
};

function screenAt({ label, path }: ResourceEntry): AreaScreen {
  return {
    service: '/example',
    paths: [path],
    title: label,
    crumbs: [{ text: label }],
    navigation,
    Page: () => null,
  };
}

const subService = { name: 'Sub-service', path: '/aws/example/sub-service' };
const groups: EntryGroup[] = [
  { name: 'Example', entries: [widgets] },
  { name: 'Second', subService, entries: [bins] },
  { name: 'Third', entries: [tags] },
];

describe('navigation from service entries (issue 650, D2)', () => {
  const single = [{ entries: [widgets, tags, bins, alerts] }];
  const screens = [screenAt(bins), screenAt(widgets)];

  it('shows a single group as flat links, with built links in written order and unbuilt links by label', () => {
    expect(entryNavigation(navigation, single, screens, '/example').items).toEqual([
      { type: 'link', text: 'Widgets', href: widgets.path },
      { type: 'link', text: 'Bins', href: bins.path },
      { type: 'link', text: 'Alerts', href: alerts.path, info: 'No screen yet' },
      { type: 'link', text: 'Tags', href: tags.path, info: 'No screen yet' },
    ]);
  });

  it('moves a newly built entry above every unbuilt entry and drops its status text', () => {
    expect(entryNavigation(navigation, single, [...screens, screenAt(alerts)], '/example').items).toEqual([
      expect.objectContaining({ href: widgets.path }),
      expect.objectContaining({ href: bins.path }),
      { type: 'link', text: 'Alerts', href: alerts.path },
      expect.objectContaining({ href: tags.path, info: 'No screen yet' }),
    ]);
  });

  it('names each group and places the sub-service link inside its group', () => {
    expect(entryNavigation(navigation, groups, screens, '/example').items).toEqual([
      expect.objectContaining({ type: 'section', text: 'Example' }),
      expect.objectContaining({
        type: 'section',
        text: 'Second',
        items: [
          { type: 'link', text: bins.label, href: bins.path },
          { type: 'link', text: subService.name, href: subService.path, info: 'No screen yet' },
        ],
      }),
      expect.objectContaining({ type: 'section', text: 'Third' }),
    ]);
  });

  it('expands the current group', () => {
    expect(entryNavigation({ ...navigation, activeHref: bins.path }, groups, screens, '/example').items).toEqual([
      expect.objectContaining({ defaultExpanded: false }),
      expect.objectContaining({ defaultExpanded: true }),
      expect.objectContaining({ defaultExpanded: false }),
    ]);
  });

  it('keeps the navigation of a service without entries unchanged', () => {
    const legacy: ScreenNavigation = {
      ...navigation,
      items: [{ type: 'link', text: widgets.label, href: widgets.path }],
    };
    expect(entryNavigation(legacy, undefined, screens, '/example')).toBe(legacy);
  });
});
