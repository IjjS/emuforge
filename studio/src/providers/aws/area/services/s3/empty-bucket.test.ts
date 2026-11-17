import { describe, expect, it } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../lib/aws/request';
import {
  NO_SUCH_BUCKET,
  type DeleteObjectsResult,
  type NoSuchBucket,
  type ObjectVersionId,
  type ObjectVersionPage,
  type ObjectVersionPageRequest,
} from './api';
import { emptyBucket, type EmptyingOperations } from './empty-bucket';

// The test gives the emptying its two operations and answers each call from a script, in the order they are made.

type Call =
  | { operation: 'list'; request: ObjectVersionPageRequest; signal: AbortSignal }
  | { operation: 'delete'; items: ObjectVersionId[]; signal: AbortSignal };

type ListAnswer = ObjectVersionPage | NoSuchBucket | RequestError;
type DeleteAnswer = DeleteObjectsResult | NoSuchBucket | RequestError;

class Script implements EmptyingOperations {
  readonly calls: Call[] = [];
  constructor(
    private readonly lists: ((request: ObjectVersionPageRequest) => ListAnswer)[],
    private readonly deletes: ((items: readonly ObjectVersionId[]) => DeleteAnswer)[] = [],
  ) {}

  readonly listVersions = (request: ObjectVersionPageRequest, signal: AbortSignal) => {
    this.calls.push({ operation: 'list', request, signal });
    const next = this.lists.shift();
    if (next === undefined) {
      throw new Error('a listing the script did not expect');
    }
    const answer = next(request);
    return answer instanceof RequestError ? Promise.reject(answer) : Promise.resolve(answer);
  };

  readonly deleteVersions = (items: readonly ObjectVersionId[], signal: AbortSignal) => {
    this.calls.push({ operation: 'delete', items: [...items], signal });
    const next = this.deletes.shift();
    if (next === undefined) {
      throw new Error('a delete the script did not expect');
    }
    const answer = next(items);
    return answer instanceof RequestError ? Promise.reject(answer) : Promise.resolve(answer);
  };

  get deleteCalls(): ObjectVersionId[][] {
    return this.calls.flatMap((call) => (call.operation === 'delete' ? [call.items] : []));
  }

  get listRequests(): ObjectVersionPageRequest[] {
    return this.calls.flatMap((call) => (call.operation === 'list' ? [call.request] : []));
  }
}

function page(items: ObjectVersionId[], more?: { key: string; version: string }): ObjectVersionPage {
  return more === undefined
    ? { items, truncated: false }
    : { items, truncated: true, nextKeyMarker: more.key, nextVersionIdMarker: more.version };
}

const empty = () => page([]);
const deletedAll = (): DeleteObjectsResult => ({ errors: [] });

function versions(count: number, from = 0): ObjectVersionId[] {
  return Array.from({ length: count }, (_, index) => ({
    key: `k-${String(from + index)}`,
    versionId: `v-${String(from + index)}`,
  }));
}

function failure(kind: RequestFailure): RequestError {
  return new RequestError(kind);
}

const run = (script: Script, signal = new AbortController().signal, options = {}) =>
  emptyBucket(script, signal, options);

