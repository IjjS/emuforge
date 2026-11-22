import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { createMemoryRouter, RouterProvider, useLocation } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import type { AreaConnection } from '../../../components/emulator-line';
import AwsArea from '../../../index';

const BUCKET = 'alpha';
const FOLDER = 'logs/';
const KEY = FOLDER + 'history.txt';
const PATH = '/aws/s3/buckets/alpha/objects?prefix=logs%2F';
const RESTORE = 'Restore version';
const REMOVE = 'Remove delete marker';
const RESTORED = 'Version restored.';
const REMOVED = 'Delete marker removed.';
const WARNING =
  'If versioning is suspended when you restore, the restored version replaces any existing null version of this key.';

function row(version: string, latest = false, kind = 'Version', key = KEY): string {
  return `<${kind}><Key>${key}</Key><VersionId>${version}</VersionId><IsLatest>${String(latest)}</IsLatest></${kind}>`;
}

function history(items: string, cursor?: [string, string]): Response {
  const markers =
    cursor === undefined
      ? ''
      : `<NextKeyMarker>${cursor[0]}</NextKeyMarker><NextVersionIdMarker>${cursor[1]}</NextVersionIdMarker>`;
  return new Response(
    `<ListVersionsResult><IsTruncated>${String(cursor !== undefined)}</IsTruncated>${markers}${items}</ListVersionsResult>`,
  );
}

function objects(keys: string[]): Response {
  return new Response(
    `<ListBucketResult>${keys.map((key) => `<Contents><Key>${key}</Key><Size>11</Size></Contents>`).join('')}</ListBucketResult>`,
  );
}

function refusal(status: number, code: string, message: string): Response {
  return new Response(`<Error><Code>${code}</Code><Message>${message}</Message></Error>`, { status });
}

function heldResponse() {
  let resolve: (value: Response) => void = () => undefined;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

type ReadList = (query: URLSearchParams) => Response | Promise<Response>;

class FakeEngine {
  status = 'Enabled';
  body = 'before change';
  hasCurrent = true;
  lists: URLSearchParams[] = [];
  histories: URLSearchParams[] = [];
  copies: (string | null)[] = [];
  markerDeletes: (string | null)[] = [];
  versionDownloads: string[] = [];
  reads: string[] = [];
  readCurrent: ReadList = () => objects(this.hasCurrent ? [KEY] : []);
  readHistory: ReadList = () => history(row('new', true) + row('old'));
  readStatus: () => Response | Promise<Response> = () =>
    new Response(`<VersioningConfiguration><Status>${this.status}</Status></VersioningConfiguration>`);
  writeCopy: () => Response | Promise<Response> = () =>
    new Response('<CopyObjectResult><ETag>copy</ETag></CopyObjectResult>');
  writeDelete: () => Response = () => new Response(null, { status: 204 });
  getVersion: () => Response = () => new Response('historical body', { headers: { 'content-type': 'text/plain' } });

  fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = input instanceof Request ? input : new Request(input.toString(), init);
    const url = new URL(request.url);
    const query = url.searchParams;
    if (url.pathname === '/__emuforge/session') return Response.json({ token: 'object-versions-test' });
    if (query.get('x-id') === 'ListBuckets') {
      return new Response(
        `<ListAllMyBucketsResult><Buckets><Bucket><Name>${BUCKET}</Name></Bucket></Buckets></ListAllMyBucketsResult>`,
      );
    }
    if (query.has('versions')) {
      this.histories.push(query);
      return this.readHistory(query);
    }
    if (query.has('list-type')) {
      this.lists.push(query);
      return this.readCurrent(query);
    }
    if (query.has('versioning')) return this.readStatus();
    if (decodeURIComponent(url.pathname) !== `/${BUCKET}/${KEY}`) {
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
    }
    if (request.method === 'PUT') {
      this.copies.push(request.headers.get('x-amz-copy-source'));
      return this.writeCopy();
    }
    const version = query.get('versionId');
    if (request.method === 'DELETE') {
      this.markerDeletes.push(version);
      return this.writeDelete();
    }
    if (request.method === 'HEAD') {
      this.reads.push('head');
      return this.hasCurrent
        ? new Response(null, { headers: { 'content-type': 'text/plain', 'content-length': String(this.body.length) } })
        : new Response(null, { status: 404 });
    }
    if (query.has('tagging')) {
      this.reads.push('tags');
      return new Response(`<Tagging><TagSet><Tag><Key>state</Key><Value>${this.body}</Value></Tag></TagSet></Tagging>`);
    }
    if (version !== null) {
      this.versionDownloads.push(version);
      return this.getVersion();
    }
    this.reads.push('body');
    return new Response(this.body, { headers: { 'content-type': 'text/plain' } });
  };
}

