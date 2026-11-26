import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { aws, boxText, buttonIn, waitForLink } from '../../../../../../test/logs-test-utils';
import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { areaPage } from '../../../area-page';
import type { AreaConnection } from '../../../components/emulator-line';
import { getLogGroup, listLogGroups } from '../api';
import { LOG_STREAMS_PATH } from '../format';
import { listLogStreams } from '../stream-api';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  getLogGroup: vi.fn(),
  listLogGroups: vi.fn(),
}));
vi.mock('../stream-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));

const operation = 'DescribeLogGroups';
const engineOrigin = 'http://127.0.0.1:8310';
const emulator = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});
const group = '/app#Group';
const found = { kind: 'found', group: { logGroupName: group } } as const;
const groups = vi.mocked(listLogGroups);
const streamTable = () => aws().findTable();
const lookup = vi.mocked(getLogGroup);
const streams = vi.mocked(listLogStreams);

const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  [
    '501',
    { kind: 'not-implemented', operation },
    connected,
    `Not implemented by the emulator. The emulator answered 501 Not Implemented for ${operation}.`,
  ],
  [
    'access denied',
    { kind: 'access-denied', operation, message: 'policy refusal' },
    connected,
    `Access denied. ${operation} was refused: policy refusal`,
  ],
  [
    'emulator not started',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('not_started'),
    'Not started on port 9310',
  ],
  [
    'emulator not answering',
    { kind: 'emulator-did-not-answer', operation, message: '' },
    unreachable('timeout'),
    `Not answering at ${emulator.endpoint}`,
  ],
  [
    'engine not answering',
    { kind: 'engine-did-not-answer', operation },
    { kind: 'engine-unreachable', checkedAt: 0, lastEmulatorPort: emulator.port },
    `The EmuForge engine at ${engineOrigin} is not answering`,
  ],
  [
    'other refusal',
    { kind: 'other', operation, code: 'InvalidParameterException', message: 'request refused' },
    connected,
    'InvalidParameterException: request refused',
  ],
];

beforeEach(() => {
  lookup.mockReset().mockResolvedValue(found);
  groups.mockReset().mockResolvedValue({ items: [found.group] });
  streams.mockReset().mockResolvedValue({ items: [{ logStreamName: 'some stream' }] });
});

function Location() {
  return <output aria-label="Address">{useLocation().search}</output>;
}

function renderPage(search = '', result: AreaConnection['result'] = connected) {
  const route = areaPage(LOG_STREAMS_PATH);
  if (route.kind !== 'screen') throw new Error('The Log streams screen is not registered.');
  const {
    params,
    screen: { Page },
  } = route;
  const { container } = render(
    <MemoryRouter initialEntries={[`${LOG_STREAMS_PATH}${search}`]}>
      <QueryClientProvider client={new QueryClient()}>
        <Page params={params} connection={{ engineOrigin, result }} />
        <Location />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  const select = createWrapper(container).findSelect();
  if (select === null) throw new Error('The log group choice is missing.');
  return select;
}

it('asks for a group before reading any streams, then writes the choice to the address and lists its streams', async () => {
  const select = renderPage();
  expect(boxText(aws(), 'Choose a log group.')).toBeVisible();
  expect(lookup).not.toHaveBeenCalled();
  expect(streams).not.toHaveBeenCalled();

  select.openDropdown();
  await waitFor(() => expect(select.findDropdown().findOptionByValue(group)?.getElement()).toBeVisible());
  select.selectOptionByValue(group);
  expect(await waitForLink(streamTable, 'some stream')).toBeVisible();
  expect(boxText(aws(), 'Choose a log group.') ?? null).not.toBeInTheDocument();
  expect(screen.getByLabelText('Address')).toHaveTextContent('?group=%2Fapp%23Group');
  expect(streams).toHaveBeenCalledWith(engineOrigin, group, '', undefined, expect.any(AbortSignal));
});

it('selects the group from a direct address and lists its streams without mutation controls', async () => {
  const select = renderPage('?group=%2Fapp%23Group');
  expect(select.findTrigger().getElement()).toHaveTextContent(group);
  expect(await waitForLink(streamTable, 'some stream')).toHaveAttribute(
    'href',
    '/aws/logs/log-groups/group/%2Fapp%23Group/stream/some%20stream',
  );
  expect(screen.queryByRole('button', { name: 'Create log stream' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Delete log stream' })).not.toBeInTheDocument();
  expect(streamTable()?.findRowSelectionArea(1)?.getElement() ?? null).not.toBeInTheDocument();
});

it('shows the missing group below the choice and does not read streams for it', async () => {
  lookup.mockResolvedValueOnce({ kind: 'not-found' });
  renderPage('?group=missing');
  await waitFor(() => expect(boxText(aws(), 'Log group not found', 'strong')).toBeVisible());
  expect(lookup).toHaveBeenCalledWith(engineOrigin, 'missing', expect.any(AbortSignal));
  expect(streams).not.toHaveBeenCalled();
});

it.each(failures)('shows %s in the group choices and retries the first page', async (_kind, failure, result, words) => {
  groups.mockRejectedValueOnce(new RequestError(failure));
  const select = renderPage('', result);
  select.openDropdown();
  const dropdown = select.findDropdown();
  await waitFor(() =>
    expect(select.findStatusIndicator()?.getElement()).toHaveTextContent(
      `The log groups could not be loaded: ${words}`,
    ),
  );
  select.findErrorRecoveryButton()?.click();
  await waitFor(() => expect(dropdown.findOptionByValue(group)?.getElement()).toBeVisible());
  expect(groups).toHaveBeenCalledTimes(2);
  expect(groups).toHaveBeenLastCalledWith(engineOrigin, '', undefined, expect.any(AbortSignal));
});

it('keeps earlier choices when the second page fails and retries that same token', async () => {
  groups
    .mockResolvedValueOnce({ items: [found.group], next: 'second-token' })
    .mockRejectedValueOnce(new RequestError({ kind: 'other', operation, code: 'Read failed' }))
    .mockResolvedValueOnce({ items: [{ logGroupName: 'second group' }] });
  const select = renderPage();
  select.openDropdown();
  const dropdown = select.findDropdown();
  await waitFor(() => expect(dropdown.findOptionByValue(group)?.getElement()).toBeVisible());
  fireEvent.click(buttonIn(select.findDropdownFooter(), 'Load more')!);
  const retry = () => select.findErrorRecoveryButton()?.getElement();
  await waitFor(() => expect(retry()).toBeVisible());
  expect(dropdown.findOptionByValue(group)?.getElement()).toBeVisible();
  expect(select.findStatusIndicator()?.getElement()).toHaveTextContent(
    `The log groups could not be loaded: Read failed`,
  );
  fireEvent.click(retry()!);
  await waitFor(() => expect(dropdown.findOptionByValue('second group')?.getElement()).toBeVisible());
  const labels = dropdown.findOptions()?.map((option) => option.findLabel().getElement().textContent);
  expect(labels).toEqual([group, 'second group']);
  expect(groups).toHaveBeenCalledTimes(3);
  expect(groups).toHaveBeenNthCalledWith(2, engineOrigin, '', 'second-token', expect.any(AbortSignal));
  expect(groups).toHaveBeenNthCalledWith(3, engineOrigin, '', 'second-token', expect.any(AbortSignal));
});
