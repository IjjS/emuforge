import type { ServiceScreen } from '../../../screens';
import { apisPath } from '../format';
import { apiGatewayNavigation } from '../navigation';
import { RestApiPage } from '../pages/rest-api-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [`${apisPath}/rest/{api_id}`],
    title: ({ api_id }) => api_id ?? 'REST API',
    crumbs: ({ api_id }) => [{ text: 'APIs', href: apisPath }, { text: api_id ?? 'REST API' }],
    navigation: apiGatewayNavigation(),
    Page: RestApiPage,
  },
];
