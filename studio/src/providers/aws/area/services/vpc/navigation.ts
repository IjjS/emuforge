import type { SideNavigationProps } from '@cloudscape-design/components/side-navigation';

import type { ScreenNavigation } from '../../screens';
import {
  INTERNET_GATEWAYS_PATH,
  INTERNET_GATEWAYS_TITLE,
  ROUTE_TABLES_PATH,
  ROUTE_TABLES_TITLE,
  SUBNETS_PATH,
  SUBNETS_TITLE,
  VPC_PATH,
  VPCS_PATH,
  VPCS_TITLE,
} from './format';

// VPC's side navigation (issue 574, requirement "Screens, routes, layer"): the header "VPC" and an entry per section,
// the entry of a screen's section the active one.

const HEADER: ScreenNavigation['header'] = { text: 'VPC', href: VPC_PATH };

const ITEMS: readonly SideNavigationProps.Item[] = [
  { type: 'link', text: VPCS_TITLE, href: VPCS_PATH },
  { type: 'link', text: SUBNETS_TITLE, href: SUBNETS_PATH },
  { type: 'link', text: ROUTE_TABLES_TITLE, href: ROUTE_TABLES_PATH },
  { type: 'link', text: INTERNET_GATEWAYS_TITLE, href: INTERNET_GATEWAYS_PATH },
];

function active(href: string): ScreenNavigation {
  return { header: HEADER, items: ITEMS, activeHref: href };
}

/** The navigation of the VPC screens (S1 to S3): "VPCs" active. */
export const VPCS_NAVIGATION = active(VPCS_PATH);

/** The navigation of the subnet screens (S4 to S6): "Subnets" active. */
export const SUBNETS_NAVIGATION = active(SUBNETS_PATH);

/** The navigation of the route table screens (S7 to S11): "Route tables" active. */
export const ROUTE_TABLES_NAVIGATION = active(ROUTE_TABLES_PATH);

/** The navigation of the internet gateway screens (S12 to S14): "Internet gateways" active. */
export const INTERNET_GATEWAYS_NAVIGATION = active(INTERNET_GATEWAYS_PATH);
