import type { ScreenNavigation } from '../../screens';
import { INTERNET_GATEWAYS_PATH, ROUTE_TABLES_PATH, SUBNETS_PATH, VPC_PATH, VPCS_PATH } from './format';

// VPC's side navigation (issue 574, requirement "Screens, routes, layer"): the header "VPC" and the active
// entry of each screen.

const HEADER: ScreenNavigation['header'] = { text: 'VPC', href: VPC_PATH };

function active(href: string): ScreenNavigation {
  return { header: HEADER, activeHref: href };
}

/** The navigation of the VPC screens (S1 to S3): "VPCs" active. */
export const VPCS_NAVIGATION = active(VPCS_PATH);

/** The navigation of the subnet screens (S4 to S6): "Subnets" active. */
export const SUBNETS_NAVIGATION = active(SUBNETS_PATH);

/** The navigation of the route table screens (S7 to S11): "Route tables" active. */
export const ROUTE_TABLES_NAVIGATION = active(ROUTE_TABLES_PATH);

/** The navigation of the internet gateway screens (S12 to S14): "Internet gateways" active. */
export const INTERNET_GATEWAYS_NAVIGATION = active(INTERNET_GATEWAYS_PATH);
