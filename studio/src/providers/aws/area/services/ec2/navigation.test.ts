import { describe, expect, it } from 'vitest';

import {
  INSTANCES_NAVIGATION,
  KEY_PAIRS_NAVIGATION,
  SECURITY_GROUPS_NAVIGATION,
  VOLUMES_NAVIGATION,
} from './navigation';

describe("EC2's navigation", () => {
  it("keeps each original section's entry active", () => {
    for (const [navigation, active] of [
      [INSTANCES_NAVIGATION, '/aws/ec2/instances'],
      [VOLUMES_NAVIGATION, '/aws/ec2/volumes'],
      [SECURITY_GROUPS_NAVIGATION, '/aws/ec2/security-groups'],
      [KEY_PAIRS_NAVIGATION, '/aws/ec2/key-pairs'],
    ] as const) {
      expect(navigation.header).toEqual({ text: 'EC2', href: '/aws/ec2' });
      expect(navigation.activeHref).toBe(active);
    }
  });
});
