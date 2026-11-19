import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import type { UploadedPart } from './api';

// The put of one file on the Upload page (issue 480, task 3), as logic apart from the page: up to 8 MiB one
// `PutObject`; above it a multipart upload in parts of 8 MiB, one part at a time, aborted when a step after its
// creation fails or the page's signal aborts. The abort of an upload the page leaves behind is sent with a signal of its
// own, so it is still sent, and still ends, once the page is gone; a failed abort is said by the area's flash
// (`components/upload-abandoned.tsx`), on whichever page of S3 is shown then.

/** The size of every part but the last, and the most a file put in one `PutObject` holds: 8 MiB. */
export const PART_SIZE = 8 * 1024 * 1024;

/** The type a file is put with when the browser gives it none. */
export const DEFAULT_TYPE = 'binary/octet-stream';

/** The calls a put makes, on one bucket. */
export interface UploadOperations {
  putObject: (key: string, body: Uint8Array, contentType: string, signal: AbortSignal) => Promise<void>;
  createMultipartUpload: (key: string, contentType: string, signal: AbortSignal) => Promise<string>;
  uploadPart: (
    key: string,
    uploadId: string,
    partNumber: number,
    body: Uint8Array,
    signal: AbortSignal,
  ) => Promise<UploadedPart>;
  completeMultipartUpload: (
    key: string,
    uploadId: string,
    parts: readonly UploadedPart[],
    signal: AbortSignal,
  ) => Promise<void>;
  abortMultipartUpload: (key: string, uploadId: string, signal: AbortSignal) => Promise<void>;
}

/** A multipart upload whose `AbortMultipartUpload` failed: it stays in the emulator, unfinished. */
export interface AbandonedUpload {
  key: string;
  uploadId: string;
  failure: RequestFailure;
}

/** What a put did: put, or failed with the call that failed. A put the page's signal stopped rejects instead. */
export type PutResult = { ok: true } | { ok: false; failure: RequestFailure };

/** The number of parts a file of `size` bytes is put in: ⌈size / 8 MiB⌉. */
export function partCount(size: number): number {
  return Math.ceil(size / PART_SIZE);
}

/** The type a file is put with: the browser's, or `binary/octet-stream` when it gives none. */
export function fileType(file: Blob): string {
  return file.type === '' ? DEFAULT_TYPE : file.type;
}

function failureOf(error: unknown, operation: string): RequestFailure {
  return error instanceof RequestError ? error.failure : { kind: 'other', operation, code: String(error) };
}

/** The bytes of `blob`, read before the call that sends them. */
async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

interface PutOptions {
  operations: UploadOperations;
  /** The page's signal: it ends the request in flight; nothing further is sent after it aborts. */
  signal: AbortSignal;
  /** Called after each part of a multipart upload: the parts put, of all. */
  onPart?: (done: number, total: number) => void;
  /** Called when the abort of an upload left behind failed. */
  onAbandoned: (upload: AbandonedUpload) => void;
}

/**
 * Puts `file` under `key`. Resolves with what the emulator answered; rejects with the signal's reason once the signal
 * has aborted, after the abort of a multipart upload in flight was sent (with a signal of its own).
 */
export async function putFile(key: string, file: Blob, options: PutOptions): Promise<PutResult> {
  const { operations, signal } = options;
  const type = fileType(file);
  if (file.size <= PART_SIZE) {
    try {
      await operations.putObject(key, await bytesOf(file), type, signal);
      return { ok: true };
    } catch (error) {
      signal.throwIfAborted();
      return { ok: false, failure: failureOf(error, 'PutObject') };
    }
  }

  let uploadId: string;
  try {
    uploadId = await operations.createMultipartUpload(key, type, signal);
  } catch (error) {
    signal.throwIfAborted();
    return { ok: false, failure: failureOf(error, 'CreateMultipartUpload') };
  }

  // The upload is the emulator's from here: any end but completion aborts it.
  const abandon = () => {
    const own = new AbortController();
    operations.abortMultipartUpload(key, uploadId, own.signal).catch((error: unknown) => {
      options.onAbandoned({ key, uploadId, failure: failureOf(error, 'AbortMultipartUpload') });
    });
  };

  const total = partCount(file.size);
  const parts: UploadedPart[] = [];
  let operation = 'UploadPart';
  try {
    for (let number = 1; number <= total; number += 1) {
      signal.throwIfAborted();
      const start = (number - 1) * PART_SIZE;
      const body = await bytesOf(file.slice(start, Math.min(start + PART_SIZE, file.size)));
      parts.push(await operations.uploadPart(key, uploadId, number, body, signal));
      options.onPart?.(number, total);
    }
    signal.throwIfAborted();
    operation = 'CompleteMultipartUpload';
    await operations.completeMultipartUpload(key, uploadId, parts, signal);
    return { ok: true };
  } catch (error) {
    abandon();
    signal.throwIfAborted();
    return { ok: false, failure: failureOf(error, operation) };
  }
}

/** "Uploaded 1 of 2 files." */
export function uploadedText(uploaded: number, files: number): string {
  return `Uploaded ${String(uploaded)} of ${String(files)} file${files === 1 ? '' : 's'}.`;
}

/** "Failed: {message}" of a failed put: the emulator's message, else its code or status line. */
export function failedText(failure: RequestFailure, engineOrigin: string | undefined): string {
  switch (failure.kind) {
    case 'not-implemented':
      return `Not implemented by the emulator: ${failure.operation}`;
    case 'access-denied':
    case 'emulator-did-not-answer':
      return `Failed: ${failure.message === '' ? failure.operation : failure.message}`;
    case 'engine-did-not-answer':
      return `Failed: The EmuForge engine at ${engineOrigin ?? ''} did not answer`;
    case 'other':
      return `Failed: ${failure.message ?? failure.code}`;
  }
}
