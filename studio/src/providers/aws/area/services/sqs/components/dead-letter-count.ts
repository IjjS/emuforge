import { getQueueAttributes, getQueueUrl, NO_SUCH_QUEUE } from '../api';
import { queueSettings } from '../format';

// The dead-letter queue's count around a read of a queue with a redrive policy (issue 481, requirement "An empty
// read", pm decision 2026-11-19): `ApproximateNumberOfMessages`, read just before and just after the read, tells a
// move by the read apart from messages another consumer took. The queue is named by the URL the emulator gives for
// its name, never by one built here.

/** The queue named `name`'s URL as the emulator gives it; `undefined` when it holds none or the read failed. */
export async function deadLetterUrl(endpoint: string, name: string, signal: AbortSignal): Promise<string | undefined> {
  try {
    const url = await getQueueUrl(endpoint, name, signal);
    return url === NO_SUCH_QUEUE ? undefined : url;
  } catch {
    return undefined;
  }
}

/** The `ApproximateNumberOfMessages` of the queue at `url`; `undefined` when it is not known. */
export async function availableAt(endpoint: string, url: string, signal: AbortSignal): Promise<number | undefined> {
  try {
    const attributes = await getQueueAttributes(endpoint, url, signal);
    return attributes === NO_SUCH_QUEUE ? undefined : queueSettings(attributes).available;
  } catch {
    return undefined;
  }
}
