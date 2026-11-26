import type { ServiceScreen } from '../../../screens';
import { ENTRIES } from '../entries';
import { apisPath, servicePath } from '../format';
import { apiGatewayNavigation } from '../navigation';
import { ApiListPage } from '../pages/api-list-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [apisPath, servicePath],
    leadsTo: ENTRIES.filter((entry) => !entry.built).map((entry) => entry.path),
    title: 'APIs',
    crumbs: [{ text: 'APIs' }],
    navigation: apiGatewayNavigation(),
    Page: ApiListPage,
  },
];
