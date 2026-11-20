import type { ServiceScreen } from '../../screens';
import {
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  CREATE_CLUSTER_PATH,
  CREATE_CLUSTER_TITLE,
  CREATE_INSTANCE_PATH,
  CREATE_INSTANCE_TITLE,
  INSTANCES_PATH,
  INSTANCES_TITLE,
} from './format';
import { CLUSTERS_NAVIGATION, INSTANCES_NAVIGATION } from './navigation';
import { CreateClusterPage } from './pages/create-cluster-page';
import { CreateInstancePage } from './pages/create-instance-page';

/** RDS's screens S2 and S5, the two create forms (unit s2), which `screens.ts` collects. */
export const CREATE_SCREENS: readonly ServiceScreen[] = [
  // S2: its crumbs "DB instances" (to S1) then its own, in the instances' section.
  {
    paths: [CREATE_INSTANCE_PATH],
    title: CREATE_INSTANCE_TITLE,
    crumbs: [{ text: INSTANCES_TITLE, href: INSTANCES_PATH }, { text: CREATE_INSTANCE_TITLE }],
    navigation: INSTANCES_NAVIGATION,
    Page: CreateInstancePage,
  },
  // S5: its crumbs "DB clusters" (to S4) then its own, in the clusters' section.
  {
    paths: [CREATE_CLUSTER_PATH],
    title: CREATE_CLUSTER_TITLE,
    crumbs: [{ text: CLUSTERS_TITLE, href: CLUSTERS_PATH }, { text: CREATE_CLUSTER_TITLE }],
    navigation: CLUSTERS_NAVIGATION,
    Page: CreateClusterPage,
  },
];
