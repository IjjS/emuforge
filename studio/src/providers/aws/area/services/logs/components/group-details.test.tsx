import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { listLogGroupTags } from '../api';
import { useLogGroupTags } from '../queries';
import { GroupDetails } from './group-details';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listLogGroupTags: vi.fn(),
}));

const operation = 'ListTagsLogGroup';
const emulator = { port: 9310, endpoint: 'https://127.0.0.1:9310' };
const engineOrigin = 'http://127.0.0.1:8310';
const connected = { kind: 'connected', checkedAt: 0, emulator } as const;
const unreachable = (reason: string): AreaConnection['result'] => ({
  kind: 'emulator-unreachable',
  checkedAt: 0,
  emulator,
  reason,
  message: '',
});
const failures: [string, RequestFailure, AreaConnection['result'], string][] = [
  ['501', { kind: 'not-implemented', operation }, connected, `501 Not Implemented for ${operation}`],
  [
    'access denied',
    { kind: 'access-denied', operation, message: 'policy refusal' },
    connected,
    `${operation} was refused: policy refusal`,
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

const group = {
  logGroupName: '/app#Group',
  logGroupArn: 'arn:aws:logs:us-east-1:000000000000:log-group:/app#Group',
  logGroupClass: 'INFREQUENT_ACCESS',
  retentionInDays: 7,
  deletionProtectionEnabled: true,
  creationTime: Date.UTC(2026, 10, 26, 12),
} satisfies LogGroup;
const read = vi.mocked(listLogGroupTags);

beforeEach(() => read.mockReset());

function Details({ connection }: { connection: AreaConnection }) {
  const tags = useLogGroupTags(connection.engineOrigin, group.logGroupName);
  return <GroupDetails connection={connection} group={group} tags={tags} />;
}

function renderDetails(result: AreaConnection['result'] = connected) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={new QueryClient()}>
        <Details connection={{ engineOrigin, result }} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it('shows the group values, the copy control, and tag keys and values as text', async () => {
  const value = '<a href="/aws">example</a>';
  read.mockResolvedValueOnce({ team: value });
  const { container } = renderDetails();
  expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeVisible();
  expect(container).toHaveTextContent(group.logGroupArn);
  expect(screen.getByText('Infrequent')).toBeVisible();
  expect(screen.getByText('Access')).toBeVisible();
  expect(screen.getByText('7')).toBeVisible();
  expect(screen.getByText('days')).toBeVisible();
  expect(screen.getByText('On')).toBeVisible();
  expect(container).toHaveTextContent(creationDateText(new Date(group.creationTime)));
  expect(await screen.findByText('team')).toBeVisible();
  expect(screen.getByText(value)).toBeVisible();
  expect(screen.queryByRole('link', { name: 'example' })).not.toBeInTheDocument();
  expect(read).toHaveBeenCalledWith(engineOrigin, group.logGroupName, expect.any(AbortSignal));
});

it.each(failures)(
  'shows %s in Tags, keeps the details, and retries the tags read',
  async (_label, failure, result, text) => {
    read.mockRejectedValueOnce(new RequestError(failure)).mockResolvedValueOnce({ retried: 'tag-value' });
    const { container } = renderDetails(result);
    const tags = createWrapper(container).findTable()?.getElement();
    await waitFor(() => expect(tags).toHaveTextContent(text));
    if (failure.kind === 'not-implemented') expect(tags).toHaveTextContent('Not implemented by the emulator');
    expect(screen.getByRole('button', { name: 'Copy ARN' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('tag-value')).toBeVisible();
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(engineOrigin, group.logGroupName, expect.any(AbortSignal));
  },
);
