import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import { ComposeHostEndpoint } from './compose-host-endpoint';

const COPY = 'Copy Compose host endpoint';

it.each([
  { kind: 'instance', clusterId: undefined, engine: 'aurora-postgresql' },
  { kind: 'instance', clusterId: 'cluster', engine: 'postgres' },
  { kind: 'instance', clusterId: undefined, engine: 'oracle-ee' },
  { kind: 'instance', clusterId: undefined, engine: undefined },
  { kind: 'cluster', engine: 'mysql' },
] as const)('offers no host endpoint for $kind with engine $engine and membership $clusterId', (resource) => {
  render(<ComposeHostEndpoint {...resource} port={28161} />);

  expect(screen.queryByRole('button', { name: COPY })).toBeNull();
  expect(screen.queryByText('127.0.0.1:28161')).toBeNull();
});

it.each([undefined, 0, -1, 65536, 28161.5, NaN, Infinity])('offers no host endpoint for port %s', (port) => {
  render(<ComposeHostEndpoint kind="cluster" engine="aurora-postgresql" port={port} />);

  expect(screen.queryByRole('button', { name: COPY })).toBeNull();
  expect(screen.queryByText('Compose host endpoint')).toBeNull();
});

it('uses the latest described port on refresh', () => {
  const { rerender } = render(<ComposeHostEndpoint kind="cluster" engine="aurora-postgresql" port={28161} />);
  expect(screen.getByText('127.0.0.1:28161')).toBeInTheDocument();

  rerender(<ComposeHostEndpoint kind="cluster" engine="aurora-postgresql" port={28162} />);

  expect(screen.queryByText('127.0.0.1:28161')).toBeNull();
  expect(screen.getByText('127.0.0.1:28162')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: COPY })).toBeInTheDocument();
});

it('reports clipboard failure and leaves the host endpoint visible', async () => {
  const writeText = vi.fn(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  try {
    render(<ComposeHostEndpoint kind="cluster" engine="aurora-mysql" port={28161} />);
    const endpoint = screen.getByText('127.0.0.1:28161');

    fireEvent.click(screen.getByRole('button', { name: COPY }));

    expect(await screen.findByText('Compose host endpoint could not be copied')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledExactlyOnceWith('127.0.0.1:28161');
    expect(endpoint).toBeVisible();
  } finally {
    vi.unstubAllGlobals();
  }
});
