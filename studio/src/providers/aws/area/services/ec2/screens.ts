import type { ServiceScreen } from '../../screens';
import { INSTANCE_PATTERN, INSTANCES_PATH, INSTANCES_TITLE, EC2_PATH } from './format';
import { GROUP_SCREENS } from './group-screens';
import { KEY_PAIR_SCREENS } from './key-pair-screens';
import { LAUNCH_SCREENS } from './launch-screens';
import { INSTANCES_NAVIGATION } from './navigation';
import { InstanceListPage } from './pages/instance-list-page';
import { InstancePage } from './pages/instance-page';

// EC2's screens, which the area collects (issue 553, design "Code layout and the cut"): the instance screens here,
// then those of the launch, the security groups and the key pairs, each from its own file. An id in a path is one
// segment, decoded once by the area.

/** S1 and S3, the instances (tasks 1, 3). */
const INSTANCE_SCREENS: readonly ServiceScreen[] = [
  // S1: at the service's route and at its own, neither redirecting.
  {
    paths: [EC2_PATH, INSTANCES_PATH],
    title: INSTANCES_TITLE,
    crumbs: [{ text: INSTANCES_TITLE }],
    navigation: INSTANCES_NAVIGATION,
    Page: InstanceListPage,
  },
  // S3: an instance, its crumb the id of the address.
  {
    paths: [INSTANCE_PATTERN],
    title: ({ id }) => id ?? '',
    crumbs: ({ id }) => [{ text: INSTANCES_TITLE, href: INSTANCES_PATH }, { text: id ?? '' }],
    navigation: INSTANCES_NAVIGATION,
    Page: InstancePage,
  },
];

export const SCREENS: readonly ServiceScreen[] = [
  ...INSTANCE_SCREENS,
  ...LAUNCH_SCREENS,
  ...GROUP_SCREENS,
  ...KEY_PAIR_SCREENS,
];
