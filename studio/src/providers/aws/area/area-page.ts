import { AWS_NAME, AWS_PATH } from '../identity';
import { SERVICES, type Service } from '../services';
import { comparePatterns, matchingScreens, patternParams, screenTitle, type ScreenParams } from './screen-paths';
import { SCREENS, type AreaScreen } from './screens';

/** What the AWS area shows at a path. */
export type AreaPage =
  | { kind: 'index' }
  | { kind: 'screen'; service: Service; screen: AreaScreen; params: ScreenParams }
  | { kind: 'service'; service: Service }
  | { kind: 'not-found' };

/**
 * The area's page for a path under `/aws`: the index at `/aws`; at a path a screen of the service matches, that
 * screen, the one with a literal segment first where two patterns differ (issue 386, R4.2, R4.3), with its
 * parameters' values decoded once (R4.4); the area's "Page not found" when such a value is not valid
 * percent-encoding; the service's "no screen yet" page at its route and every other path below it; the area's
 * "Page not found" for any other path.
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
  const [match] = matchingScreens(SCREENS, service.route, pathname).sort((a, b) =>
    comparePatterns(a.pattern, b.pattern),
  );
  if (match === undefined) {
    return { kind: 'service', service };
  }
  const params = patternParams(match.pattern, pathname);
  return params === undefined ? { kind: 'not-found' } : { kind: 'screen', service, screen: match.screen, params };
}

/** The page's title: what the area reports to Studio's frame. */
export function areaPageTitle(page: AreaPage): string {
  switch (page.kind) {
    case 'index':
      return AWS_NAME;
    case 'screen':
      return screenTitle(page.screen, page.params);
    case 'service':
      return page.service.label;
    case 'not-found':
      return 'Page not found';
  }
}
