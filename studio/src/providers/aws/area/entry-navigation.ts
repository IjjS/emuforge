import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import { entryHasScreen, type EntryGroup, type ResourceEntry } from './entries';
import type { AreaScreen, ScreenNavigation } from './screens';

export const NO_SCREEN_ENTRY_STATUS = 'No screen yet';

/** The resource-kind links, shared by the navigation and the sub-service page. */
export function resourceLinks(
  entries: readonly ResourceEntry[],
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

/** Use a service's entries when present, keeping the header and current address the screen chose. */
export function entryNavigation(
  navigation: ScreenNavigation,
  groups: readonly EntryGroup[] | undefined,
  screens: readonly AreaScreen[],
  service: string,
): ScreenNavigation {
  if (groups === undefined) return navigation;

  const sections = groups.map((group) => {
    const links = resourceLinks(group.entries, screens, service);
    if (group.subService !== undefined) {
      const { name, path } = group.subService;
      const link: SideNavigationProps.Link = { type: 'link', text: name, href: path };
      links.unshift(entryHasScreen(screens, service, path) ? link : { ...link, info: NO_SCREEN_ENTRY_STATUS });
    }
    return { name: group.name, links, current: links.some((link) => link.href === navigation.activeHref) };
  });

  const hasCurrentGroup = sections.some(({ current }) => current);
  const items = sections.flatMap<SideNavigationProps.Item>(({ name, links, current }, index) =>
    groups.length < 2 || name === undefined
      ? links
      : [{ type: 'section', text: name, items: links, defaultExpanded: current || (!hasCurrentGroup && index === 0) }],
  );
  return { ...navigation, items };
}
