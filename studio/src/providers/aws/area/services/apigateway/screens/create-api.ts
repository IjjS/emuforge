import type { ServiceScreen } from '../../../screens';
import { apisPath, createApiPath } from '../format';
import { apiGatewayNavigation } from '../navigation';
import { CreateApiPage } from '../pages/create-api-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [createApiPath],
    title: 'Create API',
    crumbs: [{ text: 'APIs', href: apisPath }, { text: 'Create API' }],
    navigation: apiGatewayNavigation(),
    Page: CreateApiPage,
  },
];
