import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useRef, useState } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

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
            {flash?.map(({ header, content }, index) => (
              <div role="status" key={index}>
                <div>{header}</div>
                <div>{content}</div>
              </div>
            ))}
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

async function select(name: string) {
  fireEvent.click(await screen.findByRole('radio', { name }));
}

async function openPublish() {
  fireEvent.click(screen.getByRole('button', { name: 'Publish layer version' }));
  return within(await screen.findByRole('dialog', { name: 'Publish layer version' }));
}

function chooseZip() {
  const bytes = new Uint8Array(storedZip('module.py', 'value = 2'));
  const file = new File([bytes], 'layer.zip', { type: 'application/zip' });
  const input = createWrapper(document.body).findFileUpload()?.findNativeInput().getElement();
  if (input === undefined) throw new Error('ZIP file input did not open.');
  fireEvent.change(input, { target: { files: [file] } });
}

function button(dialog: ReturnType<typeof within>) {
  return dialog.getByRole('button', { name: 'Publish layer version' });
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

  expect(screen.getByText('Loading layers…')).toBeInTheDocument();
  expect(screen.queryByText('No layers')).not.toBeInTheDocument();
  await act(() => read.resolve({ items: [], nextMarker: undefined }));
  expect(await screen.findByText('No layers')).toBeInTheDocument();
  expect(screen.getByText('Publish a ZIP file to create your first layer.')).toBeInTheDocument();
  expect(await openPublish()).toBeDefined();
});

it('shows only beta versions when an earlier alpha request answers after the selection changed', async () => {
  const alpha = holdRead<LayerVersion>();
  versions.mockReturnValueOnce(alpha.promise);
  renderPage();

  await select('alpha');
  expect(screen.getByText('Loading layer versions…')).toBeInTheDocument();
  await select('beta');
  const table = within(await screen.findByRole('table', { name: 'Versions' }));
  expect(await table.findByRole('cell', { name: arn('beta', 1) })).toBeInTheDocument();
  await act(() => alpha.resolve(versionsFor('alpha', 1)));
  expect(table.queryByRole('cell', { name: arn('alpha', 1) })).not.toBeInTheDocument();
  expect(table.getByRole('cell', { name: arn('beta', 1) })).toBeInTheDocument();
});

it('requires both a layer name and a ZIP file', async () => {
  renderPage();
  const dialog = await openPublish();
  const name = dialog.getByRole('textbox', { name: 'Layer name' });
  expect(button(dialog)).toBeDisabled();
  fireEvent.change(name, { target: { value: 'beta' } });
  expect(button(dialog)).toBeDisabled();
  fireEvent.change(name, { target: { value: '' } });
  chooseZip();
  expect(button(dialog)).toBeDisabled();
  expect(publish).not.toHaveBeenCalled();
});

