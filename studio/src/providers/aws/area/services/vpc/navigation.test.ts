import { describe, expect, it } from 'vitest';

import {
  INTERNET_GATEWAYS_NAVIGATION,
  ROUTE_TABLES_NAVIGATION,
  SUBNETS_NAVIGATION,
  VPCS_NAVIGATION,
} from './navigation';

const ITEMS = [
  { type: 'link', text: 'VPCs', href: '/aws/vpc/vpcs' },
  { type: 'link', text: 'Subnets', href: '/aws/vpc/subnets' },
  { type: 'link', text: 'Route tables', href: '/aws/vpc/route-tables' },
  { type: 'link', text: 'Internet gateways', href: '/aws/vpc/internet-gateways' },
];

describe("VPC's navigation", () => {
  it('is "VPC" with "VPCs", "Subnets", "Route tables", "Internet gateways"; each section\'s entry is the active one', () => {
    for (const [navigation, active] of [
      [VPCS_NAVIGATION, '/aws/vpc/vpcs'],
      [SUBNETS_NAVIGATION, '/aws/vpc/subnets'],
      [ROUTE_TABLES_NAVIGATION, '/aws/vpc/route-tables'],
      [INTERNET_GATEWAYS_NAVIGATION, '/aws/vpc/internet-gateways'],
    ] as const) {
      expect(navigation.header).toEqual({ text: 'VPC', href: '/aws/vpc' });
      expect(navigation.items).toEqual(ITEMS);
      expect(navigation.activeHref).toBe(active);
    }
  });
});
