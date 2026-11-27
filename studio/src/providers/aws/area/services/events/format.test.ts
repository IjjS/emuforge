import { expect, it } from 'vitest';

import {
  busFromParams,
  busPath,
  createRulePath,
  isBusName,
  ruleFromParams,
  rulePath,
  rulesPath,
  ruleStateText,
  ruleTriggerText,
  sendEventsPath,
} from './format';

it('writes each resource name as one segment and each bus choice as a query value', () => {
  expect(busPath('shop/orders#new')).toBe('/aws/events/event-buses/bus/shop%2Forders%23new');
  expect(rulePath('shop/orders', 'route#new')).toBe('/aws/events/rules/rule/shop%2Forders/route%23new');
  expect(rulesPath('orders')).toBe('/aws/events/rules?bus=orders');
  expect(createRulePath('shop/orders')).toBe('/aws/events/rules/create?bus=shop%2Forders');
  expect(sendEventsPath('orders')).toBe('/aws/events/send-events?bus=orders');
});

it('keeps both dot names in an address and decodes the matched parameters', () => {
  expect(new URL(busPath('.'), 'http://127.0.0.1').pathname).toBe('/aws/events/event-buses/bus/*.');
  expect(new URL(rulePath('.', '..'), 'http://127.0.0.1').pathname).toBe('/aws/events/rules/rule/*./*..');
  expect(busFromParams({ bus: '*.' })).toBe('.');
  expect(ruleFromParams({ rule: '*..' })).toBe('..');
});

it('shows the three rule states and an absent state', () => {
  expect(ruleStateText('ENABLED')).toBe('Enabled');
  expect(ruleStateText('DISABLED')).toBe('Disabled');
  expect(ruleStateText('ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS')).toBe(
    'Enabled, with all CloudTrail management events',
  );
  expect(ruleStateText(undefined)).toBe('-');
});

it('shows both kinds of trigger when both are set', () => {
  expect(ruleTriggerText('{}', undefined)).toBe('Event pattern');
  expect(ruleTriggerText(undefined, 'rate(5 minutes)')).toBe('rate(5 minutes)');
  expect(ruleTriggerText('{}', 'rate(5 minutes)')).toBe('Event pattern, rate(5 minutes)');
  expect(ruleTriggerText(undefined, undefined)).toBe('-');
});

it.each(['shop.A-2_b', 'default', '.', '..', 'a'.repeat(256)])('recognizes %j as a bus name', (name) => {
  expect(isBusName(name)).toBe(true);
});

it.each(['', 'a'.repeat(257), 'arn:aws:events:us-east-1:000000000000:event-bus/orders', 'two words', 'line\n'])(
  'rejects %j as a bus name',
  (name) => expect(isBusName(name)).toBe(false),
);
