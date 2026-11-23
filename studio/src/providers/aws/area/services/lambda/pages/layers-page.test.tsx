import Flashbar from '@cloudscape-design/components/flashbar';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';

import { RequestError } from '../../../../../../lib/aws/request';
import { AreaRootContext } from '../../../area-root';
import { PageFlashContext, type FlashResult } from '../../../components/page-flash';
import {
  LIST_LAYERS,
  LIST_LAYER_VERSIONS,
  PUBLISH_LAYER_VERSION,
  listLayers,
  listLayerVersions,
  publishLayerVersion,
  type LayerPage,
  type LayerSummary,
  type LayerVersion,
} from '../layer-api';
import { storedZip } from '../zip';
import { LayersPage } from './layers-page';

vi.mock('../layer-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../layer-api')>()),
  listLayers: vi.fn(),
  listLayerVersions: vi.fn(),
  publishLayerVersion: vi.fn(),
}));

const list = vi.mocked(listLayers);
const versions = vi.mocked(listLayerVersions);
const publish = vi.mocked(publishLayerVersion);
const engineOrigin = 'http://127.0.0.1:9565';
const layers: LayerPage<LayerSummary> = {
  items: [
    { name: 'alpha', latestVersion: 1 },
    { name: 'beta', latestVersion: 1 },
  ],
  nextMarker: undefined,
};

function arn(name: string, version: number) {
  return `arn:aws:lambda:us-east-1:000000000000:layer:${name}:${String(version)}`;
}

function versionsFor(name: string, version: number): LayerPage<LayerVersion> {
  return { items: [{ arn: arn(name, version), version }], nextMarker: undefined };
}

