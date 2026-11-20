import { describe, expect, it } from 'vitest';

import { CLUSTERS_NAVIGATION, INSTANCES_NAVIGATION } from './navigation';

const ITEMS = [
  { type: 'link', text: 'DB instances', href: '/aws/rds/instances' },
  { type: 'link', text: 'DB clusters', href: '/aws/rds/clusters' },
];

describe("RDS's navigation", () => {
  it('is "RDS" with "DB instances" and "DB clusters"; each section\'s entry is the active one', () => {
    for (const [navigation, active] of [
      [INSTANCES_NAVIGATION, '/aws/rds/instances'],
      [CLUSTERS_NAVIGATION, '/aws/rds/clusters'],
    ] as const) {
      expect(navigation.header).toEqual({ text: 'RDS', href: '/aws/rds' });
      expect(navigation.items).toEqual(ITEMS);
      expect(navigation.activeHref).toBe(active);
    }
  });
});
