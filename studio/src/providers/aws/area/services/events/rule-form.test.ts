import { expect, it } from 'vitest';

import {
  chooseRuleBus,
  createRuleInput,
  EVENT_PATTERN_RULE,
  INITIAL_RULE_FORM,
  RATE_NUMBER_RULE,
  rateExpression,
  RULE_NAME_RULE,
  validateRule,
} from './rule-form';

const pattern = '{"source":["shop"]}';
const form = { ...INITIAL_RULE_FORM, name: 'route', pattern };

it('checks a rule name and description at their limits', () => {
  expect(validateRule({ ...form, name: '' }).name).toBe('Enter a rule name.');
  for (const name of ['a'.repeat(65), 'a b', 'a/b', 'a\n']) {
    expect(validateRule({ ...form, name }).name).toBe(RULE_NAME_RULE);
  }
  for (const name of ['.', '..', 'a-0_'.repeat(16)]) {
    expect(validateRule({ ...form, name })).toEqual({});
  }
  expect(validateRule({ ...form, description: '🙂'.repeat(512) })).toEqual({});
  expect(validateRule({ ...form, description: 'a'.repeat(513) }).description).toBe(
    'Enter a description of up to 512 characters.',
  );
});

it('accepts only a JSON object of up to 2048 characters', () => {
  const object = JSON.stringify({ key: 'x'.repeat(2038) });
  expect(object).toHaveLength(2048);
  expect(validateRule({ ...form, pattern: object })).toEqual({});
  for (const invalid of ['not json', '[]', 'null', object + ' ']) {
    expect(validateRule({ ...form, pattern: invalid }).pattern).toBe(EVENT_PATTERN_RULE);
  }
});

it.each(['minute', 'hour', 'day'] as const)('writes singular and plural for the %s unit', (unit) => {
  expect(rateExpression('1', unit)).toBe(`rate(1 ${unit})`);
  expect(rateExpression('5', unit)).toBe(`rate(5 ${unit}s)`);
});

it('rejects an empty, fractional or zero rate and empty cron text', () => {
  const schedule = { ...form, trigger: 'schedule' as const };
  for (const rate of ['0', '1.5', '']) {
    expect(validateRule({ ...schedule, rate }).rate).toBe(RATE_NUMBER_RULE);
  }
  expect(validateRule({ ...schedule, scheduleKind: 'cron', cron: '' }).cron).toBe('Enter a cron expression.');
});

it('sends only the selected trigger and omits an empty description', () => {
  expect(createRuleInput(form, 'orders')).toStrictEqual({
    Name: 'route',
    EventBusName: 'orders',
    State: 'ENABLED',
    EventPattern: pattern,
  });
  const scheduled = {
    ...form,
    trigger: 'schedule',
    description: 'Routes orders',
    rate: '5',
    state: 'DISABLED',
  } as const;
  expect(createRuleInput(scheduled, 'default')).toStrictEqual({
    Name: 'route',
    EventBusName: 'default',
    State: 'DISABLED',
    ScheduleExpression: 'rate(5 minutes)',
    Description: 'Routes orders',
  });
  const cron = 'cron(0 12 * * ? *)';
  expect(createRuleInput({ ...scheduled, scheduleKind: 'cron', cron }, 'default').ScheduleExpression).toBe(cron);
});

it('returns to an event pattern when leaving the default bus', () => {
  const scheduled = { ...form, trigger: 'schedule' as const };
  expect(chooseRuleBus(scheduled, 'default')).toBe(scheduled);
  expect(chooseRuleBus(scheduled, 'orders')).toEqual(form);
});