function holdRead<T>() {
  let resolve!: (page: LayerPage<T>) => void;
  const promise = new Promise<LayerPage<T>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function renderPage() {
  const client = new QueryClient();
  function Area() {
    const root = useRef<HTMLDivElement>(null);
    const [flash, show] = useState<FlashResult>();
    return (
      <AreaRootContext.Provider value={root}>
        <PageFlashContext.Provider value={{ show, handOver: () => undefined }}>
          <div ref={root}>
            {flash !== undefined && <Flashbar items={[...flash]} />}
            <LayersPage
              connection={{
                engineOrigin,
                result: {
                  kind: 'connected',
                  checkedAt: Date.now(),
                  emulator: { endpoint: 'https://127.0.0.1:9566', port: 9566 },
                },
              }}
            />
          </div>
        </PageFlashContext.Provider>
      </AreaRootContext.Provider>
    );
  }
  return render(
    <QueryClientProvider client={client}>
      <Area />
    </QueryClientProvider>,
  );
}

const page = createWrapper(document.body);

function required<T>(value: T | null | undefined): T {
  if (value == null) throw new Error('The expected Cloudscape control did not render.');
  return value;
}

function table(label: 'Layers' | 'Versions') {
  return required(page.findAllTables().find((item) => item.find(`table[aria-label="${label}"]`) !== null));
}

function layerRow(name: string) {
  const catalogue = table('Layers');
  return (
    catalogue
      .findRows()
      .findIndex((_row, index) => catalogue.findBodyCell(index + 1, 2)?.getElement().textContent === name) + 1
  );
}

async function select(name: string) {
  const radio = await waitFor(() =>
    required(table('Layers').findRowSelectionArea(layerRow(name))?.find('input[type="radio"]')),
  );
  fireEvent.click(radio.getElement());
}

function publishControl() {
  return required(
    table('Layers')
      .findHeaderSlot()
      ?.findAllButtons()
      .find((button) => button.findTextRegion()?.getElement().textContent === 'Publish layer version'),
  );
}

async function openPublish() {
  fireEvent.click(publishControl().getElement());
  return waitFor(() => {
    const dialog = required(page.findModal());
    expect(dialog.findHeader().getElement()).toHaveTextContent('Publish layer version');
    return dialog;
  });
}

function nameInput(dialog: Awaited<ReturnType<typeof openPublish>>) {
  const field = dialog
    .findContent()
    .findAllFormFields()
    .find((item) => item.findLabel()?.getElement().textContent === 'Layer name');
  return required(field?.findControl()?.findInput()).findNativeInput().getElement();
}

function chooseZip(dialog: Awaited<ReturnType<typeof openPublish>>) {
  const bytes = new Uint8Array(storedZip('module.py', 'value = 2'));
  const file = new File([bytes], 'layer.zip', { type: 'application/zip' });
  const input = required(dialog.findContent().findFileUpload()).findNativeInput().getElement();
  fireEvent.change(input, { target: { files: [file] } });
}

function submitButton(dialog: Awaited<ReturnType<typeof openPublish>>) {
  return required(
    dialog
      .findFooter()
      ?.findAllButtons()
      .find((button) => button.findTextRegion()?.getElement().textContent === 'Publish layer version'),
  ).getElement();
}

async function submitPublication(name: string) {
  const dialog = await openPublish();
  fireEvent.change(nameInput(dialog), { target: { value: name } });
  chooseZip(dialog);
  fireEvent.click(submitButton(dialog));
  return dialog;
}

function expectVersion(version: number) {
  const versionsTable = table('Versions');
  expect(versionsTable.findRows()).toHaveLength(1);
  expect(versionsTable.findBodyCell(1, 1)?.getElement().textContent).toBe(String(version));
  expect(versionsTable.findBodyCell(1, 2)?.getElement().textContent).toBe(arn('beta', version));
}

function expectPublication() {
  const result = page.findFlashbar()?.findItemsByType('success')[0];
  expect(result?.findContent()?.getElement()).toHaveTextContent('Published beta version 2.');
}

const publishedLayers: LayerPage<LayerSummary> = {
  ...layers,
  items: [
    { name: 'alpha', latestVersion: 1 },
    { name: 'beta', latestVersion: 2 },
  ],
};

function expectLatestVersion() {
  expect(table('Layers').findBodyCell(layerRow('beta'), 3)?.getElement().textContent).toBe('2');
}

beforeEach(() => {
  list.mockReset().mockResolvedValue(layers);
  versions.mockReset().mockImplementation(async (_endpoint, name) => versionsFor(name, 1));
  publish.mockReset().mockResolvedValue({ name: 'beta', version: 2 });
});

it('shows loading before revealing the first publication action for an empty result', async () => {
  const read = holdRead<LayerSummary>();
  list.mockReturnValueOnce(read.promise);
  renderPage();

  expect(table('Layers').findLoadingText()?.getElement()).toHaveTextContent('Loading layers…');
  expect(table('Layers').findEmptySlot()?.getElement().textContent ?? '').not.toContain('No layers');
  await act(() => read.resolve({ items: [], nextMarker: undefined }));
  await waitFor(() => {
    const empty = table('Layers').findEmptySlot()?.getElement();
    expect(empty).toHaveTextContent('No layers');
    expect(empty).toHaveTextContent('Publish a ZIP file to create your first layer.');
  });
  expect(await openPublish()).toBeDefined();
});

it('shows only beta versions when an earlier alpha request answers after the selection changed', async () => {
  const alpha = holdRead<LayerVersion>();
  versions.mockReturnValueOnce(alpha.promise);
  renderPage();

  await select('alpha');
  expect(table('Versions').findLoadingText()?.getElement()).toHaveTextContent('Loading layer versions…');
  await select('beta');
  await waitFor(() => expectVersion(1));
  await act(() => alpha.resolve(versionsFor('alpha', 1)));
  expectVersion(1);
});

it('requires both a layer name and a ZIP file', async () => {
  renderPage();
  const dialog = await openPublish();
  const name = nameInput(dialog);
  expect(name).toHaveAccessibleDescription('Reuse an existing layer name to publish a new version.');
  expect(submitButton(dialog)).toBeDisabled();
  fireEvent.change(name, { target: { value: 'beta' } });
  expect(submitButton(dialog)).toBeDisabled();
  fireEvent.change(name, { target: { value: '' } });
  chooseZip(dialog);
  expect(submitButton(dialog)).toBeDisabled();
  expect(publish).not.toHaveBeenCalled();
});

it('keeps the reported publication result after versions and then the listing refresh', async () => {
  const listing = holdRead<LayerSummary>();
  const refreshedVersions = holdRead<LayerVersion>();
  list.mockResolvedValueOnce(layers).mockReturnValueOnce(listing.promise);
  versions.mockResolvedValueOnce(versionsFor('beta', 1)).mockReturnValueOnce(refreshedVersions.promise);
  renderPage();
  await select('beta');
  await waitFor(() => expectVersion(1));

  await submitPublication('beta');

  await waitFor(() => {
    expectPublication();
    expect(page.findModal()).toBeNull();
  });
  expect(list).toHaveBeenCalledTimes(2);
  expect(versions).toHaveBeenCalledTimes(2);
  await act(() => refreshedVersions.resolve(versionsFor('beta', 2)));
  await waitFor(() => expectVersion(2));
  await act(() => listing.resolve(publishedLayers));
  await waitFor(expectLatestVersion);
  expectVersion(2);
  expectPublication();
});

it('keeps the republished layer when the first catalogue response arrives last', async () => {
  const stale = holdRead<LayerSummary>();
  list.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(publishedLayers);
  versions.mockResolvedValueOnce(versionsFor('beta', 2));
  renderPage();
  await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

  await submitPublication('beta');
  await waitFor(() => {
    expect(list).toHaveBeenCalledTimes(2);
    expectLatestVersion();
    expectVersion(2);
    expectPublication();
  });

  expect(list.mock.calls[0]?.[2].aborted).toBe(true);
  await act(() => stale.resolve(layers));
  expectLatestVersion();
  expectVersion(2);
  expectPublication();
});

it('keeps the republished version when its first version response arrives last', async () => {
  const stale = holdRead<LayerVersion>();
  list.mockResolvedValueOnce(layers).mockResolvedValueOnce(publishedLayers);
  versions.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(versionsFor('beta', 2));
  renderPage();
  await select('beta');
  await waitFor(() => expect(versions).toHaveBeenCalledTimes(1));

  await submitPublication('beta');
  await waitFor(() => {
    expect(versions).toHaveBeenCalledTimes(2);
    expectLatestVersion();
    expectVersion(2);
    expectPublication();
  });

  expect(versions.mock.calls[0]?.[3].aborted).toBe(true);
  await act(() => stale.resolve(versionsFor('beta', 1)));
  expectLatestVersion();
  expectVersion(2);
  expectPublication();
});

it.each([
  { code: 'InvalidParameterValueException', message: 'Invalid layer name.' },
  { code: 'HTTP 413', message: 'ZIP request is too large.' },
])('shows a publication refusal ($code) and lets the user correct the submitted name', async ({ code, message }) => {
  publish.mockRejectedValueOnce(new RequestError({ kind: 'other', operation: PUBLISH_LAYER_VERSION, code, message }));
  renderPage();
  const dialog = await submitPublication('invalid.name');
  const name = nameInput(dialog);

  await waitFor(() => {
    const alert = dialog.findContent().findAlert();
    expect(alert?.findHeader()?.getElement()).toHaveTextContent('Could not publish layer version.');
    expect(alert?.findContent().getElement().textContent).toBe(`PublishLayerVersion returned ${code}. ${message}`);
  });
  expect(name).toHaveValue('invalid.name');
  fireEvent.change(name, { target: { value: 'valid-name' } });
  expect(name).toHaveValue('valid-name');
  expect(submitButton(dialog)).toBeEnabled();
  expect(page.findFlashbar()?.findItemsByType('success') ?? []).toHaveLength(0);
});

it('shows the service code alone for an empty Lambda publication rejection', async () => {
  const api = await vi.importActual<typeof import('../layer-api')>('../layer-api');
  publish.mockImplementationOnce(api.publishLayerVersion);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const path = new URL(request.url).pathname;
    if (path === '/__emuforge/session') return Response.json({ token: 'local-test-session' });
    expect(path).toBe('/2018-10-31/layers/beta/versions');
    return new Response(null, { status: 400, headers: { 'x-amzn-errortype': 'LayerError' } });
  });
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  renderPage();
  const dialog = await submitPublication('beta');

  await waitFor(() => {
    const alert = required(dialog.findContent().findAlert());
    expect(alert.findContent().getElement().textContent).toBe('PublishLayerVersion returned LayerError.');
  });
});

