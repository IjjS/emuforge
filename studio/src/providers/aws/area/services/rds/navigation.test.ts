import { describe, expect, it } from 'vitest';

import { CLUSTERS_NAVIGATION, INSTANCES_NAVIGATION } from './navigation';

describe("RDS's navigation", () => {
  it('keeps the "RDS" header and each section\'s active entry', () => {
    for (const [navigation, active] of [
      [INSTANCES_NAVIGATION, '/aws/rds/instances'],
      [CLUSTERS_NAVIGATION, '/aws/rds/clusters'],
    ] as const) {
      expect(navigation.header).toEqual({ text: 'RDS', href: '/aws/rds' });
      expect(navigation.items).toBeUndefined();
      expect(navigation.activeHref).toBe(active);
    }
  });
});
