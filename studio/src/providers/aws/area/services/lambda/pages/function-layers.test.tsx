import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import AwsArea from '../../../index';

const PATH = '/aws/lambda/functions/function/orders';
const FUNCTION = '/2015-03-31/functions/orders';
const CONFIG = `${FUNCTION}/configuration`;
const LAYERS = '/2018-10-31/layers';
const VERSIONS = `${LAYERS}/tools/versions`;
const URL_CONFIG = '/2021-10-31/functions/orders/url';
const ADD = 'Add layer version';
const REMOVE = 'Remove layer version';
const EMPTY = 'No layers attached';
const UPDATED_DESCRIPTION = 'Updated function description';

function arn(layer: string, version = 1) {
  return `arn:aws:lambda:us-east-1:000000000000:layer:${layer}:${version}`;
}

const FIRST = arn('zeta', 3);
const MIDDLE = arn('alpha', 2);
const LAST = arn('other');
const OLDER = arn('tools');

function error(status: number, code: string, message = 'The emulator refused the request.') {
  return Response.json({ message }, { status, headers: { 'x-amzn-errortype': code } });
}

function holdRead() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}

class FakeEngine {
  attached: string[] = [];
  updates: unknown[] = [];
  requests: string[] = [];
  state = 'Successful';
  description = 'Initial function description';
  attachedAnswer = (): Response | Promise<Response> =>
    Response.json(this.attached.length === 0 ? {} : { Layers: this.attached.map((Arn) => ({ Arn })) });
  detailAnswer = (): Response | Promise<Response> =>
    Response.json({
      Configuration: {
        FunctionName: 'orders',
        State: 'Active',
        LastUpdateStatus: this.state,
        Description: this.description,
      },
    });
  urlAnswer = (): Response | Promise<Response> => error(404, 'ResourceNotFoundException');
  updateAnswer = (layers: string[]): Response | Promise<Response> => {
    this.attached = layers;
    this.description = UPDATED_DESCRIPTION;
    return Response.json({});
  };
  layerAnswer = (_marker: string | null): Response | Promise<Response> =>
    Response.json({ Layers: [{ LayerName: 'tools' }] });
  versionsAnswer = (_marker: string | null): Response | Promise<Response> =>
    Response.json({
      LayerVersions: [2, 1].map((Version) => ({ Version, LayerVersionArn: arn('tools', Version) })),
    });

  count(path: string, method = 'GET') {
    return this.requests.filter((request) => request === `${method} ${path}`).length;
  }

  fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(String(input), init);
    const { pathname, searchParams } = new URL(request.url);
    const { method } = request;
    this.requests.push(`${method} ${pathname}`);
    switch (pathname) {
      case '/__emuforge/session':
        return Response.json({ token: 'emuforge-layer-test-session' });
      case FUNCTION:
        return this.detailAnswer();
      case CONFIG:
        if (method === 'PUT') {
          const body = (await request.json()) as { Layers: string[] };
          this.updates.push(body);
          return this.updateAnswer(body.Layers);
        }
        return this.attachedAnswer();
      case URL_CONFIG:
        return this.urlAnswer();
      case LAYERS:
        return this.layerAnswer(searchParams.get('Marker'));
      case VERSIONS:
        return this.versionsAnswer(searchParams.get('Marker'));
      default:
        throw new Error(`Unexpected request: ${method} ${pathname}`);
    }
  };
}

let engine: FakeEngine;
let port = 9750;