it.each([
  { operation: LIST_LAYERS, resource: 'layers', label: 'Layers' },
  { operation: LIST_LAYER_VERSIONS, resource: 'layer versions', label: 'Versions' },
] as const)(
  'retries $operation without displaying the empty state for a refusal',
  async ({ operation, resource, label }) => {
    const reader = operation === LIST_LAYERS ? list : versions;
    reader.mockRejectedValueOnce(new RequestError({ kind: 'other', operation, code: 'LayerError' }));
    renderPage();
    if (operation === LIST_LAYER_VERSIONS) await select('beta');

    const alert = await waitFor(() => required(table(label).findEmptySlot()?.findAlert()));
    expect(alert.findHeader()?.getElement()).toHaveTextContent(`Could not load ${resource}.`);
    expect(alert.findContent().getElement()).toHaveTextContent(`${operation} returned LayerError.`);
    expect(table(label).findEmptySlot()?.getElement()).not.toHaveTextContent(/No layers|No versions/);
    fireEvent.click(required(alert.findActionSlot()?.findButton()).getElement());
    if (operation === LIST_LAYERS) {
      await waitFor(() => expect(layerRow('beta')).toBeGreaterThan(0));
      expect(versions).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expectVersion(1));
      expect(list).toHaveBeenCalledTimes(1);
    }
    expect(reader).toHaveBeenCalledTimes(2);
  },
);

