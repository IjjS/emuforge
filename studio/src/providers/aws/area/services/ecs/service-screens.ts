import type { ServiceScreen } from '../../screens';
import { CLUSTERS_NAVIGATION, SERVICE_PATTERN, serviceCrumbs } from './format';
import { ServicePage } from './pages/service-page';

/** ECS's screen S4, a service (unit s6), which `screens.ts` collects: its title and its last crumb the service's name. */
export const SERVICE_SCREENS: readonly ServiceScreen[] = [
  {
    paths: [SERVICE_PATTERN],
    title: ({ service }) => service ?? '',
    crumbs: ({ cluster, service }) => serviceCrumbs(cluster ?? '', service ?? ''),
    navigation: CLUSTERS_NAVIGATION,
    Page: ServicePage,
  },
];
