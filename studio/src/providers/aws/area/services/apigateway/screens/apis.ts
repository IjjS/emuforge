import type { ServiceScreen } from '../../../screens';
import { apisPath, restApisPath, servicePath } from '../format';
import { ApiListPage } from '../pages/api-list-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    title: 'APIs',
    crumbs: [{ text: 'APIs' }],
    Page: ApiListPage,
    paths: [apisPath, servicePath, restApisPath],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: apisPath },
  },
];
