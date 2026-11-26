import type { ScreenNavigation } from '../../screens';
import { CLUSTERS_PATH, INSTANCES_PATH, RDS_PATH } from './format';

// RDS's side navigation (issue 573, requirement "Screens, routes, layer"): the header "RDS" and the active
// entry of each screen.

const HEADER: ScreenNavigation['header'] = { text: 'RDS', href: RDS_PATH };

/** The navigation of the DB instance screens (S1 to S3): "DB instances" active. */
export const INSTANCES_NAVIGATION: ScreenNavigation = { header: HEADER, activeHref: INSTANCES_PATH };

/** The navigation of the DB cluster screens (S4 to S7): "DB clusters" active. */
export const CLUSTERS_NAVIGATION: ScreenNavigation = { header: HEADER, activeHref: CLUSTERS_PATH };
