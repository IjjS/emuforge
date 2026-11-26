import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';
import { createElement, useCallback, useId } from 'react';

import { entryHasScreen, type EntryGroup, type ResourceEntry } from './entries';
import type { AreaScreen, ScreenNavigation } from './screens';

export const NO_SCREEN_ENTRY_STATUS = 'No screen yet';

function NavigationEntryStatus() {
  const id = useId();
  // SideNavigation renders its info slot beside the anchor and has no link-level ARIA prop.
  const associate = useCallback(
    (status: HTMLSpanElement | null) => {
      const anchor = status?.closest('li')?.querySelector('a');
      if (!anchor) return;
      const previous = anchor.getAttribute('aria-describedby');
      anchor.setAttribute('aria-describedby', previous ? `${previous} ${id}` : id);
      return () => {
        if (previous === null) anchor.removeAttribute('aria-describedby');
        else anchor.setAttribute('aria-describedby', previous);
      };
    },
    [id],
  );
  return createElement('span', { id, ref: associate }, NO_SCREEN_ENTRY_STATUS);
}

/** Links with screens in written order, followed by links without screens in label order. */
export function entryLinks(
  entries: readonly Pick<ResourceEntry, 'label' | 'path'>[],
  screens: readonly AreaScreen[],
  service: string,
): SideNavigationProps.Link[] {
  const built: SideNavigationProps.Link[] = [];
  const unbuilt: SideNavigationProps.Link[] = [];
  for (const entry of entries) {
    const link: SideNavigationProps.Link = { type: 'link', text: entry.label, href: entry.path };
    if (entryHasScreen(screens, service, entry.path)) {
      built.push(link);
    } else {
      unbuilt.push({ ...link, info: NO_SCREEN_ENTRY_STATUS });
    }
  }
  return [...built, ...unbuilt.sort((a, b) => a.text.localeCompare(b.text, 'en'))];
}

/** Keep existing screens in reach and split long lists of unbuilt kinds into alphabetical ranges. */
function navigationItems(links: SideNavigationProps.Link[], activeHref: string): SideNavigationProps.Item[] {
  const built = links.filter((link) => link.info === undefined);
  const unbuilt = links
    .filter((link) => link.info !== undefined)
    .map((link) => ({ ...link, info: createElement(NavigationEntryStatus) }));
  if (unbuilt.length <= 24) return [...built, ...unbuilt];

  const ranges: SideNavigationProps.Link[][] = [];
  let range: SideNavigationProps.Link[] = [];
  for (const link of unbuilt) {
    // Keep entries with a shared initial together so every label belongs to just one range.
    if (range.length >= 10 && range.at(-1)?.text[0] !== link.text[0]) {
      ranges.push(range);
      range = [];
    }
    range.push(link);
  }
  ranges.push(range);

  return [
    ...built,
    ...ranges.map<SideNavigationProps.Section>((items) => {
      const first = items[0].text[0];
      const last = items[items.length - 1].text[0];
      return {
        type: 'section',
        text: first === last ? first : `${first}–${last}`,
        items,
        defaultExpanded: items.some((link) => link.href === activeHref),
      };
    }),
  ];
}

/** Use a service's entries when present, keeping the header and current address the screen chose. */
export function entryNavigation(
  navigation: ScreenNavigation,
  groups: readonly EntryGroup[] | undefined,
  screens: readonly AreaScreen[],
  service: string,
): ScreenNavigation {
  if (groups === undefined) return navigation;

  const sections = groups.map((group) => {
    const { subService, entries } = group;
    const groupEntries =
      subService === undefined ? entries : [{ label: subService.name, path: subService.path }, ...entries];
    const links = entryLinks(groupEntries, screens, service);
    return { name: group.name, links, current: links.some((link) => link.href === navigation.activeHref) };
  });

  const hasCurrentGroup = sections.some(({ current }) => current);
  const items = sections.flatMap<SideNavigationProps.Item>(({ name, links, current }, index) => {
    const items = navigationItems(links, navigation.activeHref);
    return groups.length < 2 || name === undefined
      ? items
      : [{ type: 'section', text: name, items, defaultExpanded: current || (!hasCurrentGroup && index === 0) }];
  });
  return { ...navigation, items };
}
