import type { RequestFailure } from '../../../../../lib/aws/request';
import type { Published } from './api';

// The publish form of S3's "Publish" tab (issue 536, design task 3): its state and its last result, kept by the
// topic's page across its tabs, and what the form checks before sending.

/** One message attribute row: its name, type and value as typed. */
export interface AttributeRow {
  name: string;
  type: 'String' | 'Number';
  value: string;
}

/** The form's text as typed. */
export interface PublishForm {
  message: string;
  subject: string;
  attributes: readonly AttributeRow[];
  groupId: string;
  deduplicationId: string;
}

/**
 * The last publish's outcome: what the emulator answered, or why it was not published. A published one keeps whether
 * the topic had a subscription, read once when the publish was answered (absent when that read failed), so a later
 * change of the subscriptions does not change what an earlier publish says.
 */
export type PublishResult =
  { kind: 'published'; published: Published; subscribed?: boolean } | { kind: 'refused'; failure: RequestFailure };

/** The form as the page opens. */
export const EMPTY_FORM: PublishForm = { message: '', subject: '', attributes: [], groupId: '', deduplicationId: '' };

// ---------------------------------------------------------------------------------------------------------------
// What the form checks before it sends `Publish` (design task 3 step 3), with the requirement's messages.

export const ENTER_MESSAGE = 'Enter a message.';
export const ENTER_NAME = 'Enter a name.';
export const ENTER_VALUE = 'Enter a value.';
export const NAME_USED = 'This name is already used.';
export const ENTER_GROUP_ID = 'Enter a message group ID.';
export const ENTER_DEDUPLICATION_ID = 'Enter a message deduplication ID.';

/** What the topic asks of a message. */
export interface PublishRules {
  fifo: boolean;
  contentBasedDeduplication: boolean;
}

/** One attribute row's messages. */
export interface AttributeFaults {
  name?: string;
  value?: string;
}

/** The form's messages; a field without one is absent. */
export interface PublishFaults {
  message?: string;
  /** One entry per row, in the rows' order; a row without fault is `{}`. */
  attributes: AttributeFaults[];
  groupId?: string;
  deduplicationId?: string;
}

/** The fields in the order the form shows them: where the focus goes at a fault. */
export type PublishField =
  | { field: 'message' }
  | { field: 'attribute'; row: number; part: 'name' | 'value' }
  | { field: 'groupId' }
  | { field: 'deduplicationId' };

/** What is wrong with `form` for a topic of `rules`. */
export function publishFaults(form: PublishForm, rules: PublishRules): PublishFaults {
  const faults: PublishFaults = { attributes: [] };
  if (form.message === '') {
    faults.message = ENTER_MESSAGE;
  }
  const seen = new Set<string>();
  for (const row of form.attributes) {
    const fault: AttributeFaults = {};
    if (row.name === '') {
      fault.name = ENTER_NAME;
    } else if (seen.has(row.name)) {
      fault.name = NAME_USED;
    } else {
      seen.add(row.name);
    }
    if (row.value === '') {
      fault.value = ENTER_VALUE;
    }
    faults.attributes.push(fault);
  }
  if (rules.fifo) {
    if (form.groupId === '') {
      faults.groupId = ENTER_GROUP_ID;
    }
    if (form.deduplicationId === '' && !rules.contentBasedDeduplication) {
      faults.deduplicationId = ENTER_DEDUPLICATION_ID;
    }
  }
  return faults;
}

/** The first field at fault, in the form's order; `undefined` when the form may be sent. */
export function firstFault(faults: PublishFaults): PublishField | undefined {
  if (faults.message !== undefined) {
    return { field: 'message' };
  }
  for (const [row, fault] of faults.attributes.entries()) {
    if (fault.name !== undefined) {
      return { field: 'attribute', row, part: 'name' };
    }
    if (fault.value !== undefined) {
      return { field: 'attribute', row, part: 'value' };
    }
  }
  if (faults.groupId !== undefined) {
    return { field: 'groupId' };
  }
  if (faults.deduplicationId !== undefined) {
    return { field: 'deduplicationId' };
  }
  return undefined;
}