describe('the emptying', () => {
  it('deletes a page of three versions in one quiet request with their version ids, then lists from the start and finishes', async () => {
    const three = versions(3);
    const script = new Script([() => page(three), empty], [deletedAll]);

    const result = await run(script);

    expect(script.deleteCalls).toEqual([three]);
    expect(script.listRequests).toEqual([{ maxKeys: 1000 }, { maxKeys: 1000 }]);
    expect(result).toEqual({ outcome: 'finished', deleted: 3, failures: [] });
  });

  it('sends every key of an unversioned bucket with the version id null', async () => {
    const plain = [
      { key: 'a b', versionId: 'null' },
      { key: '버킷', versionId: 'null' },
    ];
    const script = new Script([() => page(plain), empty], [deletedAll]);

    await run(script);

    expect(script.deleteCalls[0]).toEqual(plain);
  });

  it('sends versions and delete markers of one page in one request', async () => {
    const mixed = [
      { key: 'kept', versionId: 'v1' },
      { key: 'gone', versionId: 'marker-1' },
    ];
    const script = new Script([() => page(mixed), empty], [deletedAll]);

    const result = await run(script);

    expect(script.deleteCalls).toEqual([mixed]);
    expect(result.deleted).toBe(2);
  });

  it('sends no delete request for an empty bucket and finishes with 0 deleted', async () => {
    const script = new Script([empty]);

    expect(await run(script)).toEqual({ outcome: 'finished', deleted: 0, failures: [] });
    expect(script.deleteCalls).toEqual([]);
  });

  it('records an error for one key and version as failed, counts the others as deleted, and does not send it again', async () => {
    const [a, held, c] = versions(3) as [ObjectVersionId, ObjectVersionId, ObjectVersionId];
    const error = { ...held, code: 'AccessDenied', message: 'Access Denied because object protected by object lock.' };
    const extra = { key: 'stored-meanwhile', versionId: 'v9' };
    const script = new Script(
      [() => page([a, held, c]), () => page([held, extra]), () => page([held])],
      [() => ({ errors: [error] }), deletedAll],
    );

    const result = await run(script);

    expect(script.deleteCalls).toEqual([[a, held, c], [extra]]);
    expect(result).toEqual({ outcome: 'finished', deleted: 3, failures: [error] });
  });

  it('matches an error without a version id to the sent item of its key, which is then not counted and not sent again', async () => {
    const [a, held] = versions(2) as [ObjectVersionId, ObjectVersionId];
    const script = new Script(
      [() => page([a, held]), () => page([held])],
      [() => ({ errors: [{ key: held.key, code: 'AccessDenied', message: 'held' }] })],
    );

    const result = await run(script);

    expect(script.deleteCalls).toEqual([[a, held]]);
    expect(result).toEqual({
      outcome: 'finished',
      deleted: 1,
      failures: [{ ...held, code: 'AccessDenied', message: 'held' }],
    });
  });

  it('records an error of a key the request did not send as it came, and counts every sent item as deleted', async () => {
    const [a] = versions(1) as [ObjectVersionId];
    const stray = { key: 'not-sent', versionId: 'v-x', code: 'InternalError', message: 'odd' };
    const script = new Script([() => page([a]), empty], [() => ({ errors: [stray] })]);

    expect(await run(script)).toEqual({ outcome: 'finished', deleted: 1, failures: [stray] });
  });

  it('finishes when every version left has failed and the listing is not truncated, never sending an empty delete', async () => {
    const [held] = versions(1) as [ObjectVersionId];
    const error = { ...held, code: 'AccessDenied', message: 'held' };
    const script = new Script([() => page([held]), () => page([held])], [() => ({ errors: [error] })]);

    const result = await run(script);

    expect(script.deleteCalls).toEqual([[held]]);
    expect(script.deleteCalls.every((items) => items.length > 0)).toBe(true);
    expect(result).toEqual({ outcome: 'finished', deleted: 0, failures: [error] });
  });

  it('asks the next page with the markers of a truncated page that holds only failed versions, and deletes what it returns', async () => {
    const [held] = versions(1) as [ObjectVersionId];
    const error = { ...held, code: 'AccessDenied', message: 'held' };
    const after = versions(2, 10);
    const script = new Script(
      [
        () => page([held], { key: 'k-a', version: 'v-a' }),
        () => page([held], { key: 'k-0', version: 'v-0' }),
        () => page(after),
        () => page([held], { key: 'k-0', version: 'v-0' }),
        empty,
      ],
      [() => ({ errors: [error] }), deletedAll],
    );

    const result = await run(script);

    expect(script.listRequests).toEqual([
      { maxKeys: 1000 },
      { maxKeys: 1000 },
      { maxKeys: 1000, keyMarker: 'k-0', versionIdMarker: 'v-0' },
      { maxKeys: 1000 },
      { maxKeys: 1000, keyMarker: 'k-0', versionIdMarker: 'v-0' },
    ]);
    expect(script.deleteCalls).toEqual([[held], after]);
    expect(result).toEqual({ outcome: 'finished', deleted: 2, failures: [error] });
  });

  it('asks the listing after a delete from the start, never with a marker', async () => {
    const script = new Script(
      [() => page(versions(2), { key: 'k-1', version: 'v-1' }), () => page(versions(1, 5)), empty],
      [deletedAll, deletedAll],
    );

    await run(script);

    expect(script.listRequests).toEqual([{ maxKeys: 1000 }, { maxKeys: 1000 }, { maxKeys: 1000 }]);
  });

  it('deletes a listing of 1000 in one request of 1000 keys and never sends more than 1000', async () => {
    const thousand = versions(1000);
    const script = new Script([() => page(thousand), empty], [deletedAll]);

    const result = await run(script);

    expect(script.deleteCalls).toHaveLength(1);
    expect(script.deleteCalls[0]).toHaveLength(1000);
    expect(script.deleteCalls.every((items) => items.length <= 1000)).toBe(true);
    expect(result.deleted).toBe(1000);
  });

  it('stops with the failure of a listing and the counts so far; started again it lists from the start and keeps them', async () => {
    const [held, other] = versions(2) as [ObjectVersionId, ObjectVersionId];
    const error = { ...held, code: 'AccessDenied', message: 'held' };
    const listFailure: RequestFailure = { kind: 'other', operation: 'ListObjectVersions', code: 'InternalError' };
    const first = new Script([() => page([held, other]), () => failure(listFailure)], [() => ({ errors: [error] })]);

    const stopped = await run(first);

    expect(stopped).toEqual({ outcome: 'failed', failure: listFailure, deleted: 1, failures: [error] });

    const more = versions(2, 20);
    const again = new Script([() => page([held, ...more]), () => page([held])], [deletedAll]);
    const result = await run(again, new AbortController().signal, { from: stopped });

    expect(again.listRequests[0]).toEqual({ maxKeys: 1000 });
    expect(again.deleteCalls).toEqual([more]);
    expect(result).toEqual({ outcome: 'finished', deleted: 3, failures: [error] });
  });

  it('stops with the failure of a delete, and nothing of that request counts as deleted', async () => {
    const deleteFailure: RequestFailure = { kind: 'engine-did-not-answer', operation: 'DeleteObjects' };
    const script = new Script([() => page(versions(3))], [() => failure(deleteFailure)]);

    expect(await run(script)).toEqual({ outcome: 'failed', failure: deleteFailure, deleted: 0, failures: [] });
  });

  it('sends no further request once stopped by its signal between two requests, and is neither finished nor failed', async () => {
    const controller = new AbortController();
    const script = new Script([
      () => {
        controller.abort(new Error('the page was left'));
        return page(versions(3));
      },
    ]);

    const result = await run(script, controller.signal);

    expect(script.calls).toHaveLength(1);
    expect(result).toEqual({ outcome: 'stopped', deleted: 0, failures: [] });
  });

  it('passes its signal to every request', async () => {
    const controller = new AbortController();
    const script = new Script([() => page(versions(1)), empty], [deletedAll]);

    await run(script, controller.signal);

    expect(script.calls.map((call) => call.signal)).toEqual([controller.signal, controller.signal, controller.signal]);
  });

  it('sends nothing for a signal aborted before it starts', async () => {
    const controller = new AbortController();
    controller.abort(new Error('gone'));
    const script = new Script([]);

    expect(await run(script, controller.signal)).toEqual({ outcome: 'stopped', deleted: 0, failures: [] });
    expect(script.calls).toEqual([]);
  });

  it('reports a listing answered "no such bucket" as a missing bucket, not as a failure', async () => {
    const script = new Script([() => page(versions(2)), () => NO_SUCH_BUCKET], [deletedAll]);

    expect(await run(script)).toEqual({ outcome: 'no-such-bucket', deleted: 2, failures: [] });
  });

  it('tells the counts after each delete', async () => {
    const seen: number[] = [];
    const script = new Script([() => page(versions(2)), () => page(versions(1, 5)), empty], [deletedAll, deletedAll]);

    await run(script, new AbortController().signal, {
      onProgress: ({ deleted }: { deleted: number }) => {
        seen.push(deleted);
      },
    });

    expect(seen).toEqual([2, 3]);
  });
});