beforeEach(() => {
  engine = new FakeEngine();
  port += 1;
  vi.stubGlobal('fetch', engine.fetch);
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

afterEach(() => vi.unstubAllGlobals());

function open(tab = 'configuration') {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`${PATH}?tab=${tab}`]}>
        <AwsArea
          headerSelector="#top-bar"
          onPageTitle={() => undefined}
          onContentTarget={() => undefined}
          routeChanges={0}
          connection={{
            engineOrigin: engineEndpoint(port),
            result: {
              kind: 'connected',
              checkedAt: Date.now(),
              emulator: { endpoint: 'https://127.0.0.1:9700', port: 9700 },
            },
          }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function addButton() {
  return screen.getByRole('button', { name: ADD });
}

async function openAdd() {
  await screen.findByRole('table', { name: 'Layers' });
  await waitFor(() => expect(addButton()).toBeEnabled());
  fireEvent.click(addButton());
  return within(await screen.findByRole('dialog', { name: ADD }));
}

function dialogSubmit(dialog: ReturnType<typeof within>, action = ADD) {
  return dialog.getByRole('button', { name: action });
}

async function choose(dialog: ReturnType<typeof within>, label: string, option: string | RegExp) {
  const selector = dialog.getByRole('button', { name: new RegExp(label) });
  await waitFor(() => expect(selector).toBeEnabled());
  fireEvent.click(selector);
  fireEvent.click(await dialog.findByRole('option', { name: option }));
}

async function chooseOlderVersion(dialog: ReturnType<typeof within>) {
  await choose(dialog, 'Layer name', 'tools');
  await choose(dialog, '^Version', /^1\b/);
}

async function openRemove(layer: string) {
  fireEvent.click(await screen.findByRole('button', { name: `${REMOVE} ${layer}` }));
  const dialog = within(await screen.findByRole('dialog', { name: REMOVE }));
  expect(dialog.getByText(layer)).toBeVisible();
  return dialog;
}

async function expectAttached(layers: readonly string[]) {
  await waitFor(() => {
    const displayed = within(screen.getByRole('table', { name: 'Layers' })).queryAllByRole('rowheader');
    expect(displayed.map(({ textContent }) => textContent)).toEqual(layers);
  });
}

it('shows loading and a retryable attached-layer error before showing a successful empty result', async () => {
  const held = holdRead();
  engine.attachedAnswer = vi
    .fn()
    .mockReturnValueOnce(held.promise)
    .mockImplementation(() => Response.json({}));
  open('code');
  fireEvent.click(await screen.findByRole('tab', { name: 'Configuration' }));

  expect(await screen.findByText('Loading attached layers…')).toBeVisible();
  expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();
  await act(() => held.resolve(error(500, 'ServiceException')));
  expect(await screen.findByText('Could not load attached layers.')).toBeVisible();
  expect(screen.getByText(/GetFunctionConfiguration returned ServiceException/)).toBeVisible();
  expect(screen.queryByText(EMPTY)).not.toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText(EMPTY)).toBeVisible();
  expect(engine.count(CONFIG)).toBe(2);
});

it('keeps a concurrent-update refusal through both rereads', async () => {
  engine.updateAnswer = () => error(409, 'ResourceConflictException', 'Another update is in progress.');
  open();
  const dialog = await openAdd();
  await chooseOlderVersion(dialog);

  fireEvent.click(dialogSubmit(dialog));
  expect(await screen.findByText('Could not add layer version.')).toBeVisible();
  await waitFor(() => expect(engine.count(FUNCTION)).toBe(2));
  await waitFor(() => expect(engine.count(CONFIG)).toBe(2));
  expect(await screen.findByText(EMPTY)).toBeVisible();
  expect(
    screen.getByText(/UpdateFunctionConfiguration returned ResourceConflictException. Another update is in progress./),
  ).toBeVisible();
  expect(screen.queryByText('Layer version added.')).not.toBeInTheDocument();
});

it('appends an older version from later pages and keeps the existing order', async () => {
  engine.attached = [FIRST, MIDDLE];
  engine.layerAnswer = (marker) =>
    Response.json(
      marker === null
        ? { Layers: [{ LayerName: 'first-page' }], NextMarker: 'more-layers' }
        : { Layers: [{ LayerName: 'tools' }] },
    );
  engine.versionsAnswer = (marker) =>
    Response.json(
      marker === null
        ? { LayerVersions: [{ Version: 2, LayerVersionArn: arn('tools', 2) }], NextMarker: 'older-versions' }
        : { LayerVersions: [{ Version: 1, LayerVersionArn: OLDER }] },
    );
  open();
  const dialog = await openAdd();
  const layerPages = within(await dialog.findByRole('navigation', { name: 'Layer name pages' }));
  fireEvent.click(layerPages.getByRole('button', { name: 'Next page' }));
  await choose(dialog, 'Layer name', 'tools');
  const versionPages = within(await dialog.findByRole('navigation', { name: 'Version pages' }));
  fireEvent.click(versionPages.getByRole('button', { name: 'Next page' }));
  await choose(dialog, '^Version', /^1\b/);
  fireEvent.click(dialogSubmit(dialog));

  await expectAttached([FIRST, MIDDLE, OLDER]);
  expect(engine.updates).toEqual([{ Layers: [FIRST, MIDDLE, OLDER] }]);
  expect((await screen.findAllByText(UPDATED_DESCRIPTION))[0]).toBeVisible();
  expect(screen.getByText('Layer version added.')).toBeVisible();
});

it('cancels removal without a request, then removes the middle version without reordering the others', async () => {
  engine.attached = [FIRST, MIDDLE, LAST];
  open();
  const cancelled = await openRemove(MIDDLE);
  fireEvent.click(cancelled.getByRole('button', { name: 'Cancel' }));
  expect(engine.updates).toEqual([]);
  await expectAttached([FIRST, MIDDLE, LAST]);

  const confirmed = await openRemove(MIDDLE);
  fireEvent.click(dialogSubmit(confirmed, REMOVE));
  await expectAttached([FIRST, LAST]);
  expect(engine.updates).toEqual([{ Layers: [FIRST, LAST] }]);
  expect((await screen.findAllByText(UPDATED_DESCRIPTION))[0]).toBeVisible();
  expect(screen.getByText('Layer version removed.')).toBeVisible();
});

describe.each(['add', 'remove'] as const)('persistent %s results', (action) => {
  it.each(['attachment', 'function detail'] as const)('survives the %s reread completing first', async (first) => {
    engine.attached = [FIRST];
    const originalAttached = engine.attachedAnswer;
    const heldUrl = holdRead();
    const heldAttached = holdRead();
    engine.updateAnswer = (layers) => {
      engine.attached = layers;
      engine.description = UPDATED_DESCRIPTION;
      engine.attachedAnswer = () => heldAttached.promise;
      engine.urlAnswer = () => heldUrl.promise;
      return Response.json({});
    };
    open();
    const dialog = action === 'add' ? await openAdd() : await openRemove(FIRST);
    if (action === 'add') await chooseOlderVersion(dialog);
    fireEvent.click(dialogSubmit(dialog, action === 'add' ? ADD : REMOVE));
    const success = action === 'add' ? 'Layer version added.' : 'Layer version removed.';
    expect(await screen.findByText(success)).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(engine.count(CONFIG)).toBe(2));
    await waitFor(() => expect(engine.count(URL_CONFIG)).toBe(2));

    const attachedReady = async () => {
      await act(async () => heldAttached.resolve(await originalAttached()));
      await expectAttached(action === 'add' ? [FIRST, OLDER] : []);
      if (action === 'remove') expect(await screen.findByText(EMPTY)).toBeVisible();
    };
    const detailReady = async () => {
      await act(() => heldUrl.resolve(error(404, 'ResourceNotFoundException')));
      expect((await screen.findAllByText(UPDATED_DESCRIPTION))[0]).toBeVisible();
    };
    if (first === 'attachment') {
      await attachedReady();
      expect(screen.queryByText(UPDATED_DESCRIPTION)).not.toBeInTheDocument();
      expect(screen.getByText(success)).toBeVisible();
      await detailReady();
    } else {
      await detailReady();
      expect(screen.getByText('Loading attached layers…')).toBeVisible();
      expect(screen.getByText(success)).toBeVisible();
      await attachedReady();
    }
    expect(screen.getByText(success)).toBeVisible();
    expect(engine.updates).toEqual([{ Layers: action === 'add' ? [FIRST, OLDER] : [] }]);
  });
});

