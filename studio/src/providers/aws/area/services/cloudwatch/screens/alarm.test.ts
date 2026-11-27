import { expect, it } from 'vitest';

import { areaPage } from '../../../area-page';

it.each(['alarm with  spaces\nand a line', undefined])('resolves the alarm route for %s', (name) => {
  const query = name === undefined ? new URLSearchParams() : new URLSearchParams({ name });
  const page = areaPage('/aws/cloudwatch/alarms/alarm');
  expect(page.kind).toBe('screen');
  if (page.kind !== 'screen') throw new Error('Alarm route missing');
  const { title, crumbs } = page.screen;
  const text = name ?? 'Alarm not found';
  expect(typeof title === 'function' && title({}, query)).toBe(text);
  expect(typeof crumbs === 'function' && crumbs({}, query)).toEqual([
    { text: 'Alarms', href: '/aws/cloudwatch/alarms' },
    { text },
  ]);
});
