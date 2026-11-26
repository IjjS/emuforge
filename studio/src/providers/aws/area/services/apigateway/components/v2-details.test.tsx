import type { ProtocolType } from '@aws-sdk/client-apigatewayv2';
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
    const { container } = render(
      <V2Details
        id="api-1"
        endpoint={undefined}
        api={{ ApiId: 'api-1', Name: 'Events', ProtocolType, Description: 'Collects events', ApiEndpoint, CreatedDate }}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    for (const text of ['Events', 'api-1', protocol, 'Collects events', ApiEndpoint, creationDateText(CreatedDate)]) {
      expect(container).toHaveTextContent(text);
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
  const dialog = within(await screen.findByRole('dialog', { name: 'Edit API' }));
  for (const [field, value] of [
    ['Name', savedFields.Name],
    ['Description', savedFields.Description],
  ] as const) {
    const input = dialog.getByRole('textbox', { name: field });
    await user.clear(input);
    await user.type(input, value);
  }
  return { earlier, saved, save: () => user.click(dialog.getByRole('button', { name: 'Save' })) };
}

function expectSaved() {
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(screen.getByText(savedFields.Description)).toBeVisible();
  expect(screen.getAllByText(savedFields.Name)).toHaveLength(2);
  expect(screen.getByRole('list', { name: 'Notifications' })).toHaveTextContent('API New events updated.');
  expect(screen.queryByText(earlierFields.Name)).not.toBeInTheDocument();
  expect(screen.queryByText(earlierFields.Description)).not.toBeInTheDocument();
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

it('keeps the new details and flash when a read started before saving answers last', async () => {
  let answerEarlier!: (value: V2ApiRead) => void;
  const { save, earlier } = await openEdit('HTTP', async () => {
    reader
      .mockReturnValueOnce(
        new Promise<V2ApiRead>((resolve) => {
          answerEarlier = resolve;
        }),
      )
      .mockResolvedValueOnce({ found: true, api: savedFields });
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(reader).toHaveBeenCalledTimes(2));
  });
  await save();
  await waitFor(expectSaved);
  expect(reader.mock.calls[1]?.[2].aborted).toBe(true);
  await act(async () => answerEarlier(earlier));
  expectSaved();
});
