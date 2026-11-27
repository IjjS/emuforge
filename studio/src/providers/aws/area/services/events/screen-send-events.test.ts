import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';

it('registers Send events below the Event buses crumb and marks Event buses current', () => {
  expect(areaPage('/aws/events/send-events')).toMatchObject({
    kind: 'screen',
    screen: {
      title: 'Send events',
      crumbs: [{ text: 'Event buses', href: '/aws/events/event-buses' }, { text: 'Send events' }],
      navigation: { activeHref: '/aws/events/event-buses' },
    },
  });
});
