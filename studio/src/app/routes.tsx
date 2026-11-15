import type { RouteObject } from 'react-router';

import { HomePage } from '../features/home/home-page';
import { NoScreenPage } from './no-screen-page';
import { NotFoundPage } from './not-found-page';
import { SERVICES } from '../providers/aws/services';
import { Shell, type ShellHandle } from './shell';

const home: ShellHandle = { activeHref: '/' };

const notFound: ShellHandle = {
  activeHref: '',
  breadcrumb: (pathname) => ({ text: 'Page not found', href: pathname }),
};

/**
 * The routes of requirement 2: Home at `/`; each service at its route and every path below it, with "no screen
 * yet"; anything else "Page not found". Routes stay thin: each renders one page.
 */
export const routes: RouteObject[] = [
  {
    element: <Shell />,
    children: [
      { index: true, element: <HomePage />, handle: home },
      ...SERVICES.map((service): RouteObject => {
        const handle: ShellHandle = {
          activeHref: service.route,
          breadcrumb: () => ({ text: service.label, href: service.route }),
        };
        return { path: `${service.route}/*`, element: <NoScreenPage service={service} />, handle };
      }),
      { path: '*', element: <NotFoundPage />, handle: notFound },
    ],
  },
];
