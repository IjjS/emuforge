import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import type { ScreenNavigation } from '../../screens';
import { CLUSTERS_PATH, CLUSTERS_TITLE, INSTANCES_PATH, INSTANCES_TITLE, RDS_PATH } from './format';

// RDS's side navigation (issue 573, requirement "Screens, routes, layer"): the header "RDS" and an entry per section,
// the entry of a screen's section the active one.

const HEADER: ScreenNavigation['header'] = { text: 'RDS', href: RDS_PATH };

const ITEMS: readonly SideNavigationProps.Item[] = [
  { type: 'link', text: INSTANCES_TITLE, href: INSTANCES_PATH },
  { type: 'link', text: CLUSTERS_TITLE, href: CLUSTERS_PATH },
];

/** The navigation of the DB instance screens (S1 to S3): "DB instances" active. */
export const INSTANCES_NAVIGATION: ScreenNavigation = { header: HEADER, items: ITEMS, activeHref: INSTANCES_PATH };

/** The navigation of the DB cluster screens (S4 to S7): "DB clusters" active. */
export const CLUSTERS_NAVIGATION: ScreenNavigation = { header: HEADER, items: ITEMS, activeHref: CLUSTERS_PATH };
