import type { RequestFailure } from '../../../../../lib/aws/request';
import type { Published } from './api';

// The publish form of S3's "Publish" tab (issue 536, design task 3): its state and its last result, kept by the
// topic's page across its tabs. What the form checks before sending is added with the tab (unit s4).

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

/** The last publish's outcome: what the emulator answered, or why it was not published. */
export type PublishResult = { kind: 'published'; published: Published } | { kind: 'refused'; failure: RequestFailure };

/** The form as the page opens. */
export const EMPTY_FORM: PublishForm = { message: '', subject: '', attributes: [], groupId: '', deduplicationId: '' };
