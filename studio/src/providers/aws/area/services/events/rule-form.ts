import type { PutRuleCommandInput } from '@aws-sdk/client-eventbridge';

import { busDescriptionError } from './bus-form';

export { BUS_DESCRIPTION_RULE as RULE_DESCRIPTION_RULE } from './bus-form';

export const CREATE_RULE_TITLE = 'Create rule';
export const RULE_NAME_RULE = '1 to 64 characters. Use letters, digits, periods, hyphens and underscores.';
export const EVENT_PATTERN_RULE = 'Enter a JSON object of up to 2048 characters.';
export const RATE_NUMBER_RULE = 'Enter a whole number of 1 or more.';

export interface RuleForm {
  name: string;
  description: string;
  trigger: 'pattern' | 'schedule';
  pattern: string;
  scheduleKind: 'rate' | 'cron';
  rate: string;
  unit: RateUnit;
  cron: string;
  state: 'ENABLED' | 'DISABLED';
}

export type RateUnit = 'minute' | 'hour' | 'day';
export type RuleField = 'name' | 'description' | 'pattern' | 'rate' | 'cron';

export const INITIAL_RULE_FORM: RuleForm = {
  name: '',
  description: '',
  trigger: 'pattern',
  pattern: '',
  scheduleKind: 'rate',
  rate: '1',
  unit: 'minute',
  cron: '',
  state: 'ENABLED',
};

export function chooseRuleBus(form: RuleForm, bus: string): RuleForm {
  return bus === 'default' || form.trigger === 'pattern' ? form : { ...form, trigger: 'pattern' };
}

function rateNumber(value: string): string {
  return value.replace(/^0+/, '');
}

export function rateExpression(value: string, unit: RateUnit): string {
  const number = rateNumber(value);
  return `rate(${number} ${unit}${number === '1' ? '' : 's'})`;
}

function validPattern(value: string): boolean {
  if ([...value].length > 2048) return false;
  try {
    const json: unknown = JSON.parse(value);
    return json !== null && typeof json === 'object' && !Array.isArray(json);
  } catch {
    return false;
  }
}

export function validateRule(form: RuleForm): Partial<Record<RuleField, string>> {
  const errors: Partial<Record<RuleField, string>> = {};
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(form.name)) {
    errors.name = form.name === '' ? 'Enter a rule name.' : RULE_NAME_RULE;
  }
  const descriptionError = busDescriptionError(form.description);
  if (descriptionError) errors.description = descriptionError;
  if (form.trigger === 'pattern') {
    if (!validPattern(form.pattern)) errors.pattern = EVENT_PATTERN_RULE;
  } else if (form.scheduleKind === 'rate') {
    if (!/^\d+$/.test(form.rate) || rateNumber(form.rate) === '') errors.rate = RATE_NUMBER_RULE;
  } else if (form.cron.trim() === '') {
    errors.cron = 'Enter a cron expression.';
  }
  return errors;
}

export function createRuleInput(form: RuleForm, bus: string): PutRuleCommandInput {
  return {
    Name: form.name,
    EventBusName: bus,
    State: form.state,
    ...(form.description !== '' && { Description: form.description }),
    ...(form.trigger === 'pattern'
      ? { EventPattern: form.pattern }
      : { ScheduleExpression: form.scheduleKind === 'rate' ? rateExpression(form.rate, form.unit) : form.cron }),
  };
}
