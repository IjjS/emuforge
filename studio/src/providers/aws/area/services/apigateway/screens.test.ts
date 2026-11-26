import { expect, it } from 'vitest';

import { registryFaults, type ScreensFile } from '../../screens';
import { ENTRIES } from './entries';
import { apisPath, servicePath } from './format';
import { apiGatewayNavigation } from './navigation';
import { SCREENS } from './screens';

it('collects valid API Gateway screen entries from the screen modules', () => {
  const files = Object.values(import.meta.glob<ScreensFile>('./screens/*.ts', { eager: true }));
  expect(files.length).toBeGreaterThan(0);
  expect(SCREENS).toEqual(files.flatMap((file) => file.SCREENS));
  expect(registryFaults([{ folder: 'apigateway', screens: SCREENS }], () => true)).toEqual([]);
  for (const screen of SCREENS) {
    expect(screen.paths.length).toBeGreaterThan(0);
    expect(screen.navigation).toEqual(apiGatewayNavigation(screen.navigation.activeHref));
  }
});

it('opens APIs from both entry paths and hands unbuilt entries to the area', () => {
  const screen = SCREENS.find(({ paths }) => paths.includes(apisPath));
  expect(screen?.paths).toEqual([apisPath, servicePath]);
  expect(screen?.leadsTo).toEqual(ENTRIES.filter(({ built }) => !built).map(({ path }) => path));
});
