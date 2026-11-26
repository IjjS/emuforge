import type { ProtocolType } from '@aws-sdk/client-apigatewayv2';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import { AreaFlash } from '../../../components/area-flash';
import { creationDateText } from '../../../components/format-date';
import { PageFlashContext } from '../../../components/page-flash';
import { useAreaFlash } from '../../../components/use-area-flash';
import { getV2Api, type V2ApiRead } from '../v2-api';
import { useV2Api } from '../v2-queries';
import { updateV2Api } from '../v2-route-change-api';
import { V2Details } from './v2-details';

const ui = createWrapper(document.body);

it.each([
  ['HTTP', 'HTTP'],
  ['WEBSOCKET', 'WebSocket'],
] as const)(
  'shows the API metadata and lets the developer copy its ID and endpoint for %s',
  async (ProtocolType, protocol) => {
    const user = userEvent.setup();
    const CreatedDate = new Date('2026-11-26T12:00:00Z');
    const ApiEndpoint = 'https://127.0.0.1:9323/_aws/execute-api/api-1';
    const onRefresh = vi.fn();
    render(
      <V2Details
        id="api-1"
        endpoint={undefined}
        api={{ ApiId: 'api-1', Name: 'Events', ProtocolType, Description: 'Collects events', ApiEndpoint, CreatedDate }}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    const values = ui
      .findKeyValuePairs()
      ?.findItems()
      .map((item) => item.findValue()?.getElement());
    for (const [index, text] of [
      'Events',
      'api-1',
      protocol,
      'Collects events',
      ApiEndpoint,
      creationDateText(CreatedDate),
    ].entries()) {
      expect(values?.[index]).toHaveTextContent(text);
    }
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Copy API ID' }));
    expect(await navigator.clipboard.readText()).toBe('api-1');
    await user.click(screen.getByRole('button', { name: 'Copy API endpoint' }));
    expect(await navigator.clipboard.readText()).toBe(ApiEndpoint);
    await user.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onRefresh).toHaveBeenCalledOnce();
  },
);

vi.mock('../v2-api', { spy: true });
vi.mock('../v2-route-change-api', { spy: true });

const id = 'api-1';
const endpoint = 'http://127.0.0.1:9681';
const reader = vi.mocked(getV2Api);
const earlierFields = { Name: 'Events', Description: 'Early events' };
const savedFields = { Name: 'New events', Description: 'Latest events' };

function DetailsWithRead() {
  const read = useV2Api(endpoint, id);
  const { shown, pageFlash, dismiss, announce } = useAreaFlash('/v2/api-1', 0, true);

  return (
    <PageFlashContext value={pageFlash}>
      {shown && <AreaFlash result={shown} onDismiss={dismiss} onAnnounce={announce} />}
      {read.value?.found && (
        <V2Details api={read.value.api} id={id} endpoint={endpoint} onRefresh={() => void read.refresh()} />
      )}
    </PageFlashContext>
  );
}

async function openEdit(ProtocolType: ProtocolType, beforeOpen?: () => Promise<void>) {
  const earlier: V2ApiRead = { found: true, api: { ProtocolType, ...earlierFields } };
  const saved: V2ApiRead = { found: true, api: { ProtocolType, ...savedFields } };
  reader.mockReset().mockResolvedValueOnce(earlier);
  vi.mocked(updateV2Api).mockResolvedValueOnce({ ...savedFields, $metadata: {} });
  const user = userEvent.setup();
  const root = { current: null };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <AreaRootContext value={root}>
        <div ref={root}>
          <MemoryRouter>
            <DetailsWithRead />
          </MemoryRouter>
        </div>
      </AreaRootContext>
    </QueryClientProvider>,
  );
  const edit = await screen.findByRole('button', { name: 'Edit' });
  await beforeOpen?.();
  await user.click(edit);
  const modal = await waitFor(() => {
    const dialog = ui.findModal();
    if (!dialog?.isVisible()) throw new Error('Dialog is not visible');
    return dialog;
  });
  const footer = modal.findFooter()?.getElement();
  if (!footer) throw new Error('Missing dialog footer');
  expect(modal.findHeader().getElement()).toHaveTextContent('Edit API');
  const [name, description] = createWrapper(modal.findContent().getElement()).findAllFormFields();
  for (const [input, value] of [
    [name && createWrapper(name.getElement()).findInput()?.findNativeInput().getElement(), savedFields.Name],
    [
      description && createWrapper(description.getElement()).findTextarea()?.findNativeTextarea().getElement(),
      savedFields.Description,
    ],
  ] as const) {
    if (!input) throw new Error('Missing API edit field');
    await user.clear(input);
    await user.type(input, value);
  }
  return {
    earlier,
    saved,
    save: () => user.click(within(footer).getByRole('button', { name: 'Save' })),
  };
}

function expectUpdateFlash() {
  expect(ui.findFlashbar()?.findItemsByType('success')[0]?.getElement()).toHaveTextContent('API New events updated.');
}

function expectSaved() {
  expect(ui.findModal()).toBeNull();
  const items = ui.findKeyValuePairs()?.findItems();
  expect(items?.[0]?.findValue()?.getElement()).toHaveTextContent(savedFields.Name);
  expect(items?.[3]?.findValue()?.getElement()).toHaveTextContent(savedFields.Description);
  expectUpdateFlash();
}

it.each(['HTTP', 'WEBSOCKET'] as const)(
  'shows the saved name and description after reading the %s API again',
  async (protocol) => {
    const { save, saved } = await openEdit(protocol);
    reader.mockResolvedValueOnce(saved);
    await save();
    await waitFor(expectSaved);
    expect(reader).toHaveBeenCalledTimes(2);
  },
);

function deferredRead() {
  let resolve!: (value: V2ApiRead) => void;
  const promise = new Promise<V2ApiRead>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

it.each(['earlier', 'saved'] as const)(
  'keeps the new details and flash when the %s read answers first',
  async (first) => {
    const earlierRead = deferredRead();
    const savedRead = deferredRead();
    const { save, earlier, saved } = await openEdit('HTTP', async () => {
      reader.mockReturnValueOnce(earlierRead.promise).mockReturnValueOnce(savedRead.promise);
      await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
    });
    await save();
    await waitFor(() => {
      expectUpdateFlash();
      expect(reader).toHaveBeenCalledTimes(3);
    });
    expect(reader.mock.calls[1]?.[2].aborted).toBe(true);
    const replies = {
      earlier: () => earlierRead.resolve(earlier),
      saved: () => savedRead.resolve(saved),
    };
    await act(async () => replies[first]());
    expectUpdateFlash();
    await act(async () => replies[first === 'earlier' ? 'saved' : 'earlier']());
    await waitFor(expectSaved);
  },
);
