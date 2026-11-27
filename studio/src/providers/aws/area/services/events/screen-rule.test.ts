import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { RulePage } from './pages/rule-page';

it('resolves the rule address and marks Rules current with a decoded title and crumb', () => {
  expect(areaPage('/aws/events/rules/rule/*./*..')).toMatchObject({
    kind: 'screen',
    screen: {
      title: '..',
      crumbs: [{ text: 'Rules', href: '/aws/events/rules' }, { text: '..' }],
      navigation: { activeHref: '/aws/events/rules' },
      Page: RulePage,
    },
  });
});
