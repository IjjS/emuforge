import createWrapper, { type ElementWrapper } from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
const NULL_ETAG = '"observed-null-body"';
const CHANGED_BODY = 'The null version points to a different body than the one you selected.';
const RESELECT = 'Refresh the version history and reselect the version.';
const WARNING =
  'If versioning is suspended when you restore, the restored version replaces any existing null version of this key.';

function encodedKey(key: string): string {
  return encodeURIComponent(key).replaceAll('%2F', '/').replaceAll('%20', '+');
}

function row(
  version: string,
  latest = false,
  kind = 'Version',
  key = KEY,
  etag = kind === 'Version' && version === 'null' ? NULL_ETAG : undefined,
): string {
  const tag = etag === undefined ? '' : `<ETag>${etag}</ETag>`;
  return `<${kind}><Key>${encodedKey(key)}</Key><VersionId>${version}</VersionId><IsLatest>${String(latest)}</IsLatest>${tag}</${kind}>`;
}

function history(items: string, cursor?: [string, string]): Response {
  const markers =
    cursor === undefined
      ? ''
      : `<NextKeyMarker>${encodedKey(cursor[0])}</NextKeyMarker><NextVersionIdMarker>${cursor[1]}</NextVersionIdMarker>`;
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
  objectKey = KEY;
  destinations: string[] = [];
  status = 'Enabled';
  body = 'before change';
  hasCurrent = true;
  lists: URLSearchParams[] = [];
  histories: URLSearchParams[] = [];
  copies: (string | null)[] = [];
  copyConditions: (string | null)[] = [];
  markerDeletes: (string | null)[] = [];
  versionDownloads: string[] = [];
  downloadConditions: (string | null)[] = [];
  reads: string[] = [];
  readCurrent: ReadList = () => objects(this.hasCurrent ? [KEY] : []);
  readHistory: ReadList = () => history(row('new', true) + row('old'));
  readStatus: () => Response | Promise<Response> = () =>
    new Response(`<VersioningConfiguration><Status>${this.status}</Status></VersioningConfiguration>`);
  writeCopy: (condition: string | null) => Response | Promise<Response> = () =>
    new Response('<CopyObjectResult><ETag>copy</ETag></CopyObjectResult>');
  writeDelete: () => Response = () => new Response(null, { status: 204 });
  getVersion: (condition: string | null) => Response = () =>
    new Response('historical body', { headers: { 'content-type': 'text/plain' } });

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
    if (decodeURIComponent(url.pathname) !== `/${BUCKET}/${this.objectKey}`) {
      throw new Error(`Unexpected request ${request.method} ${url.pathname}`);
    }
    if (request.method === 'PUT') {
      this.destinations.push(decodeURIComponent(url.pathname));
      this.copies.push(request.headers.get('x-amz-copy-source'));
      const condition = request.headers.get('x-amz-copy-source-if-match');
      this.copyConditions.push(condition);
      return this.writeCopy(condition);
    }
    const version = query.get('versionId');
    if (request.method === 'DELETE') {
      this.destinations.push(decodeURIComponent(url.pathname));
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
      const condition = request.headers.get('if-match');
      this.downloadConditions.push(condition);
      return this.getVersion(condition);
    }
    this.reads.push('body');
    return new Response(this.body, { headers: { 'content-type': 'text/plain' } });
  };
}

let engine: FakeEngine;
let client: QueryClient;
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