it('keeps the removal refusal after the now-absent function and its Configuration disappear', async () => {
  engine.attached = [FIRST];
  engine.updateAnswer = () => {
    engine.detailAnswer = () => error(404, 'ResourceNotFoundException');
    engine.attachedAnswer = engine.detailAnswer;
    return error(404, 'ResourceNotFoundException', 'Function no longer exists.');
  };
  open();
  const dialog = await openRemove(FIRST);
  fireEvent.click(dialogSubmit(dialog, REMOVE));

  expect(await screen.findByText('Function not found')).toBeVisible();
  expect(screen.queryByRole('heading', { name: 'Layers' })).not.toBeInTheDocument();
  expect(screen.getByText('Could not remove layer version.')).toBeVisible();
  expect(
    screen.getByText(/UpdateFunctionConfiguration returned ResourceNotFoundException. Function no longer exists./),
  ).toBeVisible();
});

it('disables addition and removal while the function is updating', async () => {
  engine.attached = [FIRST];
  engine.state = 'InProgress';
  open();
  const remove = await screen.findByRole('button', { name: `${REMOVE} ${FIRST}` });
  expect(addButton()).toHaveAttribute('aria-disabled', 'true');
  expect(remove).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(addButton());
  fireEvent.click(remove);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(engine.updates).toEqual([]);
});

