import { expect, it } from 'vitest';

import { areaPage } from '../../../area-page';

it('registers Edit alarm with a link to the exact alarm named in the query', () => {
  const name = ' local  alarms /?# ';
  const query = new URLSearchParams({ name });
  const page = areaPage('/aws/cloudwatch/alarms/edit');

  expect(page.kind).toBe('screen');
  if (page.kind !== 'screen') throw new Error('Edit route missing');
  const { title, crumbs } = page.screen;
  expect(title).toBe('Edit alarm');
  expect(typeof crumbs === 'function' && crumbs({}, query)).toEqual([
    { text: 'Alarms', href: '/aws/cloudwatch/alarms' },
    { text: name, href: '/aws/cloudwatch/alarms/alarm?' + query.toString() },
    { text: 'Edit' },
  ]);
});