function open(initialPath = PATH) {
  const router = createMemoryRouter([{ path: '/aws/*', element: <Area /> }], { initialEntries: [initialPath] });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
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

function required<T>(item: T | null | undefined): T {
  if (item === null || item === undefined) throw new Error('Expected a Cloudscape element');
  return item;
}

function main() {
  return createWrapper(screen.getByRole('main'));
}

function table() {
  return required(main().findTable());
}

async function toggleVersions() {
  const toggle = await waitFor(() => required(main().findToggle()));
  expect(toggle.findLabel().getElement()).toHaveTextContent('Show versions');
  fireEvent.click(toggle.findNativeInput().getElement());
}

function selection(id: string, etag?: string) {
  const list = main().findTable();
  for (let index = 1; index <= (list?.findRows().length ?? 0); index += 1) {
    const versionNames =
      list?.findBodyCell(index, 3)?.findAll('.aws-area-value-name') ??
      list?.findBodyCell(index, 2)?.findAll('.aws-area-value-name').slice(1);
    const [version, tag] = versionNames ?? [];
    if (version?.getElement().textContent === id && (etag === undefined || tag?.getElement().textContent === etag)) {
      const control = list?.findRowSelectionArea(index)?.find('input[type="radio"]')?.getElement();
      if (control !== undefined) return { control, index };
    }
  }
  return undefined;
}

async function select(id: string, etag?: string) {
  fireEvent.click((await waitFor(() => required(selection(id, etag)))).control);
}

function findButton(scope: ElementWrapper, label: string) {
  return scope.findAllButtons().find((button) => button.findTextRegion()?.getElement().textContent === label);
}

function historyButton(name: string) {
  return findButton(required(table().findHeaderSlot()), name);
}

function action(name: string) {
  if (name === 'Next page') return required(table().findPagination()).findNextPageButton().getElement();
  if (name === 'Retry') return required(findButton(required(table().findEmptySlot()), name)).getElement();
  return required(historyButton(name)).getElement();
}

async function confirmDialog(label: string) {
  action(label).focus();
  fireEvent.click(action(label));
  const dialog = await waitFor(() => required(createWrapper().findModal()));
  expect(dialog.findHeader().getElement()).toHaveTextContent(label);
  const content = dialog.findContent();
  const field = required(content.findFormField());
  expect(field.findLabel()?.getElement()).toHaveTextContent('Enter the full key to confirm');
  const input = required(field.findControl()?.findTextarea()).findNativeTextarea().getElement();
  const footer = required(dialog.findFooter());
  const confirm = required(findButton(footer, label)).getElement();
  return { content, footer, input, confirm };
}

function dialogValue(content: ElementWrapper, label: string) {
  const pair = content
    .findKeyValuePairs()
    ?.findItems()
    .find((item) => item.findLabel()?.getElement().textContent === label);
  return required(pair?.findValue()).getElement();
}

function flashContent(type: 'success' | 'error') {
  return main().findFlashbar()?.findItemsByType(type)[0]?.findContent()?.getElement();
}

function enter(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
}

function expectDisabled(button: HTMLElement) {
  expect(button.matches(':disabled') || button.getAttribute('aria-disabled') === 'true').toBe(true);
}

async function expectVersion(id: string, kind: string, latest: boolean) {
  const { control, index } = await waitFor(() => required(selection(id)));
  const latestText = latest ? 'Yes' : 'No';
  expect(control).toHaveAccessibleName(`Select ${KEY} version ${id}, Type: ${kind}, Latest: ${latestText}`);
  [KEY, id, kind, latestText].forEach((text, column) => {
    expect(
      table()
        .findBodyCell(index, column + 2)
        ?.getElement(),
    ).toHaveTextContent(text);
  });
}

async function currentObjectLink() {
  return waitFor(() => required(table().findBodyCell(1, 2)?.findLink()).getElement());
}

async function ordinaryReadSettled() {
  await waitFor(() => expect(client.isFetching({ queryKey: ['aws', 's3', 'objects', BUCKET] })).toBe(0));
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
  expect(table().findLoadingText()?.getElement()).toHaveTextContent('Loading versions');
  response.resolve(history(''));
  await waitFor(() => expect(table().findEmptySlot()?.getElement()).toHaveTextContent('No versions found'));
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent(
    'This listing covers keys that start with logs/ in bucket alpha.',
  );
});

it('shows the type, latest state and full ID with the key at narrow widths', async () => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: media === '(max-width: 688px)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const id = '1234567890abcdef1234567890abcdef';
  engine.readHistory = () => history(row(id, true, 'DeleteMarker'));
  open();
  await toggleVersions();
  const { control, index } = await waitFor(() => required(selection(id)));
  expect(control).toHaveAccessibleName(`Select ${KEY} version ${id}, Type: Delete marker, Latest: Yes`);
  const keyCell = required(table().findBodyCell(index, 2)).getElement();
  expect(keyCell).toHaveTextContent(KEY);
  expect(keyCell).toHaveTextContent('Type: Delete marker · Latest: Yes');
  expect(keyCell).toHaveTextContent(id);
});

