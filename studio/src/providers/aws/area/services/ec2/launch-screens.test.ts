import { describe, expect, it } from 'vitest';

import { LAUNCH_SCREENS } from './launch-screens';
import { LaunchInstancePage } from './pages/launch-instance-page';
import { SCREENS } from './screens';

describe("EC2's launch screen", () => {
  it('S2 answers at /aws/ec2/instances/launch with its title, the crumbs "Instances" then "Launch instance", and "Instances" active', () => {
    const screen = SCREENS.find((candidate) => candidate.paths.includes('/aws/ec2/instances/launch'));
    expect(screen).toBeDefined();
    expect(LAUNCH_SCREENS).toContain(screen);
    expect(screen?.Page).toBe(LaunchInstancePage);
    expect(screen?.title).toBe('Launch instance');
    expect(screen?.crumbs).toEqual([{ text: 'Instances', href: '/aws/ec2/instances' }, { text: 'Launch instance' }]);
    expect(screen?.navigation.activeHref).toBe('/aws/ec2/instances');
    expect(screen?.navigation.header).toEqual({ text: 'EC2', href: '/aws/ec2' });
  });
});
