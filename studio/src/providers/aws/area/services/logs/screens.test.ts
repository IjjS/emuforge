import { expect, it } from 'vitest';

import { areaPage } from '../../area-page';
import { registryFaults, SCREEN_FOLDERS } from '../../screens';
import { ENTRIES } from './entries';
import { SCREENS } from './screens';

it('registers distinct CloudWatch Logs paths with crumbs and meets the area registry rules', () => {
  const folders = SCREEN_FOLDERS.filter(({ folder }) => folder === 'logs');
  expect(folders).toEqual([{ folder: 'logs', screens: SCREENS }]);
  expect(registryFaults(folders, (folder) => folder === 'logs')).toEqual([]);
  expect(areaPage('/aws/logs')).toMatchObject({ kind: 'screen', screen: { title: 'Log groups' } });
  expect(areaPage('/aws/logs/log-groups')).toMatchObject({ kind: 'screen', screen: { title: 'Log groups' } });

  for (const { path } of ENTRIES.flatMap((group) => group.entries)) {
    const page = areaPage(path);
    if (page.kind === 'entry') expect(page.navigation.activeHref).toBe(path);
    else expect(page.kind).toBe('screen');
  }
});
