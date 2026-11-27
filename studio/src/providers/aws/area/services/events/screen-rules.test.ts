import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';

it('registers Rules with its title and marks it current', () => {
  expect(areaPage('/aws/events/rules')).toMatchObject({
    kind: 'screen',
    screen: {
      title: 'Rules',
      crumbs: [{ text: 'Rules' }],
      navigation: { activeHref: '/aws/events/rules' },
    },
  });
});
