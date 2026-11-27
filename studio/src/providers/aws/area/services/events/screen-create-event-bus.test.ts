import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { screenCrumbs, screenTitle } from '../../screen-paths';
import { CreateEventBusPage } from './pages/create-event-bus-page';
import { EventBusPage } from './pages/event-bus-page';

it('registers Create event bus under Event buses and distinguishes a bus named create', () => {
  const path = '/aws/events/event-buses';
  const create = areaPage(`${path}/create`);
  expect(create.kind).toBe('screen');
  if (create.kind !== 'screen') throw new Error('Expected the create screen');
  expect(create.screen.Page).toBe(CreateEventBusPage);
  expect(screenTitle(create.screen, create.params)).toBe('Create event bus');
  expect(screenCrumbs(create.screen, create.params)).toEqual([
    { text: 'Event buses', href: path },
    { text: 'Create event bus' },
  ]);
  expect(create.screen.navigation.activeHref).toBe(path);
  expect(areaPage(`${path}/bus/create`)).toMatchObject({ kind: 'screen', screen: { Page: EventBusPage } });
});
