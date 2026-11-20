import type { ServiceScreen } from '../../screens';
import { CLUSTER_SCREENS } from './cluster-screens';
import { CREATE_SCREENS } from './create-screens';
import { INSTANCE_PATTERN, INSTANCES_PATH, INSTANCES_TITLE, RDS_PATH } from './format';
import { INSTANCES_NAVIGATION } from './navigation';
import { InstanceListPage } from './pages/instance-list-page';
import { InstancePage } from './pages/instance-page';

// RDS's screens, which the area collects (issue 573, design "Code layout and the cut"): the DB instance screens here,
// then those of the create forms and the DB clusters, each from its own file. An identifier in a path is one segment,
// decoded once by the area.

/** S1 and S3, the DB instances (tasks 1, 3). */
const INSTANCE_SCREENS: readonly ServiceScreen[] = [
  // S1: at the service's route and at its own, neither redirecting.
  {
    paths: [RDS_PATH, INSTANCES_PATH],
    title: INSTANCES_TITLE,
    crumbs: [{ text: INSTANCES_TITLE }],
    navigation: INSTANCES_NAVIGATION,
    Page: InstanceListPage,
  },
  // S3: a DB instance, its crumb the identifier of the address.
  {
    paths: [INSTANCE_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: INSTANCES_TITLE, href: INSTANCES_PATH }, { text: id ?? '' }],
    navigation: INSTANCES_NAVIGATION,
    Page: InstancePage,
  },
];

export const SCREENS: readonly ServiceScreen[] = [...INSTANCE_SCREENS, ...CREATE_SCREENS, ...CLUSTER_SCREENS];