it.each([
  { layout: 'desktop', narrow: false },
  { layout: 'mobile', narrow: true },
])('preserves native key selection and distinguishes history keys in the $layout layout', async ({ narrow }) => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: narrow && media === '(max-width: 688px)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const keys = [
    {
      id: 'cr',
      key: 'logs/line\rbreak.csv',
      indicator: 'CR at character 10',
      cellCue: 'Carriage return at character 10',
      spoken: 'logs/line \\r (carriage return) break.csv',
    },
    {
      id: 'lf',
      key: 'logs/line\nbreak.csv',
      indicator: 'LF at character 10',
      cellCue: 'Line feed at character 10',
      spoken: 'logs/line \\n (line feed) break.csv',
    },
    { id: 'space', key: 'logs/line break.csv', spoken: 'logs/line break.csv' },
    {
      id: 'percent-cr',
      key: 'logs/line%0Dbreak.csv',
      spoken: 'logs/line%0Dbreak.csv',
    },
    {
      id: 'percent-lf',
      key: 'logs/line%0Abreak.csv',
      spoken: 'logs/line%0Abreak.csv',
    },
    {
      id: 'literal-r',
      key: 'logs/line\\rbreak.csv',
      spoken: 'logs/line \\\\ (literal backslash) rbreak.csv',
    },
    {
      id: 'literal-n',
      key: 'logs/line\\nbreak.csv',
      spoken: 'logs/line \\\\ (literal backslash) nbreak.csv',
    },
    {
      id: 'literal-label',
      key: 'logs/line (carriage return) break.csv',
      spoken: 'logs/line (carriage return) break.csv',
    },
  ];
  engine.readHistory = () => history(keys.map(({ id, key }) => row(id, false, 'Version', key)).join(''));
  engine.getVersion = () => refusal(404, 'NoSuchVersion', 'The version is unavailable.');
  open();
  await toggleVersions();

  const nativeSelection = required(window.getSelection());
  for (const { id, key, indicator, cellCue, spoken } of keys) {
    const { control, index } = await waitFor(() => required(selection(id)));
    const cell = required(table().findBodyCell(index, 2));
    const value = required(cell.find('.aws-area-value-name')).getElement();
    expect(value).toBeVisible();
    expect(value.textContent).toBe(key);
    const range = document.createRange();
    range.selectNodeContents(value);
    nativeSelection.removeAllRanges();
    nativeSelection.addRange(range);
    expect(nativeSelection.toString()).toBe(key);
    nativeSelection.removeAllRanges();

    const indicatorElement = cell.find('[role="note"]')?.getElement();
    expect(indicatorElement?.textContent).toBe(indicator);
    if (indicator !== undefined) expect(indicatorElement).toHaveStyle({ userSelect: 'none' });
    if (cellCue !== undefined || id === 'space') {
      // jsdom retains control whitespace and may omit the separator around the CSS block note.
      const keyName = 'logs/line\\s+break\\.csv';
      const cue = cellCue === undefined ? '' : `\\s*${cellCue}`;
      const metadata = narrow ? ` Type: Version · Latest: No Version ID: ${id}` : '';
      expect(cell.getElement()).toHaveAccessibleName(new RegExp(`^${keyName}${cue}${metadata}$`));
    }
    expect(control).toHaveAccessibleName('Select ' + spoken + ' version ' + id + ', Type: Version, Latest: No');
    expect(control).not.toBeChecked();
  }

  // Download acts on the selected row immediately. The mock transport accepts only the raw CR key.
  engine.objectKey = required(keys[0]).key;
  await select('cr');
  fireEvent.click(action('Download'));
  await waitFor(() => expect(engine.versionDownloads).toEqual(['cr']));
});

it('selects a different ID of the same key on the next page and returns to the ordinary listing of the folder', async () => {
  engine.readHistory = (query) =>
    query.has('key-marker') ? history(row('v2')) : history(row('v1', true), [KEY, 'v1']);
  open();
  expect(await currentObjectLink()).toBeVisible();
  await toggleVersions();
  await select('v1');
  fireEvent.click(action('Next page'));
  await select('v2');
  expect(selection('v2')?.control).toBeChecked();
  expectCursor(engine.histories[1], KEY, 'v1');
  await toggleVersions();
  expect(await currentObjectLink()).toHaveTextContent('history.txt');
  expect(engine.lists[0]?.get('prefix')).toBe(FOLDER);
});