describe.each([
  { label: 'Layer name', resource: 'layers', operation: 'ListLayers', path: LAYERS, mock: 'layerAnswer' },
  {
    label: '^Version',
    resource: 'layer versions',
    operation: 'ListLayerVersions',
    path: VERSIONS,
    mock: 'versionsAnswer',
  },
] as const)('$operation in the picker', ({ label, resource, operation, path, mock }) => {
  it('blocks submission on failure and retries only the failed read', async () => {
    engine[mock] = vi
      .fn()
      .mockReturnValueOnce(error(400, 'InvalidParameterValueException'))
      .mockImplementation(engine[mock]);
    open();
    const dialog = await openAdd();
    if (path === VERSIONS) await choose(dialog, 'Layer name', 'tools');

    expect(await dialog.findByText(`Could not load ${resource}.`)).toBeVisible();
    expect(dialog.getByText(new RegExp(`${operation} returned InvalidParameterValueException`))).toBeVisible();
    expect(dialog.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    expect(dialogSubmit(dialog)).toBeDisabled();
    const other = path === LAYERS ? VERSIONS : LAYERS;
    const otherCount = engine.count(other);
    fireEvent.click(dialog.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(dialog.getByRole('button', { name: new RegExp(label) })).toBeEnabled());
    expect(engine.count(path)).toBe(2);
    expect(engine.count(other)).toBe(otherCount);
    if (path === LAYERS) await choose(dialog, 'Layer name', 'tools');
    await choose(dialog, '^Version', /^1\b/);
    expect(dialogSubmit(dialog)).toBeEnabled();
  });

  it('keeps the affected selector, confirmation and retry visible and disabled after a 501', async () => {
    engine[mock] = () => error(501, 'NotImplemented');
    open();
    const dialog = await openAdd();
    if (path === VERSIONS) await choose(dialog, 'Layer name', 'tools');

    expect(await dialog.findByText('Not implemented by the emulator')).toBeVisible();
    expect(dialog.getByText(new RegExp(`The emulator answered 501 Not Implemented for ${operation}\\.`))).toBeVisible();
    expect(dialog.getByRole('button', { name: new RegExp(label) })).toBeDisabled();
    expect(dialogSubmit(dialog)).toBeDisabled();
    const retry = dialog.getByRole('button', { name: 'Retry' });
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    fireEvent.click(dialogSubmit(dialog));
    expect(engine.count(path)).toBe(1);
    expect(engine.updates).toEqual([]);
  });
});

it('keeps attached-layer retry and addition disabled after a 501, including a page refresh', async () => {
  engine.attachedAnswer = () => error(501, 'NotImplemented');
  open();
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/The emulator answered 501 Not Implemented for GetFunctionConfiguration\./)).toBeVisible();
  const retry = screen.getByRole('button', { name: 'Retry' });
  expect(retry).toBeDisabled();
  expect(addButton()).toBeDisabled();
  fireEvent.click(retry);
  fireEvent.click(addButton());
  fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(engine.count(FUNCTION)).toBe(2));
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(engine.count(CONFIG)).toBe(1);
});

it('keeps both mutation actions visible and disabled after an update 501', async () => {
  engine.attached = [FIRST];
  engine.updateAnswer = () => error(501, 'NotImplemented');
  open();
  const dialog = await openRemove(FIRST);
  fireEvent.click(dialogSubmit(dialog, REMOVE));
  expect(await screen.findByText('Not implemented by the emulator')).toBeVisible();
  expect(screen.getByText(/The emulator answered 501 Not Implemented for UpdateFunctionConfiguration\./)).toBeVisible();
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

  for (const button of [addButton(), screen.getByRole('button', { name: `${REMOVE} ${FIRST}` })]) {
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(engine.count(CONFIG, 'PUT')).toBe(1);
  await expectAttached([FIRST]);
});
