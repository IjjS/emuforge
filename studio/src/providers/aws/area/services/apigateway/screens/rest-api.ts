import type { ServiceScreen } from '../../../screens';
import { apisPath, restApisPath, servicePath } from '../format';
import { RestApiPage } from '../pages/rest-api-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [`${apisPath}/rest/{api_id}`],
    title: ({ api_id }) => api_id ?? 'REST API',
    crumbs: ({ api_id }) => [{ text: 'APIs', href: apisPath }, { text: api_id ?? 'REST API' }],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: restApisPath },
    Page: RestApiPage,
  },
];