it('shows a history refusal and retries the read', async () => {
  engine.readHistory = () => refusal(403, 'AccessDenied', 'Version history is forbidden');
  open();
  await toggleVersions();
  await waitFor(() => expect(table().findEmptySlot()?.getElement()).toHaveTextContent('Version history is forbidden'));
  engine.readHistory = () => history(row('v1', true));
  fireEvent.click(action('Retry'));
  await expectVersion('v1', 'Version', true);
});

it('keeps the refreshed history and its cursors when a previous page request finishes late', async () => {
  const oldSecondPage = heldResponse();
  engine.readHistory = (query) =>
    query.has('key-marker') ? oldSecondPage.promise : history(row('old-cursor', true), [KEY, 'old-cursor']);
  open();
  await toggleVersions();
  await expectVersion('old-cursor', 'Version', true);
  fireEvent.click(action('Next page'));
  await waitFor(() => expectCursor(engine.histories[1], KEY, 'old-cursor'));

  engine.readHistory = (query) =>
    query.has('key-marker') ? history(row('next')) : history(row('new-cursor', true), [KEY, 'new-cursor']);
  fireEvent.click(action('Refresh'));
  await expectVersion('new-cursor', 'Version', true);
  await act(async () => oldSecondPage.resolve(history(row('obsolete'), [KEY, 'obsolete'])));
  expect(selection('obsolete')).toBeUndefined();
  fireEvent.click(action('Next page'));
  await expectVersion('next', 'Version', false);
  expectCursor(engine.histories[3], KEY, 'new-cursor');
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
  expect(historyButton(REMOVE)).toBeUndefined();
  fireEvent.click(action('Download'));
  await waitFor(() => expect(flashContent('error')).toHaveTextContent('NoSuchVersion'));
  expect(flashContent('error')).toHaveTextContent('The specified version does not exist.');
  expect(engine.versionDownloads).toEqual(['null']);
  expect(save).not.toHaveBeenCalled();
  expect(click).not.toHaveBeenCalled();
  await select('marker');
  expect(action(REMOVE)).toBeEnabled();
  expect(historyButton('Download')).toBeUndefined();
  expect(historyButton(RESTORE)).toBeUndefined();
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
  const { content, input, confirm } = await confirmDialog(RESTORE);
  await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
  expect(dialogValue(content, 'Key')).toHaveTextContent(KEY);
  expect(dialogValue(content, 'Source version ID')).toHaveTextContent('old');
  engine.status = 'Suspended';
  expect(content.findAlert()?.findContent()?.getElement()).toHaveTextContent(WARNING);
  expect(content.getElement()).toHaveTextContent('The selected version’s contents will become the current object.');
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
  await waitFor(() => expect(flashContent('success')).toHaveTextContent(RESTORED));
  await expectVersion('null', 'Version', true);
});

it.each([
  {
    label: RESTORE,
    kind: 'Version',
    key: 'reports/line\rbreak.csv',
    wirePath: 'reports/line%0Dbreak.csv',
    wrongKey: 'reports/line\nbreak.csv',
  },
  {
    label: RESTORE,
    kind: 'Version',
    key: 'reports/line\nbreak.csv',
    wirePath: 'reports/line%0Abreak.csv',
    wrongKey: 'reports/line%0Abreak.csv',
  },
  {
    label: RESTORE,
    kind: 'Version',
    key: 'reports/line%0Dbreak.csv',
    wirePath: 'reports/line%250Dbreak.csv',
    wrongKey: 'reports/line\nbreak.csv',
  },
  {
    label: REMOVE,
    kind: 'DeleteMarker',
    key: 'reports/line\nbreak.csv',
    wirePath: 'reports/line%0Abreak.csv',
    wrongKey: 'reports/line%0Abreak.csv',
  },
  {
    label: REMOVE,
    kind: 'DeleteMarker',
    key: 'reports/line\rbreak.csv',
    wirePath: 'reports/line%0Dbreak.csv',
    wrongKey: 'reports/line\nbreak.csv',
  },
])('uses the exact listed key for $label at $wirePath', async ({ label, kind, key, wirePath, wrongKey }) => {
  const cursorId = 'cursor%0A+';
  const selectedId = 'selected%0D+';
  const restoring = label === RESTORE;
  engine.objectKey = key;
  engine.readHistory = (query) =>
    query.has('key-marker')
      ? history(row(selectedId, !restoring, kind, key) + row('sibling', false, kind, wrongKey))
      : history(row(cursorId, true, 'Version', key), [key, cursorId]);
  open();
  await toggleVersions();
  await waitFor(() => required(selection(cursorId)));
  fireEvent.click(action('Next page'));
  await select(selectedId);
  expectCursor(engine.histories[1], key, cursorId);
  expect(engine.histories[0]?.get('encoding-type')).toBe('url');
  expect(engine.histories[1]?.get('encoding-type')).toBe('url');

  const { content, input, confirm } = await confirmDialog(label);
  if (restoring) {
    await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
  }
  const expected = key.includes('\r') ? 'JSON ' + JSON.stringify(key) : key;
  expect(dialogValue(content, key.includes('\r') ? 'Confirmation text' : 'Key').textContent).toBe(expected);
  enter(input, wrongKey);
  expectDisabled(confirm);
  expect(engine.destinations).toEqual([]);
  enter(input, expected);
  expect(confirm).toBeEnabled();
  fireEvent.click(confirm);
  await waitFor(() => expect(engine.destinations).toEqual([`/${BUCKET}/${key}`]));
  if (restoring) {
    expect(engine.copies).toEqual([`${BUCKET}/${wirePath}?versionId=selected%250D%2B`]);
  } else {
    expect(engine.markerDeletes).toEqual([selectedId]);
  }
});

