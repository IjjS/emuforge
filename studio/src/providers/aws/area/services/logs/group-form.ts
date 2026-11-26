import type { CreateLogGroupCommandInput, LogGroupClass } from '@aws-sdk/client-cloudwatch-logs';

import { tagsToRecord, type LogGroupTag } from './tags';

export interface CreateLogGroupForm {
  name: string;
  logClass: LogGroupClass;
  retention: number | undefined;
  deletionProtection: boolean;
  tags: LogGroupTag[];
}

export const INITIAL_GROUP_FORM: CreateLogGroupForm = {
  name: '',
  logClass: 'STANDARD',
  retention: undefined,
  deletionProtection: false,
  tags: [],
};

export const NAME_RULE = '1 to 512 characters. Use letters, digits and . - _ / #. The name cannot start with aws/.';

export function logGroupNameError(name: string): string | undefined {
  if (name.length < 1 || name.length > 512) return 'Enter a name of 1 to 512 characters.';
  if (/[^.\-_/#A-Za-z0-9]/.test(name)) return 'Use only letters, digits and . - _ / #.';
  if (name.startsWith('aws/')) return 'The name cannot start with aws/.';
  return undefined;
}

export function groupFormChanged(form: CreateLogGroupForm): boolean {
  return (
    form.name !== INITIAL_GROUP_FORM.name ||
    form.logClass !== INITIAL_GROUP_FORM.logClass ||
    form.retention !== INITIAL_GROUP_FORM.retention ||
    form.deletionProtection !== INITIAL_GROUP_FORM.deletionProtection ||
    form.tags.length !== 0
  );
}

export function createGroupInput(form: CreateLogGroupForm): CreateLogGroupCommandInput {
  return {
    logGroupName: form.name,
    logGroupClass: form.logClass,
    ...(form.deletionProtection ? { deletionProtectionEnabled: true } : {}),
    ...(form.tags.length > 0 ? { tags: tagsToRecord(form.tags) } : {}),
  };
}
