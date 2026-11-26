import type { ServiceScreen } from '../../../screens';
import { apisPath, restApiPath, restApisPath, servicePath } from '../format';
import { CreateMethodPage } from '../pages/create-method-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [`${apisPath}/rest/{api_id}/methods/create`],
    title: 'Create method',
    crumbs: ({ api_id }) => [
      { text: 'APIs', href: apisPath },
      { text: api_id ?? 'REST API', href: restApiPath(api_id ?? '') },
      { text: 'Create method' },
    ],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: restApisPath },
    Page: CreateMethodPage,
  },
];
