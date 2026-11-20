import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import type { ScreenNavigation } from '../../screens';
import {
  EC2_PATH,
  INSTANCES_PATH,
  INSTANCES_TITLE,
  KEY_PAIRS_PATH,
  KEY_PAIRS_TITLE,
  SECURITY_GROUPS_PATH,
  SECURITY_GROUPS_TITLE,
} from './format';

// EC2's side navigation (issue 553, design "Shared states"): the header "EC2" and an entry per section, the entry of
// a screen's section the active one.

const HEADER: ScreenNavigation['header'] = { text: 'EC2', href: EC2_PATH };

const ITEMS: readonly SideNavigationProps.Item[] = [
  { type: 'link', text: INSTANCES_TITLE, href: INSTANCES_PATH },
  { type: 'link', text: SECURITY_GROUPS_TITLE, href: SECURITY_GROUPS_PATH },
  { type: 'link', text: KEY_PAIRS_TITLE, href: KEY_PAIRS_PATH },
];

/** The navigation of the instance screens (S1 to S3): "Instances" active. */
export const INSTANCES_NAVIGATION: ScreenNavigation = { header: HEADER, items: ITEMS, activeHref: INSTANCES_PATH };

/** The navigation of the security group screens (S4 to S7): "Security groups" active. */
export const SECURITY_GROUPS_NAVIGATION: ScreenNavigation = {
  header: HEADER,
  items: ITEMS,
  activeHref: SECURITY_GROUPS_PATH,
};

/** The navigation of the key pair screens (S8, S9): "Key pairs" active. */
export const KEY_PAIRS_NAVIGATION: ScreenNavigation = { header: HEADER, items: ITEMS, activeHref: KEY_PAIRS_PATH };
