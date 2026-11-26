import type { ScreenNavigation } from '../../screens';
import { EC2_PATH, INSTANCES_PATH, KEY_PAIRS_PATH, SECURITY_GROUPS_PATH } from './format';
import { VOLUMES_PATH } from './volume-format';

const HEADER: ScreenNavigation['header'] = { text: 'EC2', href: EC2_PATH };

/** The navigation of the instance screens (S1 to S3): "Instances" active. */
export const INSTANCES_NAVIGATION: ScreenNavigation = { header: HEADER, activeHref: INSTANCES_PATH };

/** The navigation of the security group screens (S4 to S7): "Security groups" active. */
export const SECURITY_GROUPS_NAVIGATION: ScreenNavigation = {
  header: HEADER,
  activeHref: SECURITY_GROUPS_PATH,
};

/** The navigation of the key pair screens (S8, S9): "Key pairs" active. */
export const KEY_PAIRS_NAVIGATION: ScreenNavigation = { header: HEADER, activeHref: KEY_PAIRS_PATH };

export const VOLUMES_NAVIGATION: ScreenNavigation = { header: HEADER, activeHref: VOLUMES_PATH };
