import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { registryFaults, SCREEN_FOLDERS } from '../../screens';
import { SCREENS } from './screens';

it('registers distinct CloudWatch paths with crumbs and meets the area registry rules', () => {
  expect(SCREENS).not.toContain(undefined);
  const folders = SCREEN_FOLDERS.filter(({ folder }) => folder === 'cloudwatch');
  expect(folders).toEqual([{ folder: 'cloudwatch', screens: SCREENS }]);
  expect(registryFaults(folders, (folder) => folder === 'cloudwatch')).toEqual([]);
  for (const path of ['/aws/cloudwatch', '/aws/cloudwatch/alarms']) {
    expect(areaPage(path)).toMatchObject({ kind: 'screen', screen: { title: 'Alarms' } });
  }
});
