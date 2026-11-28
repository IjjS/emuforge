import type { Target } from '@aws-sdk/client-eventbridge';

export const MAX_TARGETS = 5;
export const TARGET_LIMIT_TEXT = 'A rule holds at most 5 targets.';
export const TARGET_ID_CONSTRAINT = '1 to 64 characters. Use letters, digits, periods, hyphens and underscores.';
export const EXISTING_TARGET_ID = 'The rule already holds a target with this ID.';

export type TargetKind = 'sqs' | 'sns' | 'logs';
export type TargetInputKind = 'matched' | 'constant' | 'path';

export interface TargetResource {
  value: string;
  label: string;
  description: string;
}

export interface TargetDraft {
  id: string;
  kind?: TargetKind | undefined;
  resource?: TargetResource | undefined;
  queueArn?: { url: string; arn: string } | undefined;
  messageGroupId: string;
  inputKind: TargetInputKind;
  input: string;
  path: string;
}

export type TargetField = 'id' | 'kind' | 'resource' | 'messageGroupId' | 'input' | 'path';
export type TargetErrors = Partial<Record<TargetField, string>>;

export function emptyTarget(): TargetDraft {
  return { id: '', messageGroupId: '', inputKind: 'matched', input: '', path: '' };
}

export function chooseTargetKind(draft: TargetDraft, kind: TargetKind): TargetDraft {
  return draft.kind === kind ? draft : { ...draft, kind, resource: undefined, queueArn: undefined, messageGroupId: '' };
}

export function chooseTargetResource(draft: TargetDraft, resource: TargetResource | undefined): TargetDraft {
  return draft.resource?.value === resource?.value
    ? draft
    : { ...draft, resource, queueArn: undefined, messageGroupId: '' };
}

export function setTargetQueueArn(draft: TargetDraft, url: string, arn: string): TargetDraft {
  return draft.kind === 'sqs' && draft.resource?.value === url ? { ...draft, queueArn: { url, arn } } : draft;
}

export function isFifoTarget(draft: TargetDraft): boolean {
  return draft.kind === 'sqs' && draft.resource?.label.endsWith('.fifo') === true;
}

function resourceArn(draft: TargetDraft): string | undefined {
  if (draft.kind !== 'sqs') return draft.resource?.value;
  return draft.queueArn?.url === draft.resource?.value ? draft.queueArn?.arn : undefined;
}

export function validateTarget(
  draft: TargetDraft,
  { duplicate = false, existingIds = [] }: { duplicate?: boolean; existingIds?: readonly (string | undefined)[] } = {},
): TargetErrors {
  const errors: TargetErrors = {};
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(draft.id)) {
    errors.id = draft.id === '' ? 'Enter a target ID.' : TARGET_ID_CONSTRAINT;
  } else if (duplicate) {
    errors.id = 'Use each target ID only once.';
  } else if (existingIds.includes(draft.id)) {
    errors.id = EXISTING_TARGET_ID;
  }
  if (draft.kind === undefined) errors.kind = 'Choose a target kind.';
  else if (draft.resource === undefined) errors.resource = 'Choose a target resource.';
  else if (resourceArn(draft) === undefined) errors.resource = 'The queue ARN must be read before saving.';
  if (isFifoTarget(draft) && draft.messageGroupId.trim() === '') {
    errors.messageGroupId = 'Enter a message group ID.';
  }
  if (draft.inputKind === 'constant') {
    try {
      JSON.parse(draft.input);
    } catch {
      errors.input = 'Enter valid JSON.';
    }
  }
  if (draft.inputKind === 'path' && draft.path.trim() === '') errors.path = 'Enter a JSON path.';
  return errors;
}

export function buildTarget(draft: TargetDraft): Target | undefined {
  const arn = resourceArn(draft);
  if (arn === undefined || Object.keys(validateTarget(draft)).length > 0) return undefined;
  return {
    Id: draft.id,
    Arn: arn,
    ...(isFifoTarget(draft) && { SqsParameters: { MessageGroupId: draft.messageGroupId } }),
    ...(draft.inputKind === 'constant' && { Input: draft.input }),
    ...(draft.inputKind === 'path' && { InputPath: draft.path }),
  };
}
