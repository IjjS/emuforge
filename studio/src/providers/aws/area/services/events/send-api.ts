import { PutEventsCommand, type PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

import { RequestError } from '../../../../../lib/aws/request';
import { sendEvents } from './clients';

export const PUT_EVENTS = 'PutEvents';

export type SendOutcome = { kind: 'accepted'; id: string } | { kind: 'refused'; code: string; message?: string };

export async function putEvent(
  endpoint: string,
  entry: PutEventsRequestEntry,
  signal: AbortSignal,
): Promise<SendOutcome> {
  const answer = await sendEvents(
    endpoint,
    PUT_EVENTS,
    (client, abortSignal) => client.send(new PutEventsCommand({ Entries: [entry] }), { abortSignal }),
    signal,
  );
  const result = answer.Entries?.[0];
  if (answer.FailedEntryCount || result?.ErrorCode !== undefined) {
    return {
      kind: 'refused',
      code: result?.ErrorCode ?? 'Failed entry',
      ...(result?.ErrorMessage === undefined ? {} : { message: result.ErrorMessage }),
    };
  }
  if (!result?.EventId) {
    throw new RequestError({
      kind: 'other',
      operation: PUT_EVENTS,
      code: 'Missing event ID',
      message: 'The emulator did not return an event ID.',
    });
  }
  return { kind: 'accepted', id: result.EventId };
}
