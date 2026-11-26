import type { ServiceScreen } from '../../../screens';
import { apisPath, restApisPath, servicePath } from '../format';
import { ApiListPage } from '../pages/api-list-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [apisPath, servicePath, restApisPath],
    title: 'APIs',
    crumbs: [{ text: 'APIs' }],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: apisPath },
    Page: ApiListPage,
  },
];
