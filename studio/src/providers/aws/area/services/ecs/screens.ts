import type { ServiceScreen } from '../../screens';
import { CLUSTER_PAGE_SCREENS } from './cluster-page-screens';
import { DEFINITION_SCREENS } from './definition-screens';
import {
  CLUSTERS_CRUMBS,
  CLUSTERS_NAVIGATION,
  CLUSTERS_PATH,
  CLUSTERS_TITLE,
  CREATE_CLUSTER_CRUMBS,
  CREATE_CLUSTER_PATH,
  CREATE_CLUSTER_TITLE,
  ECS_PATH,
} from './format';
import { ClusterListPage } from './pages/cluster-list-page';
import { CreateClusterPage } from './pages/create-cluster-page';
import { REGISTER_SCREENS } from './register-screens';
import { RUN_SCREENS } from './run-screens';
import { SERVICE_SCREENS } from './service-screens';
import { TASK_SCREENS } from './task-screens';

// ECS's screens, which the area collects (issue 575, design "Code layout and the cut"): the clusters list and
// "Create cluster" here, then those of each later unit, each from its own file. A name or an id in a path is one
// segment, decoded once by the area.

/** S1 and S2, the clusters (task 5). */
const CLUSTER_SCREENS: readonly ServiceScreen[] = [
  // S1: at the service's route and at its own, neither redirecting.
  {
    paths: [ECS_PATH, CLUSTERS_PATH],
    title: CLUSTERS_TITLE,
    crumbs: CLUSTERS_CRUMBS,
    navigation: CLUSTERS_NAVIGATION,
    Page: ClusterListPage,
  },
  // S2: "Create cluster".
  {
    paths: [CREATE_CLUSTER_PATH],
    title: CREATE_CLUSTER_TITLE,
    crumbs: CREATE_CLUSTER_CRUMBS,
    navigation: CLUSTERS_NAVIGATION,
    Page: CreateClusterPage,
  },
];

export const SCREENS: readonly ServiceScreen[] = [
  ...CLUSTER_SCREENS,
  ...CLUSTER_PAGE_SCREENS,
  ...SERVICE_SCREENS,
  ...TASK_SCREENS,
  ...RUN_SCREENS,
  ...DEFINITION_SCREENS,
  ...REGISTER_SCREENS,
];
