import type { Api, Stage } from '@aws-sdk/client-apigatewayv2';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { creationDateText } from '../../../components/format-date';
import type { AppendedPages } from '../queries';
import { V2Stages } from './v2-stages';

const connection = { engineOrigin: 'http://127.0.0.1:9681', result: undefined };
const endpoint = 'https://127.0.0.1:9323/_aws/execute-api/api-1';
const date = new Date('2026-11-26T12:00:00Z');
const defaultStage: Stage = { StageName: '$default', AutoDeploy: true, DeploymentId: 'd-1', LastUpdatedDate: date };
const devStage: Stage = { StageName: 'dev', AutoDeploy: false };

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});

afterEach(() => vi.unstubAllGlobals());

function catalog(items?: Stage[]): AppendedPages<Stage> {
  return {
    items,
    more: false,
    loading: false,
    failure: undefined,
    loadMore: vi.fn(),
    retry: vi.fn(),
    refresh: vi.fn(),
  };
}

function view(stages: AppendedPages<Stage>, ProtocolType: Api['ProtocolType'] = 'HTTP') {
  return (
    <MemoryRouter>
      <V2Stages api={{ ApiEndpoint: endpoint, ProtocolType }} stages={stages} connection={connection} />
    </MemoryRouter>
  );
}

it('shows HTTP stage metadata, the two kinds of invoke address and the guidance when empty', async () => {
  const user = userEvent.setup();
  const { rerender } = render(view(catalog([defaultStage, devStage])));
  const first = screen.getByRole('row', { name: /\$default/ });
  for (const text of ['$default', 'On', 'd-1', creationDateText(date), endpoint]) {
    expect(first).toHaveTextContent(text);
  }
  const dev = screen.getByRole('row', { name: /^dev / });
  expect(dev).toHaveTextContent('Off');
  expect(dev).toHaveTextContent(`${endpoint}/dev`);
  expect(within(first).getByRole('button', { name: 'Copy deployment ID' })).toBeInTheDocument();
  await user.click(within(dev).getByRole('button', { name: 'Copy invoke address' }));
  expect(await navigator.clipboard.readText()).toBe(`${endpoint}/dev`);

  rerender(view(catalog([])));
  expect(screen.getByText('No stages')).toBeInTheDocument();
  expect(screen.getByText('Create a stage to get an invoke URL.')).toBeInTheDocument();
});

it('copies the WebSocket deployment ID and shows no invoke-address column or empty-state suggestion', async () => {
  const user = userEvent.setup();
  const { rerender } = render(view(catalog([defaultStage]), 'WEBSOCKET'));
  const first = screen.getByRole('row', { name: /\$default/ });
  for (const text of ['$default', 'On', 'd-1', creationDateText(date)]) {
    expect(first).toHaveTextContent(text);
  }
  expect(screen.queryByRole('columnheader', { name: 'Invoke address' })).not.toBeInTheDocument();
  await user.click(within(first).getByRole('button', { name: 'Copy deployment ID' }));
  expect(await navigator.clipboard.readText()).toBe('d-1');

  rerender(view(catalog([]), 'WEBSOCKET'));
  expect(screen.getByText('No stages')).toBeInTheDocument();
  expect(screen.queryByText('Create a stage to get an invoke URL.')).not.toBeInTheDocument();
});

it('shows the operation and retry when GetStages fails', async () => {
  const user = userEvent.setup();
  const stages = {
    ...catalog(),
    failure: { kind: 'other', operation: 'GetStages', code: 'Oops', message: 'Unrecognized API.' },
  } as const;
  render(view(stages));
  expect(screen.getByText('The stages could not be read')).toBeInTheDocument();
  expect(screen.getByText('GetStages: Oops: Unrecognized API.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(stages.retry).toHaveBeenCalledOnce();
});
