import { describe, expect, it } from 'vitest';

import { INSTANCES_NAVIGATION, KEY_PAIRS_NAVIGATION, SECURITY_GROUPS_NAVIGATION } from './navigation';

const ITEMS = [
  { type: 'link', text: 'Instances', href: '/aws/ec2/instances' },
  { type: 'link', text: 'Volumes', href: '/aws/ec2/volumes' },
  { type: 'link', text: 'Security groups', href: '/aws/ec2/security-groups' },
  { type: 'link', text: 'Key pairs', href: '/aws/ec2/key-pairs' },
];

describe("EC2's navigation", () => {
  it("includes the Volumes link and each original section's entry is the active one", () => {
    for (const [navigation, active] of [
      [INSTANCES_NAVIGATION, '/aws/ec2/instances'],
      [SECURITY_GROUPS_NAVIGATION, '/aws/ec2/security-groups'],
      [KEY_PAIRS_NAVIGATION, '/aws/ec2/key-pairs'],
    ] as const) {
      expect(navigation.header).toEqual({ text: 'EC2', href: '/aws/ec2' });
      expect(navigation.items).toEqual(ITEMS);
      expect(navigation.activeHref).toBe(active);
    }
  });
});