it.each([
  { label: RESTORE, kind: 'Version' },
  { label: REMOVE, kind: 'DeleteMarker' },
])('keeps CR and the literal quoted escape key distinct for $label', async ({ label, kind }) => {
  const crKey = 'a\rb';
  const literalKey = '"a\\rb"';
  const restoring = label === RESTORE;
  engine.readHistory = () =>
    history(row('cr-body', !restoring, kind, crKey) + row('literal-body', !restoring, kind, literalKey));
  open('/aws/s3/buckets/alpha/objects');
  await toggleVersions();
  for (const [id, key, spelling, otherSpelling] of [
    ['cr-body', crKey, 'JSON ' + literalKey, literalKey],
    ['literal-body', literalKey, literalKey, 'JSON ' + literalKey],
  ] as const) {
    engine.objectKey = key;
    await select(id);
    const { content, input, confirm } = await confirmDialog(label);
    if (restoring) {
      await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
    }
    expect(dialogValue(content, id === 'cr-body' ? 'Confirmation text' : 'Key').textContent).toBe(spelling);
    if (id === 'cr-body') {
      expect(input).toHaveAccessibleDescription(
        'Enter the confirmation text exactly as shown, including JSON and the quoted key.',
      );
    }
    enter(input, otherSpelling);
    expectDisabled(confirm);
    const priorWrites = engine.destinations.length;
    fireEvent.click(confirm);
    expect(engine.destinations).toHaveLength(priorWrites);
    enter(input, spelling);
    fireEvent.click(confirm);
    await waitFor(() => expect(engine.destinations.at(-1)).toBe('/' + BUCKET + '/' + key));
    await waitFor(() => expect(createWrapper().findModal()).toBeNull());
  }
});

it('rejects a download after the selected null body changes and guides the user back to history', async () => {
  engine.readHistory = () => history(row('null'));
  let liveETag = NULL_ETAG;
  engine.getVersion = (condition) =>
    condition !== null && condition !== liveETag
      ? refusal(412, 'PreconditionFailed', 'The specified ETag no longer matches.')
      : new Response('replacement bytes');
  const save = vi.spyOn(URL, 'createObjectURL');
  open();
  await toggleVersions();
  await select('null');
  liveETag = '"replacement-null-body"';
  fireEvent.click(action('Download'));
  await waitFor(() => expect(flashContent('error')).toHaveTextContent('PreconditionFailed'));
  expect(flashContent('error')).toHaveTextContent('The specified ETag no longer matches.');
  expect(flashContent('error')).toHaveTextContent(CHANGED_BODY);
  expect(flashContent('error')).toHaveTextContent(RESELECT);
  expect(engine.downloadConditions).toEqual([NULL_ETAG]);
  expect(save).not.toHaveBeenCalled();
});

