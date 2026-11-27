import type { RuleState } from '@aws-sdk/client-eventbridge';

import { nameFromSegment, nameSegment } from '../../components/name-segment';
import type { ScreenParams } from '../../screens';

export const EVENTS_PATH = '/aws/events';
export const EVENT_BUSES_PATH = `${EVENTS_PATH}/event-buses`;
export const CREATE_EVENT_BUS_PATH = `${EVENT_BUSES_PATH}/create`;
export const EVENT_BUS_PATH = `${EVENT_BUSES_PATH}/bus/{bus}`;
export const RULES_PATH = `${EVENTS_PATH}/rules`;
export const CREATE_RULE_PATH = `${RULES_PATH}/create`;
export const RULE_PATH = `${RULES_PATH}/rule/{bus}/{rule}`;
export const SEND_EVENTS_PATH = `${EVENTS_PATH}/send-events`;

export const EVENT_BUSES_TITLE = 'Event buses';
export const CREATE_EVENT_BUS_TITLE = 'Create event bus';

export function busPath(bus: string): string {
  return `${EVENT_BUSES_PATH}/bus/${nameSegment(bus)}`;
}

export function rulePath(bus: string, rule: string): string {
  return `${RULES_PATH}/rule/${nameSegment(bus)}/${nameSegment(rule)}`;
}

function withBus(path: string, bus?: string): string {
  return bus === undefined ? path : `${path}?${new URLSearchParams({ bus }).toString()}`;
}

export function rulesPath(bus?: string): string {
  return withBus(RULES_PATH, bus);
}

export function createRulePath(bus?: string): string {
  return withBus(CREATE_RULE_PATH, bus);
}

export function sendEventsPath(bus?: string): string {
  return withBus(SEND_EVENTS_PATH, bus);
}

export function busFromParams(params: ScreenParams): string {
  return nameFromSegment(params.bus ?? '');
}

export function ruleFromParams(params: ScreenParams): string {
  return nameFromSegment(params.rule ?? '');
}

const STATE_LABELS: Record<RuleState, string> = {
  ENABLED: 'Enabled',
  DISABLED: 'Disabled',
  ENABLED_WITH_ALL_CLOUDTRAIL_MANAGEMENT_EVENTS: 'Enabled, with all CloudTrail management events',
};

export function ruleStateText(state: RuleState | undefined): string {
  return state === undefined ? '-' : (STATE_LABELS[state] ?? state);
}

export function ruleTriggerText(pattern: string | undefined, schedule: string | undefined): string {
  if (!pattern) return schedule || '-';
  return schedule ? `Event pattern, ${schedule}` : 'Event pattern';
}

export function isBusName(value: string): boolean {
  return /^[.\w-]{1,256}$/.test(value);
}
