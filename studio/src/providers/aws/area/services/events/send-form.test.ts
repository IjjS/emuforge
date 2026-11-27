import { expect, it } from 'vitest';

import { DETAIL_CONSTRAINT, INITIAL_SEND_FORM, sendEntry, SOURCE_CONSTRAINT, validateSendForm } from './send-form';

const valid = { ...INITIAL_SEND_FORM, source: 'shop', detailType: 'order placed' };

it.each([
  [{ source: '' }, { source: 'Enter a source.' }],
  [{ source: 'aws.shop' }, { source: SOURCE_CONSTRAINT }],
  [{ detailType: '' }, { detailType: 'Enter a detail type.' }],
  [{ detail: '{' }, { detail: DETAIL_CONSTRAINT }],
  [{ detail: '[]' }, { detail: DETAIL_CONSTRAINT }],
  [{ detail: '1' }, { detail: DETAIL_CONSTRAINT }],
  [{ detail: 'null' }, { detail: DETAIL_CONSTRAINT }],
  [{ detail: '{}' }, {}],
])('validates the send form with %j', (patch, expected) => {
  expect(validateSendForm({ ...valid, ...patch })).toEqual(expected);
});

it('sends only the chosen bus name and the three entered strings', () => {
  expect(sendEntry('orders', { ...valid, detail: '{ "total": 8 }' })).toEqual({
    EventBusName: 'orders',
    Source: 'shop',
    DetailType: 'order placed',
    Detail: '{ "total": 8 }',
  });
});
