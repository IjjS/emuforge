import createWrapper, { type ElementWrapper, type ModalWrapper } from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
  layerAnswer: (marker: string | null) => Response | Promise<Response> = () =>
    Response.json({ Layers: [{ LayerName: 'tools' }] });
  versionsAnswer: (marker: string | null) => Response | Promise<Response> = () =>
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

function open() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`${PATH}?tab=configuration`]}>
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

const page = createWrapper(document.body);
const ATTACHED_LOADING = 'Loading attached layers…';

function required<T>(value: T | null | undefined, label: string): T {
  if (value == null) throw new Error(`Expected ${label}.`);
  return value;
}

function layersTable() {
  return page
    .findAllTables()
    .find((table) => table.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Layers');
}

function functionDescription() {
  const overview = page
    .findAllContainers()
    .find(
      (container) =>
        container.findHeader()?.findHeader()?.findHeadingText().getElement().textContent === 'Function overview',
    );
  const pair = overview?.findContent().findKeyValuePairs()?.findItems()[0];
  expect(pair?.findLabel()?.getElement()).toHaveTextContent('Description');
  return required(pair?.findValue(), 'the function description').getElement();
}

async function expectUpdatedDescription() {
  await waitFor(() => {
    const description = functionDescription();
    expect(description).toBeVisible();
    expect(description).toHaveTextContent(UPDATED_DESCRIPTION);
  });
}

function addButton() {
  const button = layersTable()?.findHeaderSlot()?.findHeader()?.findActions()?.findButton();
  const element = required(button, 'the Layers header action').getElement();
  expect(element).toHaveAccessibleName(ADD);
  return element;
}

async function visibleDialog(title: string) {
  return waitFor(() => {
    const dialog = required(page.findModal(), 'the layer dialog');
    expect(dialog.isVisible()).toBe(true);
    expect(dialog.findHeader().getElement()).toHaveTextContent(title);
    return dialog;
  });
}

async function openAdd() {
  await waitFor(() => expect(addButton()).toBeEnabled());
  fireEvent.click(addButton());
  return visibleDialog(ADD);
}

function dialogButton(dialog: ModalWrapper, index: number, action: string) {
  const element = required(dialog.findFooter()?.findAllButtons()[index], action).getElement();
  expect(element).toHaveAccessibleName(action);
  return element;
}

function dialogSubmit(dialog: ModalWrapper, action = ADD) {
  return dialogButton(dialog, 1, action);
}

function cancelDialog(dialog: ModalWrapper) {
  fireEvent.click(dialogButton(dialog, 0, 'Cancel'));
}

type Picker = 'Layer name' | 'Version';

function picker(dialog: ModalWrapper, label: Picker) {
  const field = required(dialog.findContent().findAllFormFields()[label === 'Layer name' ? 0 : 1], label);
  expect(field.findLabel()?.getElement()).toHaveTextContent(label);
  return required(field.findControl()?.findSelect(), `the ${label} selector`);
}

async function choose(dialog: ModalWrapper, label: Picker, value: string, selectedLabel: string) {
  const select = picker(dialog, label);
  const trigger = select.findTrigger().getElement();
  await waitFor(() => expect(trigger).toBeEnabled());
  select.openDropdown();
  select.selectOptionByValue(value);
  expect(trigger).toHaveTextContent(selectedLabel);
}

const chooseLayer = (dialog: ModalWrapper) => choose(dialog, 'Layer name', 'tools', 'tools');
const chooseVersion = (dialog: ModalWrapper) => choose(dialog, 'Version', OLDER, '1');

async function chooseOlderVersion(dialog: ModalWrapper) {
  await chooseLayer(dialog);
  await chooseVersion(dialog);
}

async function nextPage(dialog: ModalWrapper, index: number, label: string) {
  const pagination = await waitFor(() => required(dialog.findContent().findAllPaginations()[index], label));
  expect(pagination.getElement()).toHaveAccessibleName(label);
  fireEvent.click(pagination.findNextPageButton().getElement());
}

function attachedArns() {
  const table = required(layersTable(), 'the attached layers table');
  return table.findRows().map((_, index) => table.findBodyCell(index + 1, 1)?.getElement().textContent);
}

function removeButton(layer: string) {
  const row = attachedArns().indexOf(layer) + 1;
  const button = required(layersTable()?.findBodyCell(row, 2)?.findButton(), `the Remove action for ${layer}`);
  const element = button.getElement();
  expect(element).toHaveAccessibleName(`${REMOVE} ${layer}`);
  return element;
}

async function openRemove(layer: string) {
  fireEvent.click(await waitFor(() => removeButton(layer)));
  const dialog = await visibleDialog(REMOVE);
  expect(dialog.findContent().getElement()).toHaveTextContent(layer);
  return dialog;
}

async function expectAttached(layers: readonly string[]) {
  await waitFor(() => expect(attachedArns()).toEqual(layers));
}

function emptySlot() {
  return layersTable()?.findEmptySlot();
}

async function expectEmpty() {
  await waitFor(() => {
    const empty = required(emptySlot(), 'the attached layers empty state').getElement();
    expect(empty).toBeVisible();
    expect(empty).toHaveTextContent(EMPTY);
  });
}

function expectLoading() {
  const loading = required(layersTable()?.findLoadingText(), 'the attached layers loading state').getElement();
  expect(loading).toBeVisible();
  expect(loading).toHaveTextContent(ATTACHED_LOADING);
}

async function expectReadFailure(scope: () => ElementWrapper | undefined | null, header: string, content: RegExp) {
  return waitFor(() => {
    const alert = required(scope()?.findAlert(), header);
    const heading = required(alert.findHeader(), 'the read alert header').getElement();
    expect(heading).toBeVisible();
    expect(heading).toHaveTextContent(header);
    const detail = alert.findContent().getElement();
    expect(detail).toBeVisible();
    expect(detail).toHaveTextContent(content);
    const button = required(alert.findActionSlot()?.findButton(), 'Retry').getElement();
    expect(button).toHaveAccessibleName('Retry');
    return button;
  });
}

type FlashType = 'success' | 'error' | 'info';

function flashItems(type: FlashType) {
  return page.findFlashbar()?.findItemsByType(type) ?? [];
}

function expectFlash(type: FlashType, content: string | RegExp, header?: string) {
  const item = required(flashItems(type)[0], `the ${type} Flashbar item`);
  const detail = required(item.findContent(), 'the flash content').getElement();
  expect(detail).toBeVisible();
  expect(detail).toHaveTextContent(content);
  if (header !== undefined) {
    const heading = required(item.findHeader(), 'the flash header').getElement();
    expect(heading).toBeVisible();
    expect(heading).toHaveTextContent(header);
  }
}

it('shows loading and a retryable attached-layer error before showing a successful empty result', async () => {
  const held = holdRead();
  engine.attachedAnswer = vi
    .fn()
    .mockReturnValueOnce(held.promise)
    .mockImplementation(() => Response.json({}));
  open();

  await waitFor(expectLoading);
  expect(emptySlot()?.getElement().textContent ?? '').not.toContain(EMPTY);
  await act(() => held.resolve(error(400, 'InvalidParameterValueException')));
  const retry = await expectReadFailure(
    emptySlot,
    'Could not load attached layers.',
    /GetFunctionConfiguration returned InvalidParameterValueException/,
  );
  expect(emptySlot()?.getElement().textContent ?? '').not.toContain(EMPTY);

  fireEvent.click(retry);
  await expectEmpty();
  expect(engine.count(CONFIG)).toBe(2);
});

it('keeps a concurrent-update refusal through both rereads', async () => {
  engine.attached = [FIRST];
  engine.updateAnswer = () => {
    engine.description = UPDATED_DESCRIPTION;
    engine.attached = [];
    return error(409, 'ResourceConflictException', 'Another update is in progress.');
  };
  open();
  await expectAttached([FIRST]);
  const dialog = await openAdd();
  await chooseOlderVersion(dialog);

  fireEvent.click(dialogSubmit(dialog));
  const message = /UpdateFunctionConfiguration returned ResourceConflictException\. Another update is in progress\./;
  await waitFor(() => expectFlash('error', message, 'Could not add layer version.'));
  await waitFor(() => expect(engine.count(FUNCTION)).toBe(2));
  await waitFor(() => expect(engine.count(CONFIG)).toBe(2));
  await expectUpdatedDescription();
  await expectEmpty();
  expectFlash('error', message, 'Could not add layer version.');
  expect(flashItems('success')).toHaveLength(0);
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
  expect(picker(dialog, 'Version').findTrigger().getElement()).toBeDisabled();
  expect(picker(dialog, 'Version').findPlaceholder()?.getElement()).toHaveTextContent('Select a layer first');
  await nextPage(dialog, 0, 'Layer name pages');
  await chooseLayer(dialog);
  await nextPage(dialog, 1, 'Version pages');
  await chooseVersion(dialog);
  fireEvent.click(dialogSubmit(dialog));

  await expectAttached([FIRST, MIDDLE, OLDER]);
  expect(engine.updates).toEqual([{ Layers: [FIRST, MIDDLE, OLDER] }]);
  await expectUpdatedDescription();
  expectFlash('success', 'Layer version added.');
});

it('cancels removal without a request, then removes the middle version without reordering the others', async () => {
  engine.attached = [FIRST, MIDDLE, LAST];
  open();
  const cancelled = await openRemove(MIDDLE);
  cancelDialog(cancelled);
  expect(engine.updates).toEqual([]);
  await expectAttached([FIRST, MIDDLE, LAST]);

  const confirmed = await openRemove(MIDDLE);
  fireEvent.click(dialogSubmit(confirmed, REMOVE));
  await expectAttached([FIRST, LAST]);
  expect(engine.updates).toEqual([{ Layers: [FIRST, LAST] }]);
  await expectUpdatedDescription();
  expectFlash('success', 'Layer version removed.');
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
    await waitFor(() => expectFlash('success', success));
    await waitFor(() => expect(page.findModal()).toBeNull());
    await waitFor(() => expect(engine.count(CONFIG)).toBe(2));
    await waitFor(() => expect(engine.count(URL_CONFIG)).toBe(2));

    const attachedReady = async () => {
      await act(async () => heldAttached.resolve(await originalAttached()));
      await expectAttached(action === 'add' ? [FIRST, OLDER] : []);
      if (action === 'remove') await expectEmpty();
    };
    const detailReady = async () => {
      await act(() => heldUrl.resolve(error(404, 'ResourceNotFoundException')));
      await expectUpdatedDescription();
    };
    if (first === 'attachment') {
      await attachedReady();
      expect(functionDescription()).not.toHaveTextContent(UPDATED_DESCRIPTION);
      expectFlash('success', success);
      await detailReady();
    } else {
      await detailReady();
      expectLoading();
      expectFlash('success', success);
      await attachedReady();
    }
    expectFlash('success', success);
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
  expect(layersTable()).toBeUndefined();
  expectFlash(
    'error',
    /UpdateFunctionConfiguration returned ResourceNotFoundException\. Function no longer exists\./,
    'Could not remove layer version.',
  );
});

it('disables addition and removal while the function is updating', async () => {
  engine.attached = [FIRST];
  engine.state = 'InProgress';
  open();
  const remove = await waitFor(() => removeButton(FIRST));
  expect(addButton()).toHaveAttribute('aria-disabled', 'true');
  expect(remove).toHaveAttribute('aria-disabled', 'true');
  fireEvent.click(addButton());
  fireEvent.click(remove);
  expect(page.findModal()).toBeNull();
  expect(engine.updates).toEqual([]);
});

describe.each([
  { label: 'Layer name', resource: 'layers', operation: 'ListLayers', path: LAYERS, mock: 'layerAnswer' },
  {
    label: 'Version',
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
    if (path === VERSIONS) await chooseLayer(dialog);

    const retry = await expectReadFailure(
      () => dialog.findContent(),
      `Could not load ${resource}.`,
      new RegExp(`${operation} returned InvalidParameterValueException`),
    );
    expect(picker(dialog, label).findTrigger().getElement()).toBeDisabled();
    expect(dialogSubmit(dialog)).toBeDisabled();
    const other = path === LAYERS ? VERSIONS : LAYERS;
    const otherCount = engine.count(other);
    fireEvent.click(retry);
    await waitFor(() => expect(picker(dialog, label).findTrigger().getElement()).toBeEnabled());
    expect(engine.count(path)).toBe(2);
    expect(engine.count(other)).toBe(otherCount);
    if (path === LAYERS) await chooseLayer(dialog);
    await chooseVersion(dialog);
    expect(dialogSubmit(dialog)).toBeEnabled();
  });

  it('keeps the 501 notice and disabled controls when Configuration unmounts and reopens', async () => {
    engine[mock] = () => error(501, 'NotImplemented');
    open();
    const dialog = await openAdd();
    if (path === VERSIONS) await chooseLayer(dialog);

    const header = 'Not implemented by the emulator';
    const message = new RegExp(`The emulator answered 501 Not Implemented for ${operation}\\.`);
    const retry = await expectReadFailure(() => dialog.findContent(), header, message);
    expect(picker(dialog, label).findTrigger().getElement()).toBeDisabled();
    expect(dialogSubmit(dialog)).toBeDisabled();
    const attempts = engine.count(path);
    expect(retry).toBeDisabled();
    fireEvent.click(retry);
    fireEvent.click(dialogSubmit(dialog));
    cancelDialog(dialog);
    const tabs = required(page.findTabs(), 'function tabs');
    fireEvent.click(required(tabs.findTabLinkById('code'), 'the Code tab').getElement());
    await waitFor(() => expect(layersTable()).toBeUndefined());
    fireEvent.click(required(tabs.findTabLinkById('configuration'), 'the Configuration tab').getElement());
    const reopened = await openAdd();
    if (path === VERSIONS) await chooseLayer(reopened);
    const reopenedRetry = await expectReadFailure(() => reopened.findContent(), header, message);
    expect(picker(reopened, label).findTrigger().getElement()).toBeDisabled();
    expect(dialogSubmit(reopened)).toBeDisabled();
    expect(reopenedRetry).toBeDisabled();
    expect(engine.count(path)).toBe(attempts);
    expect(engine.updates).toEqual([]);
  });
});

