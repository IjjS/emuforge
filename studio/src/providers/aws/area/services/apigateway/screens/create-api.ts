import type { ServiceScreen } from '../../../screens';
import { apisPath, createApiPath, servicePath } from '../format';
import { CreateApiPage } from '../pages/create-api-page';

export const SCREENS: readonly ServiceScreen[] = [
  {
    paths: [createApiPath],
    title: 'Create API',
    crumbs: [{ text: 'APIs', href: apisPath }, { text: 'Create API' }],
    navigation: { header: { text: 'API Gateway', href: servicePath }, activeHref: apisPath },
    Page: CreateApiPage,
  },
];
