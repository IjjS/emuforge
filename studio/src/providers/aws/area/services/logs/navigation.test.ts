import { expect, it } from 'vitest';

import { SCREENS } from './screens';

it('keeps the service header and marks the corresponding entry current on every screen', () => {
  for (const { navigation, paths } of SCREENS) {
    expect(navigation).toStrictEqual({
      header: { text: 'CloudWatch Logs', href: '/aws/logs' },
      activeHref: paths.includes('/aws/logs/log-streams') ? '/aws/logs/log-streams' : '/aws/logs/log-groups',
    });
  }
});
