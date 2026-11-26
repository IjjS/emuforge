import type { ServiceScreen } from '../../../screens';
import { apisPath, servicePath, v2ApiPath } from '../format';
import { CreateRoutePage } from '../pages/create-route-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [`${apisPath}/v2/{api_id}/routes/create`],
    title: 'Create route',
    crumbs: ({ api_id }) => [
      { text: 'APIs', href: apisPath },
      { text: api_id ?? 'HTTP API', href: v2ApiPath(api_id ?? '') },
      { text: 'Create route' },
    ],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: apisPath },
    Page: CreateRoutePage,
  },
];
