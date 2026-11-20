import { AWS_PATH } from '../../../identity';
import { nameOf, type Tag } from '../../lib/ec2-client';

// Every address of VPC's fourteen screens, their titles and notice words (issue 574, design "Code layout"): a unit
// links to another unit's screen by this file alone. A VPC, a subnet, a route table and an internet gateway are
// addressed by the id the emulator gave, percent-encoded once as one segment.

/** Shown for a value the answer lacks. */
export const NONE = '-';

/**
 * The least width of a column of IDs (`aws-area.md`, entry 4): an ID's prefix and its 17-character tail, hex letters
 * included, on at most two lines at 1280 and 390. The tail measures about 17.2ch in the area's font; 18ch holds it, and
 * 40px is the padding of a Cloudscape table cell.
 */
export const ID_MIN_WIDTH = 'calc(18ch + 40px)';

/** VPC's route in the area, `/aws/vpc`. */
export const VPC_PATH = `${AWS_PATH}/vpc`;

/** The query parameter of S5 and S8 that chooses the VPC. */
export const VPC_QUERY = 'vpc';

/** S1, the VPCs. */
export const VPCS_PATH = `${VPC_PATH}/vpcs`;
/** S2, "Create VPC". */
export const CREATE_VPC_PATH = `${VPCS_PATH}/create`;
/** S3's pattern, a VPC. */
export const VPC_PATTERN = `${VPCS_PATH}/vpc/{id}`;

/** S4, the subnets. */
export const SUBNETS_PATH = `${VPC_PATH}/subnets`;
/** S5, "Create subnet". */
export const CREATE_SUBNET_PATH = `${SUBNETS_PATH}/create`;
/** S6's pattern, a subnet. */
export const SUBNET_PATTERN = `${SUBNETS_PATH}/subnet/{id}`;

/** S7, the route tables. */
export const ROUTE_TABLES_PATH = `${VPC_PATH}/route-tables`;
/** S8, "Create route table". */
export const CREATE_ROUTE_TABLE_PATH = `${ROUTE_TABLES_PATH}/create`;
/** S9's pattern, a route table. */
export const ROUTE_TABLE_PATTERN = `${ROUTE_TABLES_PATH}/route-table/{id}`;
/** S10's pattern, "Add route" of a route table. */
export const ADD_ROUTE_PATTERN = `${ROUTE_TABLE_PATTERN}/add-route`;
/** S11's pattern, "Associate subnet" of a route table. */
export const ASSOCIATE_SUBNET_PATTERN = `${ROUTE_TABLE_PATTERN}/associate-subnet`;

/** S12, the internet gateways. */
export const INTERNET_GATEWAYS_PATH = `${VPC_PATH}/internet-gateways`;
/** S13, "Create internet gateway". */
export const CREATE_INTERNET_GATEWAY_PATH = `${INTERNET_GATEWAYS_PATH}/create`;
/** S14's pattern, "Attach internet gateway" of a gateway. */
export const ATTACH_INTERNET_GATEWAY_PATTERN = `${INTERNET_GATEWAYS_PATH}/gateway/{id}/attach`;

/** S3 of the VPC `id`. */
export function vpcHref(id: string): string {
  return `${VPCS_PATH}/vpc/${encodeURIComponent(id)}`;
}

/** S6 of the subnet `id`. */
export function subnetHref(id: string): string {
  return `${SUBNETS_PATH}/subnet/${encodeURIComponent(id)}`;
}

/** S9 of the route table `id`. */
export function routeTableHref(id: string): string {
  return `${ROUTE_TABLES_PATH}/route-table/${encodeURIComponent(id)}`;
}

/** S10 of the route table `id`. */
export function addRouteHref(id: string): string {
  return `${routeTableHref(id)}/add-route`;
}

/** S11 of the route table `id`. */
export function associateSubnetHref(id: string): string {
  return `${routeTableHref(id)}/associate-subnet`;
}

function withVpc(path: string, vpcId: string | undefined): string {
  return vpcId === undefined ? path : `${path}?${new URLSearchParams({ [VPC_QUERY]: vpcId }).toString()}`;
}

/** S14 of the internet gateway `id`, with the VPC `vpcId` chosen when it is given. */
export function attachInternetGatewayHref(id: string, vpcId?: string): string {
  return withVpc(`${INTERNET_GATEWAYS_PATH}/gateway/${encodeURIComponent(id)}/attach`, vpcId);
}

/** S12, saying that an attach is for the VPC `vpcId` when it is given. */
export function internetGatewaysHref(vpcId?: string): string {
  return withVpc(INTERNET_GATEWAYS_PATH, vpcId);
}

/** S13, keeping the VPC `vpcId` for the way back to S12 when it is given. */
export function createInternetGatewayHref(vpcId?: string): string {
  return withVpc(CREATE_INTERNET_GATEWAY_PATH, vpcId);
}

/** S5, with the VPC `vpcId` chosen when it is given. */
export function createSubnetHref(vpcId?: string): string {
  return withVpc(CREATE_SUBNET_PATH, vpcId);
}

/** S8, with the VPC `vpcId` chosen when it is given. */
export function createRouteTableHref(vpcId?: string): string {
  return withVpc(CREATE_ROUTE_TABLE_PATH, vpcId);
}

/** The screens' titles, each its `h1` and its crumb. */
export const VPCS_TITLE = 'VPCs';
export const CREATE_VPC_TITLE = 'Create VPC';
export const SUBNETS_TITLE = 'Subnets';
export const CREATE_SUBNET_TITLE = 'Create subnet';
export const ROUTE_TABLES_TITLE = 'Route tables';
export const CREATE_ROUTE_TABLE_TITLE = 'Create route table';
export const ADD_ROUTE_TITLE = 'Add route';
export const ASSOCIATE_SUBNET_TITLE = 'Associate subnet';
export const INTERNET_GATEWAYS_TITLE = 'Internet gateways';
export const CREATE_INTERNET_GATEWAY_TITLE = 'Create internet gateway';
export const ATTACH_INTERNET_GATEWAY_TITLE = 'Attach internet gateway';

/** The notice's plural word, per section: S1 to S3, S4 to S6, S7 to S11, S12 to S14. */
export const VPCS_WORD = 'VPCs';
export const SUBNETS_WORD = 'subnets';
export const ROUTE_TABLES_WORD = 'route tables';
export const INTERNET_GATEWAYS_WORD = 'internet gateways';

/** The description of every list's table. */
export const NAME_FILTER_DESCRIPTION = 'The name filter matches the Name tag and is case-sensitive.';

/** A resource's name as a list shows it: the value of its tag `Name`, "-" without one or with an empty one. */
export function resourceName(tags: readonly Tag[]): string {
  return nameOf(tags) ?? NONE;
}

/** A page's heading, and how a result or a dialog names a resource: its name when it has one, else its ID. */
export function nameOrId(id: string, tags: readonly Tag[]): string {
  return nameOf(tags) ?? id;
}