it('rejects a restore after the selected null body changes and keeps the current object', async () => {
  engine.readHistory = () => history(row('current', true) + row('null'));
  let liveETag = NULL_ETAG;
  engine.writeCopy = (condition) => {
    if (condition !== null && condition !== liveETag) {
      return refusal(412, 'PreconditionFailed', 'The specified copy source ETag no longer matches.');
    }
    engine.body = 'replacement body';
    return new Response('<CopyObjectResult><ETag>copy</ETag></CopyObjectResult>');
  };
  open();
  await toggleVersions();
  await select('null');
  const { content, input, confirm } = await confirmDialog(RESTORE);
  await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
  liveETag = '"replacement-null-body"';
  enter(input, KEY);
  fireEvent.click(confirm);
  await waitFor(() => expect(flashContent('error')).toHaveTextContent('PreconditionFailed'));
  expect(flashContent('error')).toHaveTextContent('The specified copy source ETag no longer matches.');
  expect(flashContent('error')).toHaveTextContent(CHANGED_BODY);
  expect(flashContent('error')).toHaveTextContent(RESELECT);
  expect(engine.copyConditions).toEqual([NULL_ETAG]);
  expect(flashContent('success')).toBeUndefined();
  await expectVersion('current', 'Version', true);
  await toggleVersions();
  await expectCurrentDetails('before change');
});

it.each([
  { layout: 'desktop', narrow: false, operation: 'Download' },
  { layout: 'mobile', narrow: true, operation: 'Download' },
  { layout: 'desktop', narrow: false, operation: RESTORE },
  { layout: 'mobile', narrow: true, operation: RESTORE },
])('binds $operation to either refreshed null row on $layout', async ({ narrow, operation }) => {
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: narrow && media === '(max-width: 688px)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  const replacement = '"replacement-null-body"';
  const preconditionMessage = 'The selected ETag did not match the addressable body.';
  engine.readHistory = () => history(row('current', true) + row('null'));
  engine.getVersion = (condition) =>
    condition === replacement ? new Response('replacement') : refusal(412, 'PreconditionFailed', preconditionMessage);
  engine.writeCopy = (condition) =>
    condition === replacement
      ? new Response('<CopyObjectResult><ETag>"replacement-null-body"</ETag></CopyObjectResult>')
      : refusal(412, 'PreconditionFailed', preconditionMessage);
  const save = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:null-version');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  open();
  await toggleVersions();
  await select('null', NULL_ETAG);

  engine.readHistory = () =>
    history(row('current', true) + row('null', false, 'Version', KEY, replacement) + row('null'));
  fireEvent.click(action('Refresh'));
  const newer = await waitFor(() => required(selection('null', replacement)));
  const older = required(selection('null', NULL_ETAG));
  expect(newer.control).toHaveAccessibleName(/ETag: "replacement-null-body"$/);
  expect(older.control).toHaveAccessibleName(/ETag: "observed-null-body"$/);
  expect(newer.control).not.toBeChecked();
  expect(older.control).not.toBeChecked();

  async function submit() {
    if (operation === RESTORE) {
      const { content, input, confirm } = await confirmDialog(RESTORE);
      await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
      enter(input, KEY);
      fireEvent.click(confirm);
    } else {
      fireEvent.click(action('Download'));
    }
  }

  fireEvent.click(older.control);
  expect(older.control).toBeChecked();
  expect(newer.control).not.toBeChecked();
  expect(table().findSelectedRows()).toHaveLength(1);
  await submit();
  await waitFor(() => expect(flashContent('error')).toHaveTextContent('PreconditionFailed'));
  expect(flashContent('error')).toHaveTextContent(preconditionMessage);
  expect(flashContent('error')).toHaveTextContent(CHANGED_BODY);
  expect(flashContent('error')).toHaveTextContent(RESELECT);
  expectDisabled(action('Download'));
  expectDisabled(action(RESTORE));
  expect(save).not.toHaveBeenCalled();

  fireEvent.click(newer.control);
  expect(newer.control).toBeChecked();
  expect(older.control).not.toBeChecked();
  expect(table().findSelectedRows()).toHaveLength(1);
  expect(action(operation)).toBeEnabled();
  await submit();
  if (operation === RESTORE) {
    await waitFor(() => expect(flashContent('success')).toHaveTextContent(RESTORED));
    expect(engine.copyConditions).toEqual([NULL_ETAG, replacement]);
  } else {
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(engine.downloadConditions).toEqual([NULL_ETAG, replacement]);
  }
});

