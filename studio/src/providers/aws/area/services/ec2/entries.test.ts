import { describe, expect, it } from 'vitest';

import { entryFaults, entryHasScreen } from '../../entries';
import { collectScreens } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

const SERVICE = '/ec2';
const SERVICE_PATH = '/aws/ec2';
const screens = collectScreens([{ folder: 'ec2', screens: SCREENS }]);
const originalLinks = [
  { label: 'Instances', path: '/aws/ec2/instances' },
  { label: 'Volumes', path: '/aws/ec2/volumes' },
  { label: 'Security groups', path: '/aws/ec2/security-groups' },
  { label: 'Key pairs', path: '/aws/ec2/key-pairs' },
];

describe("EC2's entries", () => {
  it('follows the area entry rules', () => {
    expect(entryFaults([{ folder: 'ec2', groups: ENTRIES }], screens)).toEqual([]);
  });

  it('keeps each original navigation label and address at a registered screen below the service route', () => {
    const entries = ENTRIES.flatMap((group) => group.entries);
    for (const link of originalLinks) {
      expect(entries).toContainEqual(expect.objectContaining(link));
      expect(entryHasScreen(screens, SERVICE, link.path)).toBe(true);
    }
    expect(entries.map(({ path }) => path)).not.toContain(SERVICE_PATH);
  });

  it('names the groups in model order and gives each sub-service its own entry', () => {
    expect(ENTRIES.map(({ name, subService }) => ({ name, subService }))).toEqual([
      { name: 'Amazon EC2', subService: undefined },
      {
        name: 'Elastic Load Balancing',
        subService: { name: 'Elastic Load Balancing', path: '/aws/ec2/elastic-load-balancing' },
      },
      {
        name: 'Classic Load Balancing',
        subService: { name: 'Classic Load Balancing', path: '/aws/ec2/classic-load-balancing' },
      },
      {
        name: 'EC2 Auto Scaling',
        subService: { name: 'EC2 Auto Scaling', path: '/aws/ec2/ec2-auto-scaling' },
      },
    ]);
  });

  it('lists the entries with screens in the original navigation order', () => {
    const builtLinks = ENTRIES.flatMap((group) => group.entries)
      .filter(({ path }) => entryHasScreen(screens, SERVICE, path))
      .map(({ label, path }) => ({ label, path }));
    expect(builtLinks).toEqual(originalLinks);
  });
});
