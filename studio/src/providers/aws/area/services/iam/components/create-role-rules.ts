import type { Policy, Tag } from '../api';
import type { TrustedEntity } from '../trust-policy';

// What "Create role" holds and the rules of its three steps (issue 82, requirement R6.3 to R6.6), in EmuForge's own
// words. The rules decide at "Next" for the step shown and at "Create role" for all three; the emulator's own rules
// are its, and its answer is shown at submit (R10.3).

/** The three steps, from 1. */
export type WizardStep = 1 | 2 | 3;

export const STEPS: readonly WizardStep[] = [1, 2, 3];

/** The step `?step=<k>` names; any other value is step 1 (R6.2). */
export function stepOf(value: string | null): WizardStep {
  return value === '2' ? 2 : value === '3' ? 3 : 1;
}

/** "Trusted entity type" (R6.3). */
export type EntityType = 'aws-service' | 'aws-account' | 'custom';

/** "This account" or "Another AWS account". */
export type AccountChoice = 'this' | 'another';

/** What step 1 holds; the fields of every type are kept while another type is chosen. */
export interface TrustedEntityValues {
  type: EntityType;
  /** "Service or use case", as typed. */
  principal: string;
  account: AccountChoice;
  /** "Account ID", as typed. */
  accountId: string;
  requireExternalId: boolean;
  /** "External ID", as typed. */
  externalId: string;
  requireMfa: boolean;
  /** "Custom trust policy", as typed. */
  document: string;
}

/** A tag of the tag editor, as the editor holds it. */
export interface EditorTag {
  key: string;
  value: string;
  existing: boolean;
}

/** Everything the wizard holds; nothing of it is kept once the wizard is left (R6.8). */
export interface WizardValues {
  entity: TrustedEntityValues;
  /** The chosen policies, in the order of step 3's table: kept ones in place, new ones after them (R6.4). */
  policies: readonly Policy[];
  name: string;
  description: string;
  tags: readonly EditorTag[];
}

/** "This account" as the caller's `GetUser` gave it (R6.3). */
export interface CallerAccount {
  /** The account; `undefined` while it is read, or when it could not be. */
  account: string | undefined;
  /** It is being read: "Next" waits. */
  loading: boolean;
  /** It could not be read: "This account" is disabled and "Another AWS account" chosen. */
  unavailable: boolean;
}

/** The account choice in force: "Another AWS account" while "This account" is unavailable. */
export function accountChoiceOf(entity: TrustedEntityValues, caller: CallerAccount): AccountChoice {
  return caller.unavailable ? 'another' : entity.account;
}

/** The longest name and description the emulator was seen to accept (R2). */
const NAME_MAX = 64;
const DESCRIPTION_MAX = 1000;
/** The managed policies the emulator attaches to one role at most (R2). */
export const POLICIES_MAX = 10;
/** The tags the editor takes at most (R6.5). */
export const TAGS_MAX = 50;

/** A role name's alphabet (R6.6). */
const NAME_ALPHABET = /^[A-Za-z0-9+=,.@_-]+$/;
const ACCOUNT_ID = /^\d{12}$/;

export const MESSAGES = {
  principal: 'Enter a service principal.',
  accountId: 'Enter the 12 digits of an account ID.',
  externalId: 'Enter an external ID.',
  document: 'Enter a JSON policy document.',
  policies: `A role can have at most ${String(POLICIES_MAX)} managed policies in the emulator.`,
  nameEmpty: 'Enter a role name.',
  nameLength: `The name can have up to ${String(NAME_MAX)} characters.`,
  nameSigns: 'Use only letters, digits and +=,.@_-',
  description: `The description can have up to ${String(DESCRIPTION_MAX)} characters.`,
} as const;

/** The fields that can hold a message, in the order of the steps and, inside a step, of the form. */
export type Field =
  'principal' | 'accountId' | 'externalId' | 'document' | 'policies' | 'name' | 'description' | 'tags';

export const FIELDS_OF: Record<WizardStep, readonly Field[]> = {
  1: ['principal', 'accountId', 'externalId', 'document'],
  2: ['policies'],
  3: ['name', 'description', 'tags'],
};

/** A message per field that breaks a rule; `tags` is `true` when the editor's own messages apply. */
export type Messages = Partial<Record<Exclude<Field, 'tags'>, string>> & { tags?: true };

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function entityMessages(entity: TrustedEntityValues, caller: CallerAccount): Messages {
  switch (entity.type) {
    case 'aws-service':
      return entity.principal.trim() === '' ? { principal: MESSAGES.principal } : {};
    case 'aws-account':
      return {
        ...(accountChoiceOf(entity, caller) === 'another' &&
          !ACCOUNT_ID.test(entity.accountId) && { accountId: MESSAGES.accountId }),
        ...(entity.requireExternalId && entity.externalId === '' && { externalId: MESSAGES.externalId }),
      };
    case 'custom':
      return isJson(entity.document) ? {} : { document: MESSAGES.document };
  }
}

function nameMessage(name: string): string | undefined {
  if (name === '') {
    return MESSAGES.nameEmpty;
  }
  if (name.length > NAME_MAX) {
    return MESSAGES.nameLength;
  }
  return NAME_ALPHABET.test(name) ? undefined : MESSAGES.nameSigns;
}

/** A tag with an empty key, or a key another tag has too: the editor's own messages (R6.6). */
export function tagsBroken(tags: readonly EditorTag[]): boolean {
  const keys = tags.map((tag) => tag.key);
  return keys.some((key, index) => key === '' || keys.indexOf(key) !== index);
}

/** The messages of step `step` for what the wizard holds. */
export function stepMessages(step: WizardStep, values: WizardValues, caller: CallerAccount): Messages {
  switch (step) {
    case 1:
      return entityMessages(values.entity, caller);
    case 2:
      return values.policies.length > POLICIES_MAX ? { policies: MESSAGES.policies } : {};
    case 3: {
      const name = nameMessage(values.name);
      return {
        ...(name !== undefined && { name }),
        ...(values.description.length > DESCRIPTION_MAX && { description: MESSAGES.description }),
        ...(tagsBroken(values.tags) && { tags: true as const }),
      };
    }
  }
}

/** The first field of `step` with a message, in the form's order. */
export function firstField(step: WizardStep, messages: Messages): Field | undefined {
  return FIELDS_OF[step].find((field) => messages[field] !== undefined);
}

export function passes(step: WizardStep, values: WizardValues, caller: CallerAccount): boolean {
  return firstField(step, stepMessages(step, values, caller)) === undefined;
}

/**
 * The trusted entity step 1 describes, for the trust policy; `undefined` while step 1 breaks a rule or "This account"
 * is not known (R6.5: "Step 1 is not complete.").
 */
export function trustedEntityOf(values: WizardValues, caller: CallerAccount): TrustedEntity | undefined {
  if (!passes(1, values, caller)) {
    return undefined;
  }
  const { entity } = values;
  switch (entity.type) {
    case 'aws-service':
      return { type: 'aws-service', principal: entity.principal };
    case 'custom':
      return { type: 'custom', document: entity.document };
    case 'aws-account': {
      const account = accountChoiceOf(entity, caller) === 'this' ? caller.account : entity.accountId;
      if (account === undefined) {
        return undefined;
      }
      return {
        type: 'aws-account',
        account,
        ...(entity.requireExternalId && { externalId: entity.externalId }),
        requireMfa: entity.requireMfa,
      };
    }
  }
}

/** The tags `CreateRole` sends, in the editor's order. */
export function tagsOf(tags: readonly EditorTag[]): Tag[] {
  return tags.map(({ key, value }) => ({ key, value }));
}