it('preserves the reported code and message when the bucket disappears before reading history', async () => {
  engine.readHistory = () => refusal(404, 'NoSuchBucket', 'History could not be read because alpha disappeared.');
  open();
  await currentObjectLink();
  await toggleVersions();
  await waitFor(() => expect(table().findEmptySlot()?.getElement()).toHaveTextContent('NoSuchBucket'));
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent(
    'History could not be read because alpha disappeared.',
  );
});

it('preserves the reported code and message when the bucket disappears before reading restore status', async () => {
  engine.readStatus = () => refusal(404, 'NoSuchBucket', 'Versioning could not be read because alpha disappeared.');
  open();
  await toggleVersions();
  await select('old');
  const { content, input, confirm } = await confirmDialog(RESTORE);
  await waitFor(() => expect(content.getElement()).toHaveTextContent('NoSuchBucket'));
  expect(content.getElement()).toHaveTextContent('Versioning could not be read because alpha disappeared.');
  enter(input, KEY);
  expectDisabled(confirm);
  expect(engine.copies).toEqual([]);
});

it('prevents a restore when reading versioning fails or the confirmation is canceled', async () => {
  engine.readStatus = () => refusal(403, 'AccessDenied', 'Versioning could not be read.');
  open();
  await toggleVersions();
  await select('old');
  const { content, footer, input, confirm } = await confirmDialog(RESTORE);
  await waitFor(() =>
    expect(
      content
        .findAllAlerts()
        .map((alert) => alert.findContent()?.getElement().textContent)
        .join(' '),
    ).toContain('Versioning could not be read'),
  );
  enter(input, KEY);
  expectDisabled(confirm);
  fireEvent.click(confirm);
  fireEvent.click(required(findButton(footer, 'Cancel')).getElement());
  expect(createWrapper().findModal()).toBeNull();
  await waitFor(() => expect(action(RESTORE)).toHaveFocus());
  expect(engine.copies).toEqual([]);
});

it('retains the original latest row and shows the restore refusal', async () => {
  engine.writeCopy = () => refusal(403, 'AccessDenied', 'Restore was refused');
  open();
  await toggleVersions();
  await select('old');
  const { content, input, confirm } = await confirmDialog(RESTORE);
  await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
  enter(input, KEY);
  fireEvent.click(confirm);
  await waitFor(() => expect(flashContent('error')).toHaveTextContent('AccessDenied'));
  expect(flashContent('error')).toHaveTextContent('Restore was refused');
  await expectVersion('new', 'Version', true);
  expect(flashContent('success')).toBeUndefined();
});

it('retains the marker and shows the marker removal refusal', async () => {
  engine.readHistory = () => history(row('marker', true, 'DeleteMarker'));
  engine.writeDelete = () => refusal(403, 'AccessDenied', 'Marker removal was refused');
  open();
  await toggleVersions();
  await select('marker');
  const { content, input, confirm } = await confirmDialog(REMOVE);
  expect(dialogValue(content, 'Key')).toHaveTextContent(KEY);
  expect(dialogValue(content, 'Delete marker version ID')).toHaveTextContent('marker');
  expect(content.getElement()).toHaveTextContent(
    'Removing this marker can make an earlier version visible as the current object.',
  );
  enter(input, KEY);
  fireEvent.click(confirm);
  await waitFor(() => expect(flashContent('error')).toHaveTextContent('AccessDenied'));
  expect(flashContent('error')).toHaveTextContent('Marker removal was refused');
  expect(engine.markerDeletes).toEqual(['marker']);
  await expectVersion('marker', 'Delete marker', true);
  expect(flashContent('success')).toBeUndefined();
});

it('shows the area state for an unimplemented history read', async () => {
  engine.readHistory = () => refusal(501, 'NotImplemented', 'Version history is unavailable');
  open();
  await toggleVersions();
  await waitFor(() =>
    expect(table().findEmptySlot()?.getElement()).toHaveTextContent('Not implemented by the emulator'),
  );
  expect(table().findEmptySlot()?.getElement()).toHaveTextContent('501 Not Implemented for ListObjectVersions');
});

async function expectCurrentDetails(body: string) {
  fireEvent.click(await currentObjectLink());
  expect(await screen.findByRole('region', { name: 'Object preview' })).toHaveTextContent(body);
  expect(main().findHeader()?.findHeadingText().getElement()).toHaveTextContent('history.txt');
  await waitFor(() => {
    const rows = main()
      .findAllTables()
      .flatMap((table) => table.findRows());
    expect(rows.some((row) => row.getElement().textContent === `state${body}`)).toBe(true);
  });
  await waitFor(() => expect(engine.reads).toEqual(expect.arrayContaining(['head', 'tags', 'body'])));
}

