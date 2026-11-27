import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { screenCrumbs, screenTitle } from '../../screen-paths';

it.each([
  ['orders', 'orders'],
  ['*.', '.'],
  ['*..', '..'],
])('registers the bus at segment %s with its decoded title and crumbs', (segment, name) => {
  const page = areaPage(`/aws/events/event-buses/bus/${segment}`);
  expect(page.kind).toBe('screen');
  if (page.kind !== 'screen') throw new Error('Expected an event bus screen');
  expect(screenTitle(page.screen, page.params)).toBe(name);
  expect(screenCrumbs(page.screen, page.params)).toEqual([
    { text: 'Event buses', href: '/aws/events/event-buses' },
    { text: name },
  ]);
  expect(page.screen.navigation.activeHref).toBe('/aws/events/event-buses');
});
