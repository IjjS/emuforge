import { expect, it } from 'vitest';

import { cloudWatchNavigation } from './navigation';

it('points the CloudWatch header at the service and leaves the items to the entries registry', () => {
  expect(cloudWatchNavigation()).toEqual({
    header: { text: 'CloudWatch', href: '/aws/cloudwatch' },
    activeHref: '/aws/cloudwatch/alarms',
  });
});