async function unavailableRead(label: 'Layers' | 'Versions', operation: string) {
  return waitFor(() => {
    const alert = required(table(label).findEmptySlot()?.findAlert());
    expect(alert.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
    expect(alert.findContent().getElement()).toHaveTextContent(
      `The emulator answered 501 Not Implemented for ${operation}.`,
    );
    const retry = required(alert.findActionSlot()?.findButton()).getElement();
    expect(retry).toHaveTextContent('Retry');
    expect(retry).toBeDisabled();
    return retry;
  });
}

it.each([LIST_LAYERS, LIST_LAYER_VERSIONS, PUBLISH_LAYER_VERSION])(
  'keeps the unavailable %s control visible and disabled after a 501',
  async (operation) => {
    const reader = operation === LIST_LAYERS ? list : operation === LIST_LAYER_VERSIONS ? versions : publish;
    reader.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
    renderPage();

    if (operation === PUBLISH_LAYER_VERSION) {
      await submitPublication('beta');
      await waitFor(() => {
        const result = page.findFlashbar()?.findItemsByType('info')[0];
        expect(result?.findHeader()?.getElement()).toHaveTextContent('Not implemented by the emulator');
        expect(result?.findContent()?.getElement()).toHaveTextContent(
          'The emulator answered 501 Not Implemented for PublishLayerVersion.',
        );
        expect(publishControl().getElement()).toBeDisabled();
      });
      fireEvent.click(publishControl().getElement());
    } else {
      if (operation === LIST_LAYER_VERSIONS) await select('beta');
      const retry = await unavailableRead(operation === LIST_LAYERS ? 'Layers' : 'Versions', operation);
      fireEvent.click(retry);
      expect(publishControl().getElement()).toBeEnabled();
    }
    expect(reader).toHaveBeenCalledTimes(1);
  },
);

it('remembers a version read 501 when returning to the layer within the same connection', async () => {
  versions.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation: LIST_LAYER_VERSIONS }));
  renderPage();
  await select('beta');
  await unavailableRead('Versions', LIST_LAYER_VERSIONS);

  await select('alpha');
  await waitFor(() => expect(table('Versions').findBodyCell(1, 2)?.getElement().textContent).toBe(arn('alpha', 1)));
  await select('beta');
  await unavailableRead('Versions', LIST_LAYER_VERSIONS);

  expect(versions.mock.calls.map(([, name]) => name)).toEqual(['beta', 'alpha']);
});
