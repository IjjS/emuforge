import type { ServiceScreen } from '../../../screens';
import { apisPath, restApisPath, servicePath } from '../format';
import { ApiListPage } from '../pages/api-list-page';

const apiList = {
  title: 'APIs',
  crumbs: [{ text: 'APIs' }],
  Page: ApiListPage,
};
const header = { text: 'API Gateway', href: servicePath };

export const SCREENS: readonly ServiceScreen[] = [
  {
    ...apiList,
    paths: [apisPath, servicePath],
    navigation: { header, activeHref: apisPath },
  },
  {
    ...apiList,
    paths: [restApisPath],
    navigation: { header, activeHref: restApisPath },
  },
];