async function openObjectPreferences() {
  const preferences = required(table().findCollectionPreferences());
  fireEvent.click(preferences.findTriggerButton().getElement());
  return waitFor(() => required(preferences.findModal()));
}

function pageSizeOption(preferences: Awaited<ReturnType<typeof openObjectPreferences>>, size: number) {
  const options = required(preferences.findPageSizePreference()).findOptions();
  return required(
    options.map((option) => option.findNativeInput().getElement()).find((input) => input.value === String(size)),
  );
}

it('restores from page two and shows refreshed history and current reads when the ordinary list answers first', async () => {
  const router = open();
  await expectCurrentDetails('before change');
  await act(async () => router.navigate(PATH));
  await currentObjectLink();
  const preferences = await openObjectPreferences();
  fireEvent.click(pageSizeOption(preferences, 50));
  fireEvent.click(required(preferences.findWrapLinesPreference()).findNativeInput().getElement());
  fireEvent.click(required(preferences.findConfirmButton()).getElement());
  await ordinaryReadSettled();
  await toggleVersionsForRestore();

  const refreshedHistory = heldResponse();
  const refreshedObjects = heldResponse();
  engine.writeCopy = () => {
    engine.body = 'restored body';
    engine.readCurrent = () => refreshedObjects.promise;
    engine.readHistory = () => refreshedHistory.promise;
    return new Response('<CopyObjectResult><ETag>copy</ETag></CopyObjectResult>');
  };
  const { content, input, confirm } = await confirmDialog(RESTORE);
  await waitFor(() => expect(dialogValue(content, 'Bucket versioning')).toHaveTextContent('Enabled'));
  enter(input, KEY);
  const listsBefore = engine.lists.length;
  fireEvent.click(confirm);
  await waitFor(() => expect(engine.lists).toHaveLength(listsBefore + 1));
  await waitFor(() => expect(engine.histories).toHaveLength(3));
  expect(engine.lists.at(-1)?.get('prefix')).toBe(FOLDER);
  expect(engine.lists.at(-1)?.get('max-keys')).toBe('50');
  expect(engine.lists.at(-1)?.get('continuation-token')).toBeNull();
  expectCursor(engine.histories[2], null, null);
  refreshedObjects.resolve(objects([KEY]));
  await ordinaryReadSettled();
  expect(table().findLoadingText()?.getElement()).toHaveTextContent('Loading versions');
  refreshedHistory.resolve(history(row('restored', true) + row('new') + row('null')));
  await expectVersion('restored', 'Version', true);
  expect(flashContent('success')).toHaveTextContent(RESTORED);
  expect(engine.copies).toEqual([`${BUCKET}/${KEY}?versionId=null`]);
  expect(engine.copyConditions).toEqual([NULL_ETAG]);
  await toggleVersions();
  const retained = await openObjectPreferences();
  expect(pageSizeOption(retained, 50)).toBeChecked();
  expect(required(retained.findWrapLinesPreference()).findNativeInput().getElement()).not.toBeChecked();
  fireEvent.click(required(retained.findCancelButton()).getElement());
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
  await waitFor(() => expect(table().findEmptySlot()?.getElement()).toHaveTextContent('No objects'));
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
  await waitFor(() => expect(action('Refresh')).toHaveFocus());
  expectCursor(engine.histories[2], null, null);
  await waitFor(() => expect(engine.lists).toHaveLength(2));
  expect(engine.lists[1]?.get('prefix')).toBe(FOLDER);
  expect(engine.lists[1]?.get('continuation-token')).toBeNull();
  refreshedObjects.resolve(objects([KEY]));
  await ordinaryReadSettled();
  expect(flashContent('success')).toHaveTextContent(REMOVED);
  fireEvent.click(action('Next page'));
  await expectVersion('previous', 'Version', true);
  expectCursor(engine.histories[3], KEY, 'current-cursor');
  expect(selection('marker')).toBeUndefined();
  expect(flashContent('success')).toHaveTextContent(REMOVED);
  expect(engine.markerDeletes).toEqual(['marker']);
  await toggleVersions();
  await expectCurrentDetails('revealed body');
});
