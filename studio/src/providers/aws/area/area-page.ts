import { AWS_NAME, AWS_PATH } from '../identity';
import { SERVICES, type Service } from '../services';
import { SCREENS, type AreaScreen } from './screens';

/** What the AWS area shows at a path. */
export type AreaPage =
  | { kind: 'index' }
  | { kind: 'screen'; service: Service; screen: AreaScreen }
  | { kind: 'service'; service: Service }
  | { kind: 'not-found' };

/**
 * The area's page for a path under `/aws`: the index at `/aws`; at a path a screen of the service lists, that screen;
 * the service's "no screen yet" page at its route and every other path below it; the area's "Page not found" for any
 * other path.
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
  const screen = SCREENS.find((entry) => entry.service === service.route && entry.paths.includes(pathname));
  return screen === undefined ? { kind: 'service', service } : { kind: 'screen', service, screen };
}

/** The page's title, its `h1`. */
export function areaPageTitle(page: AreaPage): string {
  switch (page.kind) {
    case 'index':
      return AWS_NAME;
    case 'screen':
      return page.screen.title;
    case 'service':
      return page.service.label;
    case 'not-found':
      return 'Page not found';
  }
}
