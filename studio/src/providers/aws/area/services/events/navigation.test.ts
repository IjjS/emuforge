import { expect, it } from 'vitest';

import { eventsNavigation } from './navigation';
import { SCREENS } from './screens';

it('uses the service route for the navigation header and leaves items to the entries', () => {
  expect(eventsNavigation('/aws/events/event-buses')).toEqual({
    header: { text: 'EventBridge', href: '/aws/events' },
    activeHref: '/aws/events/event-buses',
  });
  for (const { navigation } of SCREENS) {
    expect(navigation.items).toBeUndefined();
  }
});