it('keeps attached-layer retry and addition disabled after a 501, including a page refresh', async () => {
  engine.attachedAnswer = () => error(501, 'NotImplemented');
  open();
  const header = 'Not implemented by the emulator';
  const message = /The emulator answered 501 Not Implemented for GetFunctionConfiguration\./;
  const retry = await expectReadFailure(emptySlot, header, message);
  const attempts = engine.count(CONFIG);
  expect(retry).toBeDisabled();
  expect(addButton()).toBeDisabled();
  fireEvent.click(retry);
  fireEvent.click(addButton());
  const refresh = page.findContentLayout()?.findHeader()?.findHeader()?.findActions()?.findButton();
  const refreshElement = required(refresh, 'Refresh').getElement();
  expect(refreshElement).toHaveAccessibleName('Refresh');
  fireEvent.click(refreshElement);
  await waitFor(() => expect(engine.count(FUNCTION)).toBe(2));
  await expectReadFailure(emptySlot, header, message);
  expect(page.findModal()).toBeNull();
  expect(engine.count(CONFIG)).toBe(attempts);
});

it('keeps both mutation actions visible and disabled after an update 501', async () => {
  engine.attached = [FIRST];
  engine.updateAnswer = () => error(501, 'NotImplemented');
  open();
  const dialog = await openRemove(FIRST);
  fireEvent.click(dialogSubmit(dialog, REMOVE));
  await waitFor(() =>
    expectFlash(
      'info',
      /The emulator answered 501 Not Implemented for UpdateFunctionConfiguration\./,
      'Not implemented by the emulator',
    ),
  );
  await waitFor(() => expect(page.findModal()).toBeNull());

  const attempts = engine.count(CONFIG, 'PUT');
  for (const button of [addButton(), removeButton(FIRST)]) {
    expect(button).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(button);
  }
  expect(page.findModal()).toBeNull();
  expect(engine.count(CONFIG, 'PUT')).toBe(attempts);
  await expectAttached([FIRST]);
});