it('keeps the reported publication result after versions and then the listing refresh', async () => {
  const listing = holdRead<LayerSummary>();
  const refreshedVersions = holdRead<LayerVersion>();
  list.mockResolvedValueOnce(layers).mockReturnValueOnce(listing.promise);
  versions.mockResolvedValueOnce(versionsFor('beta', 1)).mockReturnValueOnce(refreshedVersions.promise);
  renderPage();
  await select('beta');
  const table = within(screen.getByRole('table', { name: 'Versions' }));
  expect(await table.findByRole('cell', { name: arn('beta', 1) })).toBeInTheDocument();

  const dialog = await openPublish();
  fireEvent.change(dialog.getByRole('textbox', { name: 'Layer name' }), { target: { value: 'beta' } });
  chooseZip();
  fireEvent.click(button(dialog));

  expect(await screen.findByText('Published beta version 2.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(list).toHaveBeenCalledTimes(2);
  expect(versions).toHaveBeenCalledTimes(2);
  await act(() => refreshedVersions.resolve(versionsFor('beta', 2)));
  expect(await table.findByRole('cell', { name: arn('beta', 2) })).toBeInTheDocument();
  await act(() =>
    listing.resolve({
      ...layers,
      items: [
        { name: 'alpha', latestVersion: 1 },
        { name: 'beta', latestVersion: 2 },
      ],
    }),
  );
  const beta = within(await screen.findByRole('row', { name: /beta.*2/ }));
  expect(beta.getByRole('cell', { name: '2' })).toBeInTheDocument();
  expect(table.getByRole('cell', { name: arn('beta', 2) })).toBeInTheDocument();
  expect(screen.getByText('Published beta version 2.')).toBeInTheDocument();
});

it('shows a publication refusal and lets the user correct the submitted name', async () => {
  publish.mockRejectedValueOnce(
    new RequestError({
      kind: 'other',
      operation: PUBLISH_LAYER_VERSION,
      code: 'InvalidParameterValueException',
      message: 'Invalid layer name.',
    }),
  );
  renderPage();
  const dialog = await openPublish();
  const name = dialog.getByRole('textbox', { name: 'Layer name' });
  fireEvent.change(name, { target: { value: 'invalid.name' } });
  chooseZip();
  fireEvent.click(button(dialog));

  expect(await dialog.findByText('Could not publish layer version.')).toBeInTheDocument();
  expect(
    dialog.getByText('PublishLayerVersion returned InvalidParameterValueException. Invalid layer name.'),
  ).toBeInTheDocument();
  expect(name).toHaveValue('invalid.name');
  fireEvent.change(name, { target: { value: 'valid-name' } });
  expect(name).toHaveValue('valid-name');
  expect(button(dialog)).toBeEnabled();
  expect(screen.queryByText(/^Published /)).not.toBeInTheDocument();
});

it.each([
  { operation: LIST_LAYERS, resource: 'layers' },
  { operation: LIST_LAYER_VERSIONS, resource: 'layer versions' },
])('retries $operation without displaying the empty state for a refusal', async ({ operation, resource }) => {
  const reader = operation === LIST_LAYERS ? list : versions;
  reader.mockRejectedValueOnce(new RequestError({ kind: 'other', operation, code: 'LayerError' }));
  renderPage();
  if (operation === LIST_LAYER_VERSIONS) await select('beta');

  expect(await screen.findByText(`Could not load ${resource}.`)).toBeInTheDocument();
  expect(screen.getByText(`${operation} returned LayerError.`)).toBeInTheDocument();
  expect(screen.queryByText(/^(No layers|No versions)$/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  if (operation === LIST_LAYERS) {
    expect(await screen.findByRole('radio', { name: 'beta' })).toBeInTheDocument();
    expect(versions).not.toHaveBeenCalled();
  } else {
    expect(await screen.findByRole('cell', { name: arn('beta', 1) })).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(1);
  }
  expect(reader).toHaveBeenCalledTimes(2);
});

it.each([LIST_LAYERS, LIST_LAYER_VERSIONS, PUBLISH_LAYER_VERSION])(
  'keeps the unavailable %s control visible and disabled after a 501',
  async (operation) => {
    const reader = operation === LIST_LAYERS ? list : operation === LIST_LAYER_VERSIONS ? versions : publish;
    reader.mockRejectedValueOnce(new RequestError({ kind: 'not-implemented', operation }));
    renderPage();
    if (operation === LIST_LAYER_VERSIONS) await select('beta');
    if (operation === PUBLISH_LAYER_VERSION) {
      const dialog = await openPublish();
      fireEvent.change(dialog.getByRole('textbox', { name: 'Layer name' }), { target: { value: 'beta' } });
      chooseZip();
      fireEvent.click(button(dialog));
    }

    expect(await screen.findByText('Not implemented by the emulator')).toBeInTheDocument();
    expect(screen.getByText(`The emulator answered 501 Not Implemented for ${operation}.`)).toBeInTheDocument();
    const control = screen.getByRole('button', {
      name: operation === PUBLISH_LAYER_VERSION ? 'Publish layer version' : 'Retry',
    });
    expect(control).toBeDisabled();
    fireEvent.click(control);
    expect(reader).toHaveBeenCalledTimes(1);
    if (operation !== PUBLISH_LAYER_VERSION) {
      expect(screen.getByRole('button', { name: 'Publish layer version' })).toBeEnabled();
    }
  },
);
