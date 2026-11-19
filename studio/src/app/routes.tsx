import { lazy } from 'react';
import type { RouteObject } from 'react-router';

import { ConnectionsPage } from '../features/connections/connections-page';
import { HomePage } from '../features/home/home-page';
import { NotFoundPage } from '../features/not-found/not-found-page';
import { Frame, ProviderPage, StudioPage } from './frame';
import { PROVIDERS } from './provider-list';

/**
 * The routes of requirement section 4, inside Studio's frame: Home at `/`; the connections at `/connections` (issue
 * 486, R1); every path under a provider's segment (`/aws`, `/aws/...`) to that provider's area, loaded only when one
 * of its paths is opened; every other path to Studio's "Page not found". Routes stay thin: each renders one page.
 */
export const routes: RouteObject[] = [
  {
    element: <Frame />,
    children: [
      {
        index: true,
        element: (
          <StudioPage title={null}>
            <HomePage />
          </StudioPage>
        ),
      },
      {
        path: 'connections',
        element: (
          <StudioPage title="connections.title">
            <ConnectionsPage />
          </StudioPage>
        ),
      },
      ...PROVIDERS.map((provider): RouteObject => {
        const Area = lazy(provider.loadArea);
        return { path: `${provider.segment}/*`, element: <ProviderPage area={Area} /> };
      }),
      {
        path: '*',
        element: (
          <StudioPage title="notFound.title">
            <NotFoundPage />
          </StudioPage>
        ),
      },
    ],
  },
];
