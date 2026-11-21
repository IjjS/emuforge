import type { ServiceScreen } from '../../screens';
import { CLUSTERS_NAVIGATION, CREATE_SERVICE_PATTERN, CREATE_SERVICE_TITLE, createServiceCrumbs } from './format';
import { CreateServicePage } from './pages/create-service-page';

export const CREATE_SERVICE_SCREENS: readonly ServiceScreen[] = [
  {
    paths: [CREATE_SERVICE_PATTERN],
    title: CREATE_SERVICE_TITLE,
    crumbs: ({ cluster }) => createServiceCrumbs(cluster ?? ''),
    navigation: CLUSTERS_NAVIGATION,
    Page: CreateServicePage,
  },
];
