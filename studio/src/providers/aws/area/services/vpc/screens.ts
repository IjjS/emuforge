import type { ServiceScreen } from '../../screens';
import { GATEWAY_SCREENS } from './gateway-screens';
import { ROUTE_TABLE_SCREENS } from './route-table-screens';
import { SUBNET_SCREENS } from './subnet-screens';
import { VPC_SCREENS } from './vpc-screens';

// VPC's screens, which the area collects (issue 574, design "Code layout"): those of each resource from its own file.
// An id in a path is one segment, decoded once by the area.

export const SCREENS: readonly ServiceScreen[] = [
  ...VPC_SCREENS,
  ...SUBNET_SCREENS,
  ...ROUTE_TABLE_SCREENS,
  ...GATEWAY_SCREENS,
];
