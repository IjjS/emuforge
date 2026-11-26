import type { Stage } from '@aws-sdk/client-api-gateway';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';

import { RequestError, type RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { creationDateText } from '../../../components/format-date';
import { readRestStages, readStageAddress } from '../rest-api';
import { RestStages } from './rest-stages';

vi.mock('../rest-api', { spy: true });

const apiId = 'api-1';
const engineOrigin = 'http://127.0.0.1:9681';
const endpoint = 'https://127.0.0.1:9682';
const connection: AreaConnection = {
  engineOrigin,
  result: { kind: 'connected', checkedAt: 1, emulator: { port: 9682, endpoint } },
};
const changed = new Date('2026-11-26T12:00:00Z');
const stages: Stage[] = [
  { stageName: 'dev', deploymentId: 'deploy-dev', lastUpdatedDate: changed },
  { stageName: 'prod', deploymentId: 'deploy-prod' },
];
const invokeUrl = (stage: string) => `${endpoint}/_aws/execute-api/${apiId}/${stage}`;
const readStages = vi.mocked(readRestStages);
const readAddress = vi.mocked(readStageAddress);

beforeEach(() => {
  readStages.mockReset();
  readAddress.mockReset();
  readStages.mockResolvedValue(stages);
  readAddress.mockImplementation(async (_, __, name) => invokeUrl(name));
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
});

function open() {
  const user = userEvent.setup();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RestStages apiId={apiId} connection={connection} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return user;
}

function row(name: string) {
  return within(screen.getByRole('row', { name: new RegExp(`^${name} `) }));
}

it('shows stages, deployment IDs, last change and copyable invoke URLs as plain text', async () => {
  const user = open();
  await screen.findByRole('rowheader', { name: 'dev' });
  expect(
    screen.getByText(
      'A stage serves the API as it was when last deployed. Deploy again after you change resources or methods.',
    ),
  ).toBeInTheDocument();
  expect(row('dev').getByText('deploy-dev')).toBeInTheDocument();
  expect(row('dev').getByRole('cell', { name: /November/ })).toHaveTextContent(creationDateText(changed));
  await user.click(row('dev').getByRole('button', { name: 'Copy Deployment ID' }));
  expect(await navigator.clipboard.readText()).toBe('deploy-dev');

  const copyAddress = await row('dev').findByRole('button', { name: 'Copy Invoke URL' });
  expect(row('dev').getByRole('cell', { name: new RegExp('execute-api') })).toHaveTextContent(invokeUrl('dev'));
  expect(row('dev').queryByRole('link')).not.toBeInTheDocument();
  await user.click(copyAddress);
  expect(await navigator.clipboard.readText()).toBe(invokeUrl('dev'));
});

it('shows why a stage is needed when none exist', async () => {
  readStages.mockResolvedValue([]);
  open();
  expect(await screen.findByText('No stages')).toBeVisible();
  expect(screen.getByText('Deploy the API to a stage to get an invoke URL.')).toBeVisible();
  expect(readAddress).not.toHaveBeenCalled();
});

it.each<[RequestFailure, string]>([
  [{ kind: 'not-implemented', operation: 'GetExport' }, 'Not implemented by the emulator'],
  [{ kind: 'access-denied', operation: 'GetExport', message: 'Export is refused.' }, 'Access denied'],
  [
    { kind: 'other', operation: 'GetExport', code: 'BadRequestException', message: 'Invalid export.' },
    'The invoke URL could not be read',
  ],
  [{ kind: 'emulator-did-not-answer', operation: 'GetExport', message: 'Timeout' }, `Not answering at ${endpoint}`],
  [
    { kind: 'engine-did-not-answer', operation: 'GetExport' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
  ],
])('keeps healthy addresses and refreshes every stage address after %j', async (failure, first) => {
  let failDev = true;
  readAddress.mockImplementation(async (_, __, name) => {
    if (name === 'dev' && failDev) throw new RequestError(failure);
    return invokeUrl(name);
  });
  const user = open();
  await screen.findByRole('rowheader', { name: 'dev' });
  await row('dev').findByText('GetExport');
  expect(row('dev').getByRole('cell', { name: /GetExport/ })).toHaveTextContent(first);
  expect(row('dev').queryByRole('button', { name: 'Copy Invoke URL' })).not.toBeInTheDocument();
  expect(await row('prod').findByRole('button', { name: 'Copy Invoke URL' })).toBeEnabled();
  expect(row('prod').getByRole('cell', { name: /execute-api/ })).toHaveTextContent(invokeUrl('prod'));
  failDev = false;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await row('dev').findByRole('button', { name: 'Copy Invoke URL' })).toBeEnabled();
  expect(row('dev').getByRole('cell', { name: /execute-api/ })).toHaveTextContent(invokeUrl('dev'));
  expect(readStages).toHaveBeenCalledTimes(2);
  for (const stage of ['dev', 'prod']) {
    expect(readAddress.mock.calls.filter(([, , name]) => name === stage)).toHaveLength(2);
  }
});

it.each<[RequestFailure, string, string]>([
  [
    { kind: 'not-implemented', operation: 'GetStages' },
    'Not implemented by the emulator',
    '501 Not Implemented for GetStages',
  ],
  [
    { kind: 'access-denied', operation: 'GetStages', message: 'Stages refused.' },
    'Access denied',
    'GetStages was refused: Stages refused.',
  ],
  [
    { kind: 'other', operation: 'GetStages', code: 'BadRequestException', message: 'Invalid API' },
    'The stages could not be read',
    'GetStages: BadRequestException: Invalid API',
  ],
  [
    { kind: 'emulator-did-not-answer', operation: 'GetStages', message: 'Timeout.' },
    `Not answering at ${endpoint}`,
    'GetStages got no answer from the emulator. Timeout.',
  ],
  [
    { kind: 'engine-did-not-answer', operation: 'GetStages' },
    `The EmuForge engine at ${engineOrigin} is not answering`,
    'GetStages got no answer.',
  ],
])('shows the failed GetStages state and retries it (%j)', async (failure, first, detail) => {
  readStages.mockRejectedValueOnce(new RequestError(failure));
  const user = open();
  const table = within(screen.getByRole('table', { name: 'Stages' }));
  await table.findByText(detail, { exact: false });
  expect(table.getByRole('row', { name: /GetStages/ })).toHaveTextContent(first);
  await user.click(table.getByRole('button', { name: 'Retry' }));
  expect(await table.findByRole('rowheader', { name: 'dev' })).toBeVisible();
});
