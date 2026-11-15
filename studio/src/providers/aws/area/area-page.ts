import { AWS_NAME, AWS_PATH } from '../identity';
import { SERVICES, type Service } from '../services';

/** What the AWS area shows at a path. */
export type AreaPage = { kind: 'index' } | { kind: 'service'; service: Service } | { kind: 'not-found' };

/**
 * The area's page for a path under `/aws`: the index at `/aws`, a service's page at its route and every path below
 * it, and the area's "Page not found" for any other path.
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
  return service === undefined ? { kind: 'not-found' } : { kind: 'service', service };
}

/** The page's title, its `h1`. */
export function areaPageTitle(page: AreaPage): string {
  switch (page.kind) {
    case 'index':
      return AWS_NAME;
    case 'service':
      return page.service.label;
    case 'not-found':
      return 'Page not found';
  }
}
