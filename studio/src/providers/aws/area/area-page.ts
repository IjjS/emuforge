import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import { AWS_NAME, AWS_PATH, servicePath } from '../identity';
import { SERVICES, type Service } from '../services';
import { ENTRIES, type EntryGroup, type ResourceEntry, type SubServiceEntry } from './entries';
import { entryNavigation, resourceLinks } from './entry-navigation';
import {
  comparePatterns,
  firstScreen,
  matchingScreens,
  patternParams,
  screenAbove,
  screenTitle,
  type FirstScreen,
  type ScreenAbove,
  type ScreenParams,
} from './screen-paths';
import { SCREENS, type AreaScreen, type ScreenNavigation } from './screens';

/** What the AWS area shows at a path. */
export type AreaPage =
  | { kind: 'index' }
  | { kind: 'screen'; service: Service; screen: AreaScreen; params: ScreenParams; navigation: ScreenNavigation }
  | EntryAreaPage
  | { kind: 'service'; service: Service }
  | {
      /** A path below a service that has screens, which no screen matches (issue 57, requirement R4). */
      kind: 'part';
      service: Service;
      /** The service's first screen, which the page's first action leads to; none when it has none (R4.1, R4.7). */
      first: FirstScreen | undefined;
      /** The screen the path is below, whose crumbs the page keeps (R4.3, R4.11). */
      above: ScreenAbove | undefined;
      /** The side navigation, its current link already chosen (R4.4). */
      navigation: ScreenNavigation;
    }
  | { kind: 'not-found' };

type EntryMatch =
  | { resource: ResourceEntry; group: EntryGroup }
  | { subService: SubServiceEntry; group: EntryGroup; links: ReturnType<typeof resourceLinks> };

export interface EntryAreaPage {
  kind: 'entry';
  service: Service;
  label: string;
  match: EntryMatch;
  groups: readonly EntryGroup[];
  first: FirstScreen | undefined;
  navigation: ScreenNavigation;
}

/** The `h1` and title of the "no screen yet" page below a service that has screens (issue 57, R4.2). */
export const NO_SCREEN_PART_TITLE = 'No screen yet';

/** Whether `items` hold a link to `href`, at any depth. */
function holdsLink(items: readonly SideNavigationProps.Item[], href: string): boolean {
  return items.some(
    (item) => ('href' in item && item.href === href) || ('items' in item && holdsLink(item.items, href)),
  );
}

/**
 * The navigation of the "no screen yet" page below a service that has screens (R4.4): with a screen above the path,
 * that screen's, as it shows it; with none, the first screen's (else the service's first registered screen's), a link
 * of it current only when its address is the path itself.
 */
function partNavigation(
  screens: readonly AreaScreen[],
  above: ScreenAbove | undefined,
  first: FirstScreen | undefined,
  pathname: string,
): ScreenNavigation {
  if (above !== undefined) {
    return above.screen.navigation;
  }
  const { navigation } = first?.screen ?? (screens[0] as AreaScreen);
  return { ...navigation, activeHref: holdsLink(navigation.items ?? [], pathname) ? pathname : '' };
}

/**
 * The area's page for a path under `/aws`: the index at `/aws`; at a path a screen of the service matches, that
 * screen, the one with a literal segment first where two patterns differ (issue 386, R4.2, R4.3), with its
 * parameters' values decoded once (R4.4); the area's "Page not found" when such a value is not valid
 * percent-encoding; an entry's page at its exact path when no screen matches (issue 650, R5); below a service that has screens, at every other path at or below its route, the "no screen yet"
 * page for that part of it, with the screen the path is below (issue 57, R4); below a service without any screen,
 * its "no screen yet" page at its route and every path below it (R5); the area's "Page not found" for any other path.
 */
export function areaPage(pathname: string): AreaPage {
  if (pathname !== AWS_PATH && !pathname.startsWith(`${AWS_PATH}/`)) {
    return { kind: 'not-found' };
  }
  const rest = pathname.slice(AWS_PATH.length);
  if (rest === '' || rest === '/') {
    return { kind: 'index' };
  }
  const service = SERVICES.find(({ route }) => rest === route || rest.startsWith(`${route}/`));
  if (service === undefined) {
    return { kind: 'not-found' };
  }
  const groups = ENTRIES.find((entry) => entry.service === service.route)?.groups;
  const [match] = matchingScreens(SCREENS, service.route, pathname).sort((a, b) =>
    comparePatterns(a.pattern, b.pattern),
  );
  if (match !== undefined) {
    const params = patternParams(match.pattern, pathname);
    if (params === undefined) return { kind: 'not-found' };
    const { screen } = match;
    return {
      kind: 'screen',
      service,
      screen,
      params,
      navigation: entryNavigation(screen.navigation, groups, SCREENS, service.route),
    };
  }
  const screens = SCREENS.filter((screen) => screen.service === service.route);
  if (screens.length === 0) {
    return { kind: 'service', service };
  }
  const first = firstScreen(screens, service.route, servicePath(service));
  if (groups !== undefined) {
    for (const group of groups) {
      const subService = group.subService;
      const resource = group.entries.find((entry) => entry.path === pathname);
      let match: EntryMatch;
      let label: string;
      if (subService?.path === pathname) {
        match = { subService, group, links: resourceLinks(group.entries, screens, service.route) };
        label = subService.name;
      } else if (resource !== undefined) {
        match = { resource, group };
        label = resource.label;
      } else {
        continue;
      }
      const navigation = partNavigation(screens, undefined, first, pathname);
      return {
        kind: 'entry',
        service,
        label,
        match,
        groups,
        first,
        navigation: entryNavigation({ ...navigation, activeHref: pathname }, groups, screens, service.route),
      };
    }
  }
  const above = screenAbove(screens, service.route, pathname);
  const navigation = partNavigation(screens, above, first, pathname);
  return {
    kind: 'part',
    service,
    first,
    above,
    navigation: entryNavigation(navigation, groups, screens, service.route),
  };
}

/** The page's title: what the area reports to Studio's frame, a screen's for the address's query `query`. */
export function areaPageTitle(page: AreaPage, query: URLSearchParams = new URLSearchParams()): string {
  switch (page.kind) {
    case 'index':
      return AWS_NAME;
    case 'screen':
      return screenTitle(page.screen, page.params, query);
    case 'entry':
      return page.label;
    case 'service':
      return page.service.label;
    case 'part':
      return NO_SCREEN_PART_TITLE;
    case 'not-found':
      return 'Page not found';
  }
}
