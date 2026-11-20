import type { ServiceScreen } from '../../screens';
import { CLUSTER_PATTERN, clusterCrumbs, CLUSTERS_NAVIGATION } from './format';
import { ClusterPage } from './pages/cluster-page';

/** ECS's screen S3, a cluster (unit s5), which `screens.ts` collects: its title and its last crumb the cluster's name. */
export const CLUSTER_PAGE_SCREENS: readonly ServiceScreen[] = [
  {
    paths: [CLUSTER_PATTERN],
    title: ({ cluster }) => cluster ?? '',
    crumbs: ({ cluster }) => clusterCrumbs(cluster ?? ''),
    navigation: CLUSTERS_NAVIGATION,
    Page: ClusterPage,
  },
];
