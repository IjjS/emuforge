import { describe, expect, it } from 'vitest';

import {
  INTERNET_GATEWAYS_NAVIGATION,
  ROUTE_TABLES_NAVIGATION,
  SUBNETS_NAVIGATION,
  VPCS_NAVIGATION,
} from './navigation';

describe("VPC's navigation", () => {
  it('keeps the "VPC" header and each section\'s active entry', () => {
    for (const [navigation, active] of [
      [VPCS_NAVIGATION, '/aws/vpc/vpcs'],
      [SUBNETS_NAVIGATION, '/aws/vpc/subnets'],
      [ROUTE_TABLES_NAVIGATION, '/aws/vpc/route-tables'],
      [INTERNET_GATEWAYS_NAVIGATION, '/aws/vpc/internet-gateways'],
    ] as const) {
      expect(navigation.header).toEqual({ text: 'VPC', href: '/aws/vpc' });
      expect(navigation.items).toBeUndefined();
      expect(navigation.activeHref).toBe(active);
    }
  });
});
