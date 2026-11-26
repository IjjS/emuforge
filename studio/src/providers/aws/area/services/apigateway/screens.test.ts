import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { entryHasScreen } from '../../entries';
import { registryFaults, SCREENS as areaScreens, type ScreensFile } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';
import { SCREENS as apiListScreens } from './screens/apis';

it('collects the service screens without custom navigation items or leadsTo paths', () => {
  const files = Object.values(import.meta.glob<ScreensFile>('./screens/*.ts', { eager: true }));
  expect(SCREENS).toEqual(files.flatMap((file) => file.SCREENS));
  expect(registryFaults([{ folder: 'apigateway', screens: SCREENS }], () => true)).toEqual([]);
  for (const screen of SCREENS) {
    expect(screen.paths.some((path) => path.startsWith('/aws/apigateway/'))).toBe(true);
    expect(screen.navigation).not.toHaveProperty('items');
    expect(screen).not.toHaveProperty('leadsTo');
  }
});

it.each(['apis', '', 'rest-apis'])('opens the combined APIs list at the path suffix "%s"', (suffix) => {
  const path = suffix ? `/aws/apigateway/${suffix}` : '/aws/apigateway';
  expect(areaPage(path)).toMatchObject({
    kind: 'screen',
    screen: { Page: apiListScreens[0]?.Page },
    navigation: { activeHref: '/aws/apigateway/apis' },
  });
});

it('registers screens at exactly the seven built entries', () => {
  const built = ENTRIES.flatMap(({ entries }) => entries)
    .filter(({ path }) => entryHasScreen(areaScreens, '/apigateway', path))
    .map(({ label }) => label);
  expect(built).toEqual(['REST APIs', 'Resources', 'Stages', 'APIs', 'Routes', 'Integrations', 'V2 stages']);
});

it.each([
  ['apis/create', 'apis'],
  ['apis/rest/rest-1', 'rest-apis'],
  ['apis/rest/rest-1/methods/create', 'rest-apis'],
  ['apis/v2/http-1', 'apis'],
  ['apis/v2/http-1/routes/create', 'apis'],
  ['resources', 'resources'],
  ['stages', 'stages'],
  ['routes', 'routes'],
  ['integrations', 'integrations'],
  ['v2-stages', 'v2-stages'],
])('marks %s with %s current in the area navigation', (path, current) => {
  expect(areaPage(`/aws/apigateway/${path}`)).toMatchObject({
    kind: 'screen',
    navigation: { activeHref: `/aws/apigateway/${current}` },
  });
});