let engine: FakeEngine;
let connection: AreaConnection;
let nextPort = 8820;

function Area() {
  const { pathname } = useLocation();
  const [visit, setVisit] = useState({ pathname, changes: 0 });
  const changes = visit.pathname === pathname ? visit.changes : visit.changes + 1;
  if (visit.pathname !== pathname) setVisit({ pathname, changes });
  return (
    <AwsArea
      headerSelector="#top-bar"
      onPageTitle={() => undefined}
      onContentTarget={() => undefined}
      connection={connection}
      routeChanges={changes}
      targetGeneration={0}
    />
  );
}

function open() {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], { initialEntries: [PATH] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  engine = new FakeEngine();
  connection = {
    engineOrigin: engineEndpoint(++nextPort),
    result: { kind: 'connected', checkedAt: 0, emulator: { port: 9310, endpoint: 'https://127.0.0.1:9310' } },
  };
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function toggleVersions() {
  fireEvent.click(await screen.findByRole('checkbox', { name: 'Show versions' }));
}

async function select(id: string) {
  fireEvent.click(await screen.findByRole('radio', { name: `Select ${KEY} version ${id}` }));
}

function action(name: string) {
  return screen.getByRole('button', { name, exact: true });
}

async function confirmDialog(label: string) {
  fireEvent.click(action(label));
  const dialog = await screen.findByRole('dialog', { name: label });
  return {
    dialog,
    input: within(dialog).getByRole('textbox', { name: 'Enter the full key to confirm' }),
    confirm: within(dialog).getByRole('button', { name: label }),
  };
}

function enter(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function expectDisabled(button: HTMLElement) {
  expect(button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
}

async function expectVersion(id: string, kind: string, latest: boolean) {
  const radio = await screen.findByRole('radio', { name: `Select ${KEY} version ${id}` });
  const item = within(radio.closest('tr')!);
  expect(item.getByRole('rowheader', { name: KEY })).toBeVisible();
  expect(item.getByRole('cell', { name: id, exact: true })).toBeVisible();
  expect(item.getByRole('cell', { name: kind, exact: true })).toBeVisible();
  expect(item.getByRole('cell', { name: latest ? 'Yes' : 'No', exact: true })).toBeVisible();
}

function expectCursor(query: URLSearchParams | undefined, key: string | null, version: string | null) {
  expect(query?.get('prefix')).toBe(FOLDER);
  expect(query?.get('key-marker')).toBe(key);
  expect(query?.get('version-id-marker')).toBe(version);
}

it('shows loading until the history response and then the empty state', async () => {
  const response = heldResponse();
  engine.readHistory = () => response.promise;
  open();
  await toggleVersions();
  expect(screen.getByText('Loading versions')).toBeVisible();
  response.resolve(history(''));
  expect(await screen.findByText('No versions found')).toBeVisible();
});

it('selects a different ID of the same key on the next page and returns to the ordinary listing of the folder', async () => {
  engine.readHistory = (query) =>
    query.has('key-marker') ? history(row('v2')) : history(row('v1', true), [KEY, 'v1']);
  open();
  expect(await screen.findByRole('link', { name: 'history.txt' })).toBeVisible();
  await toggleVersions();
  await select('v1');
  fireEvent.click(action('Next page'));
  await select('v2');
  expect(screen.getByRole('radio', { name: `Select ${KEY} version v2` })).toBeChecked();
  expectCursor(engine.histories[1], KEY, 'v1');
  await toggleVersions();
  expect(screen.getByRole('link', { name: 'history.txt' })).toBeVisible();
  expect(engine.lists[0]?.get('prefix')).toBe(FOLDER);
});

it('shows a history refusal and retries the read', async () => {
  engine.readHistory = () => refusal(403, 'AccessDenied', 'Version history is forbidden');
  open();
  await toggleVersions();
  expect(await screen.findByText(/Version history is forbidden/)).toBeVisible();
  engine.readHistory = () => history(row('v1', true));
  fireEvent.click(action('Retry'));
  await expectVersion('v1', 'Version', true);
});

it('offers the appropriate actions by row type and saves no file when a download is refused', async () => {
  engine.readHistory = () => history(row('null') + row('marker', true, 'DeleteMarker'));
  engine.getVersion = () => refusal(404, 'NoSuchVersion', 'The specified version does not exist.');
  const save = vi.spyOn(URL, 'createObjectURL');
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click');
  open();
  await toggleVersions();
  await select('null');
  expect(action('Download')).toBeEnabled();
  expect(action(RESTORE)).toBeEnabled();
  expect(screen.queryByRole('button', { name: REMOVE })).toBeNull();
  fireEvent.click(action('Download'));
  expect(await screen.findByText('NoSuchVersion')).toBeVisible();
  expect(screen.getByText(/The specified version does not exist/)).toBeVisible();
  expect(engine.versionDownloads).toEqual(['null']);
  expect(save).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  await select('marker');
  expect(action(REMOVE)).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Download' })).toBeNull();
  expect(screen.queryByRole('button', { name: RESTORE })).toBeNull();
});

it('warns using Enabled even when the bucket is later suspended and writes once after exact confirmation', async () => {
  const copyResponse = heldResponse();
  engine.writeCopy = () => {
    engine.readHistory = () => history(row('null', true) + row('new') + row('old'));
    return copyResponse.promise;
  };
  open();
  await toggleVersions();
  await select('old');
  const { dialog, input, confirm } = await confirmDialog(RESTORE);
  expect(await within(dialog).findByText('Enabled')).toBeVisible();
  expect(within(dialog).getByText(KEY)).toBeVisible();
  expect(within(dialog).getByText('old')).toBeVisible();
  engine.status = 'Suspended';
  expect(within(dialog).getByText(WARNING)).toBeVisible();
  expectDisabled(confirm);
  fireEvent.click(confirm);
  enter(input, 'history.txt');
  expectDisabled(confirm);
  fireEvent.click(confirm);
  enter(input, KEY);
  expect(confirm).toBeEnabled();
  expect(engine.copies).toEqual([]);
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  await waitFor(() => expect(engine.copies).toEqual([`${BUCKET}/${KEY}?versionId=old`]));
  copyResponse.resolve(new Response('<CopyObjectResult><ETag>copy</ETag></CopyObjectResult>'));
  expect(await screen.findByText(RESTORED)).toBeVisible();
  await expectVersion('null', 'Version', true);
});

it('prevents a restore when reading versioning fails or the confirmation is canceled', async () => {
  engine.readStatus = () => refusal(403, 'AccessDenied', 'Versioning could not be read.');
  open();
  await toggleVersions();
  await select('old');
  const { dialog, input, confirm } = await confirmDialog(RESTORE);
  expect(await within(dialog).findByText(/Versioning could not be read/)).toBeVisible();
  enter(input, KEY);
  expectDisabled(confirm);
  fireEvent.click(confirm);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(engine.copies).toEqual([]);
});

it('retains the original latest row and shows the restore refusal', async () => {
  engine.writeCopy = () => refusal(403, 'AccessDenied', 'Restore was refused');
  open();
  await toggleVersions();
  await select('old');
  const { dialog, input, confirm } = await confirmDialog(RESTORE);
  await within(dialog).findByText('Enabled');
  enter(input, KEY);
  fireEvent.click(confirm);
  expect(await screen.findByText('AccessDenied')).toBeVisible();
  expect(screen.getByText(/Restore was refused/)).toBeVisible();
  await expectVersion('new', 'Version', true);
  expect(screen.queryByText(RESTORED)).toBeNull();
});

it('retains the marker and shows the marker removal refusal', async () => {
  engine.readHistory = () => history(row('marker', true, 'DeleteMarker'));
  engine.writeDelete = () => refusal(403, 'AccessDenied', 'Marker removal was refused');
  open();
  await toggleVersions();
  await select('marker');
  const { dialog, input, confirm } = await confirmDialog(REMOVE);
  expect(within(dialog).getByText(KEY)).toBeVisible();
  expect(within(dialog).getByText('marker')).toBeVisible();
  enter(input, KEY);
  fireEvent.click(confirm);
  expect(await screen.findByText('AccessDenied')).toBeVisible();
  expect(screen.getByText(/Marker removal was refused/)).toBeVisible();
  expect(engine.markerDeletes).toEqual(['marker']);
  await expectVersion('marker', 'Delete marker', true);
  expect(screen.queryByText(REMOVED)).toBeNull();
});

it('shows the area state for an unimplemented history read', async () => {
  engine.readHistory = () => refusal(501, 'NotImplemented', 'Version history is unavailable');
  open();
  await toggleVersions();
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/501 Not Implemented for ListObjectVersions/)).toBeVisible();
});

async function expectCurrentDetails(body: string) {
  fireEvent.click(await screen.findByRole('link', { name: 'history.txt' }));
  expect(await screen.findByRole('region', { name: 'Object preview' })).toHaveTextContent(body);
  expect(screen.getByRole('heading', { level: 1, name: KEY })).toBeVisible();
  await waitFor(() => expect(engine.reads).toEqual(expect.arrayContaining(['head', 'tags', 'body'])));
}

it('restores from page two and shows refreshed history and current reads when the ordinary list answers first', async () => {
  const router = open();
  await expectCurrentDetails('before change');
  await act(async () => router.navigate(PATH));
  await screen.findByRole('link', { name: 'history.txt' });
  await toggleVersionsForRestore();

  const refreshedHistory = heldResponse();
  const refreshedObjects = heldResponse();
  engine.writeCopy = () => {
    engine.body = 'restored body';
    engine.readCurrent = () => refreshedObjects.promise;
    engine.readHistory = () => refreshedHistory.promise;
    return new Response('<CopyObjectResult><ETag>copy</ETag></CopyObjectResult>');
  };
  const { dialog, input, confirm } = await confirmDialog(RESTORE);
  await within(dialog).findByText('Enabled');
  enter(input, KEY);
  const listsBefore = engine.lists.length;
  fireEvent.click(confirm);
  await waitFor(() => expect(engine.lists).toHaveLength(listsBefore + 1));
  await waitFor(() => expect(engine.histories).toHaveLength(3));
  expect(engine.lists.at(-1)?.get('prefix')).toBe(FOLDER);
  expect(engine.lists.at(-1)?.get('continuation-token')).toBeNull();
  expectCursor(engine.histories[2], null, null);
  await act(async () => refreshedObjects.resolve(objects([KEY])));
  expect(screen.getByText('Loading versions')).toBeVisible();
  refreshedHistory.resolve(history(row('restored', true) + row('new') + row('null')));
  await expectVersion('restored', 'Version', true);
  expect(screen.getByText(RESTORED)).toBeVisible();
  expect(engine.copies).toEqual([`${BUCKET}/${KEY}?versionId=null`]);
  await toggleVersions();
  engine.reads = [];
  await expectCurrentDetails('restored body');
});

async function toggleVersionsForRestore() {
  engine.readHistory = (query) =>
    query.has('key-marker') ? history(row('null')) : history(row('new', true), [KEY, 'new']);
  await toggleVersions();
  await expectVersion('new', 'Version', true);
  fireEvent.click(action('Next page'));
  await select('null');
}

it('removes a marker from page two and uses the new cursor when history answers first', async () => {
  engine.hasCurrent = false;
  engine.readHistory = (query) =>
    query.has('key-marker')
      ? history(row('marker', true, 'DeleteMarker'))
      : history(row('archived'), [KEY, 'archived']);
  open();
  await screen.findByText('No objects');
  await toggleVersions();
  await expectVersion('archived', 'Version', false);
  fireEvent.click(action('Next page'));
  await select('marker');

  const refreshedObjects = heldResponse();
  engine.writeDelete = () => {
    engine.hasCurrent = true;
    engine.body = 'revealed body';
    engine.readCurrent = () => refreshedObjects.promise;
    engine.readHistory = (query) =>
      query.has('key-marker')
        ? history(row('previous', true))
        : history(row('current-cursor'), [KEY, 'current-cursor']);
    return new Response(null, { status: 204 });
  };
  const { input, confirm } = await confirmDialog(REMOVE);
  enter(input, KEY);
  fireEvent.click(confirm);
  await expectVersion('current-cursor', 'Version', false);
  expectCursor(engine.histories[2], null, null);
  await waitFor(() => expect(engine.lists).toHaveLength(2));
  expect(engine.lists[1]?.get('prefix')).toBe(FOLDER);
  expect(engine.lists[1]?.get('continuation-token')).toBeNull();
  refreshedObjects.resolve(objects([KEY]));
  expect(screen.getByText(REMOVED)).toBeVisible();
  fireEvent.click(action('Next page'));
  await expectVersion('previous', 'Version', true);
  expectCursor(engine.histories[3], KEY, 'current-cursor');
  expect(screen.queryByRole('radio', { name: `Select ${KEY} version marker` })).toBeNull();
  expect(screen.getByText(REMOVED)).toBeVisible();
  expect(engine.markerDeletes).toEqual(['marker']);
  await toggleVersions();
  await expectCurrentDetails('revealed body');
});
