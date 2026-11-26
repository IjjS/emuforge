import type { ServiceScreen } from '../../../screens';
import { apisPath } from '../format';
import { apiGatewayNavigation } from '../navigation';
import { V2ApiPage } from '../pages/v2-api-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [`${apisPath}/v2/{api_id}`],
    title: ({ api_id }) => api_id ?? '',
    crumbs: ({ api_id }) => [{ text: 'APIs', href: apisPath }, { text: api_id ?? '' }],
    navigation: apiGatewayNavigation(),
    Page: V2ApiPage,
  },
];
