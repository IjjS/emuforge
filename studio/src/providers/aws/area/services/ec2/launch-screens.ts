import type { ServiceScreen } from '../../screens';
import { INSTANCES_PATH, INSTANCES_TITLE, LAUNCH_INSTANCE_PATH, LAUNCH_INSTANCE_TITLE } from './format';
import { INSTANCES_NAVIGATION } from './navigation';
import { LaunchInstancePage } from './pages/launch-instance-page';

/** EC2's screens of S2, "Launch instance" (unit s2), which `screens.ts` collects. */
export const LAUNCH_SCREENS: readonly ServiceScreen[] = [
  // S2: its crumbs "Instances" (to S1) then its own, in the instances' section.
  {
    paths: [LAUNCH_INSTANCE_PATH],
    title: LAUNCH_INSTANCE_TITLE,
    crumbs: [{ text: INSTANCES_TITLE, href: INSTANCES_PATH }, { text: LAUNCH_INSTANCE_TITLE }],
    navigation: INSTANCES_NAVIGATION,
    Page: LaunchInstancePage,
  },
];
