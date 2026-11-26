import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { RequestReadFailure } from './request-read-failure';

const engineOrigin = 'http://127.0.0.1:9681';
const emulator = { port: 9682, endpoint: 'https://127.0.0.1:9682' };
const connected = { kind: 'connected', checkedAt: 1, emulator } as const;
const unavailable = { kind: 'emulator-unreachable', checkedAt: 1, emulator, reason: 'timeout', message: '' } as const;
const stopped = { ...unavailable, reason: 'not_started' } as const;
const operation = 'GetIntegrations';

function show(failure: RequestFailure, result?: AreaConnection['result'], origin: string | null = engineOrigin) {
  const onRetry = vi.fn();
  const { container } = render(
    <MemoryRouter>
      <RequestReadFailure
        failure={failure}
        connection={{ result, engineOrigin: origin ?? undefined }}
        thing="integrations"
        onRetry={onRetry}
      />
    </MemoryRouter>,
  );
  return { container, onRetry };
}

it.each([
  [
    'not-implemented',
    'Not implemented by the emulator',
    'The emulator answered 501 Not Implemented for GetIntegrations, so Studio cannot show the integrations.',
  ],
  ['access-denied', 'Access denied', 'GetIntegrations was refused: Full denial reason.'],
] as const)('reports %s by operation without connection recovery', (kind, first, detail) => {
  const { container } = show({ kind, operation, message: 'Full denial reason.' }, stopped);
  expect(container).toHaveTextContent(first);
  expect(container).toHaveTextContent(detail);
  expect(screen.queryByRole('link', { name: 'Connection status' })).not.toBeInTheDocument();
});

it.each([connected, unavailable, stopped])('keeps an ordinary refusal even when health is %j', (result) => {
  const { container } = show({ kind: 'other', operation, code: 'InvalidId', message: 'Full failure reason.' }, result);
  expect(container).toHaveTextContent('The integrations could not be read');
  expect(container).toHaveTextContent('GetIntegrations: InvalidId: Full failure reason.');
  expect(screen.queryByRole('link', { name: 'Connection status' })).not.toBeInTheDocument();
});

it('shows the code alone when a refusal has no message', () => {
  const { container } = show({ kind: 'other', operation, code: 'InvalidId' });
  expect(container).toHaveTextContent(/GetIntegrations: InvalidIdRetry/);
});

it.each([
  [stopped, 'Not started on port 9682'],
  [unavailable, 'Not answering at https://127.0.0.1:9682'],
  [connected, 'Not answering at https://127.0.0.1:9682'],
  [undefined, 'The emulator did not answer'],
] as const)('uses health only for the details of an emulator connection failure', async (result, first) => {
  const { container, onRetry } = show({ kind: 'emulator-did-not-answer', operation, message: 'Timed out.' }, result);
  expect(container).toHaveTextContent(first);
  expect(container).toHaveTextContent('GetIntegrations got no answer from the emulator. Timed out.');
  expect(screen.getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(onRetry).toHaveBeenCalledOnce();
});

it.each([
  [undefined, engineOrigin, 'The EmuForge engine at http://127.0.0.1:9681 is not answering'],
  [connected, engineOrigin, 'The EmuForge engine at http://127.0.0.1:9681 is not answering'],
  [connected, null, 'The EmuForge engine is not answering'],
] as const)(
  'reports the engine failure immediately with its configured address when available',
  (result, origin, first) => {
    const { container } = show({ kind: 'engine-did-not-answer', operation }, result, origin);
    expect(container).toHaveTextContent(first);
    expect(container).toHaveTextContent('GetIntegrations got no answer.');
    expect(screen.getByRole('link', { name: 'Connection status' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
  },
);
