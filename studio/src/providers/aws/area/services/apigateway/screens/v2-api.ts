import type { ServiceScreen } from '../../../screens';
import { apisPath, servicePath } from '../format';
import { V2ApiPage } from '../pages/v2-api-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [`${apisPath}/v2/{api_id}`],
    title: ({ api_id }) => api_id ?? '',
    crumbs: ({ api_id }) => [{ text: 'APIs', href: apisPath }, { text: api_id ?? '' }],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: apisPath },
    Page: V2ApiPage,
  },
];
