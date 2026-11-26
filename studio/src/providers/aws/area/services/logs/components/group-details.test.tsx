import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaLayout } from '../../../area-layout';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { getLogGroup, listLogGroupTags } from '../api';
import { logGroupPath } from '../format';
import { putRetentionPolicy } from '../group-create-api';
import { putLogGroupDeletionProtection, saveLogGroupTags } from '../group-settings-api';
import { useLogGroupTags } from '../queries';
import { listLogStreams } from '../stream-api';
import { GroupDetails } from './group-details';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listLogGroupTags: vi.fn(),
  getLogGroup: vi.fn(),
}));

vi.mock('../stream-api', async (original) => ({
  ...(await original<typeof import('../stream-api')>()),
  listLogStreams: vi.fn(),
}));
vi.mock('../group-create-api', async (original) => ({
  ...(await original<typeof import('../group-create-api')>()),
  putRetentionPolicy: vi.fn(),
}));
vi.mock('../group-settings-api', async (original) => ({
  ...(await original<typeof import('../group-settings-api')>()),
  putLogGroupDeletionProtection: vi.fn(),
  saveLogGroupTags: vi.fn(),
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

const getGroup = vi.mocked(getLogGroup);
const putRetention = vi.mocked(putRetentionPolicy);
const putProtection = vi.mocked(putLogGroupDeletionProtection);
const saveTags = vi.mocked(saveLogGroupTags);

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    matches: false,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
  vi.mocked(listLogStreams).mockResolvedValue({ items: [] });
  getGroup.mockResolvedValue({ kind: 'found', group });
  putRetention.mockResolvedValue({ $metadata: {} });
  putProtection.mockResolvedValue({ $metadata: {} });
  saveTags.mockResolvedValue(undefined);
});

afterEach(() => vi.unstubAllGlobals());

function Details({ connection }: { connection: AreaConnection }) {
  const tags = useLogGroupTags(connection.engineOrigin, group.logGroupName);
  return (
    <GroupDetails
      connection={connection}
      group={group}
      tags={tags}
      groupLoading={false}
      protectionPending={false}
      protectionUnavailable={false}
      onEditRetention={vi.fn()}
      onSwitchProtection={vi.fn()}
      onManageTags={vi.fn()}
    />
  );
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

function firstTagValue() {
  const table = createWrapper(document.body)
    .findAllTables()
    .find(
      (candidate) => candidate.findHeaderSlot()?.findHeader()?.findHeadingText().getElement().textContent === 'Tags',
    );
  return table?.findBodyCell(1, 2)?.getElement();
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
  const table = createWrapper(container).findTable();
  await waitFor(() => expect(table?.findBodyCell(1, 1)?.getElement()).toHaveTextContent('team'));
  expect(table?.findBodyCell(1, 2)?.getElement()).toHaveTextContent(value);
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
    await waitFor(() => expect(firstTagValue()).toHaveTextContent('tag-value'));
    expect(read).toHaveBeenCalledTimes(2);
    expect(read).toHaveBeenLastCalledWith(engineOrigin, group.logGroupName, expect.any(AbortSignal));
  },
);

function renderGroup() {
  render(
    <MemoryRouter initialEntries={[logGroupPath(group.logGroupName)]}>
      <QueryClientProvider client={new QueryClient()}>
        <AreaLayout
          connection={{ engineOrigin, result: connected }}
          headerSelector="#studio-header"
          onContentTarget={vi.fn()}
          onPageTitle={vi.fn()}
          routeChanges={0}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

it.each([
  [false, 'on', 'off'],
  [true, 'off', 'on'],
] as const)(
  'offers only the applicable protection action while deletion protection is %s',
  async (enabled, present, absent) => {
    getGroup.mockResolvedValue({ kind: 'found', group: { ...group, deletionProtectionEnabled: enabled } });
    read.mockResolvedValue({});
    renderGroup();
    expect(await screen.findByRole('button', { name: `Turn ${present} deletion protection` })).toBeEnabled();
    expect(screen.queryByRole('button', { name: `Turn ${absent} deletion protection` })).not.toBeInTheDocument();
  },
);

it.each([
  ['retention', `Retention of ${group.logGroupName} set to 7 days.`],
  ['protection', `Deletion protection turned off for ${group.logGroupName}.`],
  ['tags', `Tags of ${group.logGroupName} saved.`],
] as const)('shows the %s save result in the flash and reads group and tags again', async (setting, result) => {
  read.mockResolvedValueOnce({ team: 'old-tag' }).mockResolvedValue({ team: 'new-tag' });
  renderGroup();
  await waitFor(() => expect(firstTagValue()).toHaveTextContent('old-tag'));
  if (setting === 'protection') {
    fireEvent.click(screen.getByRole('button', { name: 'Turn off deletion protection' }));
    await waitFor(() =>
      expect(putProtection).toHaveBeenCalledWith(engineOrigin, group.logGroupName, false, expect.any(AbortSignal)),
    );
  } else {
    const label = setting === 'retention' ? 'Edit retention' : 'Manage tags';
    fireEvent.click(screen.getByRole('button', { name: label }));
    const dialog = within(await screen.findByRole('dialog', { name: label }));
    if (setting === 'tags') fireEvent.change(dialog.getByDisplayValue('old-tag'), { target: { value: 'new-tag' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Save' }));
  }
  expect(await screen.findByRole('list', { name: 'Notifications' })).toHaveTextContent(result);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(firstTagValue()).toHaveTextContent('new-tag'));
  expect(getGroup).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenCalledTimes(2);
});

it.each(['refused', '501'])('keeps the details when a protection switch is %s', async (kind) => {
  const operation = 'PutLogGroupDeletionProtection';
  putProtection.mockRejectedValueOnce(
    new RequestError(
      kind === '501'
        ? { kind: 'not-implemented', operation }
        : { kind: 'other', operation, code: 'InvalidParameterException', message: 'Protection refused.' },
    ),
  );
  read.mockResolvedValue({ team: 'unchanged-tag' });
  renderGroup();
  const action = await screen.findByRole('button', { name: 'Turn off deletion protection' });
  fireEvent.click(action);
  const flash = await screen.findByRole('list', { name: 'Notifications' });
  expect(flash).toHaveTextContent(operation);
  if (kind === '501') {
    expect(flash).toHaveTextContent('Not implemented by the emulator');
    expect(action).toBeDisabled();
  } else {
    expect(flash).toHaveTextContent('Protection refused.');
    expect(action).toBeEnabled();
  }
  expect(screen.getByText('On')).toBeVisible();
  await waitFor(() => expect(firstTagValue()).toHaveTextContent('unchanged-tag'));
  expect(getGroup).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledTimes(1);
});

it('keeps Manage tags unavailable while the tags are loading or failed', async () => {
  let refuseTags!: (error: RequestError) => void;
  read.mockReturnValueOnce(
    new Promise((_, reject) => {
      refuseTags = reject;
    }),
  );
  renderDetails();
  expect(screen.getByRole('button', { name: 'Manage tags' })).toHaveAttribute('aria-disabled', 'true');
  expect(screen.getByText('Loading tags')).toBeVisible();
  refuseTags(
    new RequestError({
      kind: 'other',
      operation,
      code: 'ReadFailed',
      message: 'Failed to read tags.',
    }),
  );
  expect(await screen.findByText('ReadFailed')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Manage tags' })).toBeDisabled();
});
