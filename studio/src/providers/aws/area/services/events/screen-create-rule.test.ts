import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { screenCrumbs, screenTitle } from '../../screen-paths';
import { CreateRulePage } from './pages/create-rule-page';
import { RulePage } from './pages/rule-page';

it('opens the create screen below Rules and keeps a rule named create on its own page', () => {
  const page = areaPage('/aws/events/rules/create');
  if (page.kind !== 'screen') throw new Error('Expected the create rule screen');
  expect(page.screen.Page).toBe(CreateRulePage);
  expect(screenTitle(page.screen, page.params)).toBe('Create rule');
  expect(screenCrumbs(page.screen, page.params)).toEqual([
    { text: 'Rules', href: '/aws/events/rules' },
    { text: 'Create rule' },
  ]);
  expect(page.navigation.activeHref).toBe('/aws/events/rules');

  const rule = areaPage('/aws/events/rules/rule/default/create');
  if (rule.kind !== 'screen') throw new Error('Expected a rule screen');
  expect(rule.screen.Page).toBe(RulePage);
});

it.each([
  ['bus=orders', '/aws/events/rules?bus=orders'],
  ['bus=', '/aws/events/rules?bus='],
])('returns to Rules with the original bus query %s', (query, href) => {
  const page = areaPage('/aws/events/rules/create');
  if (page.kind !== 'screen') throw new Error('Expected the create rule screen');
  expect(screenCrumbs(page.screen, page.params, new URLSearchParams(query))).toEqual([
    { text: 'Rules', href },
    { text: 'Create rule' },
  ]);
});
