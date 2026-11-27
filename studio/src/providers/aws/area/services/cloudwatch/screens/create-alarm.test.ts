import { expect, it } from 'vitest';

import { areaPage } from '../../../area-page';

it('registers Create alarm under Alarms', () => {
  const page = areaPage('/aws/cloudwatch/alarms/create');
  expect(page).toMatchObject({
    kind: 'screen',
    screen: {
      title: 'Create alarm',
      crumbs: [{ text: 'Alarms', href: '/aws/cloudwatch/alarms' }, { text: 'Create alarm' }],
    },
  });
});
