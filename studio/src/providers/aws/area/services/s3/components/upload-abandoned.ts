import type { AbandonedUpload } from '../upload';

// The multipart uploads the Upload page left unfinished because their `AbortMultipartUpload` failed (issue 480,
// task 3). Such an abort may end after the page is gone, so what it found is held here, outside the page, until the
// page of S3 shown then takes it to the area's flash (`upload-abandoned-flash.tsx`).

type Listener = (upload: AbandonedUpload) => void;

const waiting: AbandonedUpload[] = [];
const listeners: Listener[] = [];

/** Says that `upload` could not be aborted: to the page of S3 shown, or to the next one that opens. */
export function reportAbandoned(upload: AbandonedUpload): void {
  const listener = listeners[listeners.length - 1];
  if (listener === undefined) {
    waiting.push(upload);
  } else {
    listener(upload);
  }
}

/** Listens for uploads that could not be aborted, first given those that waited; returns the end of listening. */
export function listenForAbandoned(listener: Listener): () => void {
  listeners.push(listener);
  for (const upload of waiting.splice(0)) {
    listener(upload);
  }
  return () => {
    const index = listeners.lastIndexOf(listener);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  };
}
