import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { registryFaults, SCREEN_FOLDERS } from '../../screens';
import { SCREENS } from './screens';

it('registers distinct EventBridge paths with crumbs and meets the area registry rules', () => {
  const folders = SCREEN_FOLDERS.filter(({ folder }) => folder === 'events');
  expect(folders).toEqual([{ folder: 'events', screens: SCREENS }]);
  expect(registryFaults(folders, (folder) => folder === 'events')).toEqual([]);
});

it.each(['/aws/events', '/aws/events/event-buses'])(
  'opens the bus list at %s and marks Event buses current',
  (path) => {
    expect(areaPage(path)).toMatchObject({
      kind: 'screen',
      screen: {
        title: 'Event buses',
        crumbs: [{ text: 'Event buses' }],
        navigation: { activeHref: '/aws/events/event-buses' },
      },
    });
  },
);
