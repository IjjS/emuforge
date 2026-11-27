import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { screenCrumbs, screenTitle } from '../../screen-paths';
import { RulePage } from './pages/rule-page';

it('resolves the rule address and marks Rules current with a decoded title and crumb', () => {
  const page = areaPage('/aws/events/rules/rule/*./*..');
  if (page.kind !== 'screen') throw new Error('Expected a rule screen');
  expect(page.screen.Page).toBe(RulePage);
  expect(screenTitle(page.screen, page.params)).toBe('..');
  expect(screenCrumbs(page.screen, page.params)).toEqual([
    { text: 'Rules', href: '/aws/events/rules?bus=.' },
    { text: '..' },
  ]);
  expect(page.navigation.activeHref).toBe('/aws/events/rules');
});

it.each(['default', 'orders'])('links the Rules breadcrumb to the %s bus', (bus) => {
  const page = areaPage(`/aws/events/rules/rule/${bus}/route-orders`);
  if (page.kind !== 'screen') throw new Error('Expected a rule screen');
  expect(screenCrumbs(page.screen, page.params)[0]).toEqual({ text: 'Rules', href: `/aws/events/rules?bus=${bus}` });
});
