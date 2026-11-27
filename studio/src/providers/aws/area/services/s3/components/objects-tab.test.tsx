import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, expect, it, vi } from 'vitest';

import { engineEndpoint } from '../../../../../../lib/aws/client-factory';
import { ObjectsTab } from './objects-tab';

function open(listing: string) {
  const endpoint = engineEndpoint(8840);
  vi.stubGlobal('fetch', async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.pathname === '/__emuforge/session') return Response.json({ token: 'objects-tab-test' });
    if (url.pathname === '/alpha/' && url.searchParams.get('list-type') === '2') {
      return new Response('<ListBucketResult>' + listing + '</ListBucketResult>');
    }
    throw new Error('Unexpected request ' + url.pathname + url.search);
  });

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ObjectsTab name="alpha" prefix="" connection={{ engineOrigin: endpoint }} announce={vi.fn()} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

it('distinguishes objects by their exact keys and links to the stored key', async () => {
  open('<Contents><Key>a b</Key></Contents><Contents><Key>a  b</Key></Contents>');

  const first = await screen.findByRole('link', { name: 'a b' });
  const second = screen.getByRole('link', { name: 'a\\u0020\\u0020b' });
  expect(first).toHaveAttribute('href', '/aws/s3/buckets/alpha/object?key=a+b');
  expect(second).toHaveAttribute('href', '/aws/s3/buckets/alpha/object?key=a++b');
  expect(second.querySelector('[aria-hidden="true"]')?.textContent).toBe('a  b (a\\u0020\\u0020b)');
  expect(screen.getByRole('checkbox', { name: 'Select a b' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select a\\u0020\\u0020b' })).toBeInTheDocument();
});

it('distinguishes folders by their exact names and links to the stored prefix', async () => {
  open('<CommonPrefixes><Prefix>d x/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>d  x/</Prefix></CommonPrefixes>');

  const first = await screen.findByRole('link', { name: 'd x/' });
  const second = screen.getByRole('link', { name: 'd\\u0020\\u0020x/' });
  expect(first).toHaveAttribute('href', '/aws/s3/buckets/alpha?prefix=d+x%2F');
  expect(second).toHaveAttribute('href', '/aws/s3/buckets/alpha?prefix=d++x%2F');
  expect(second.querySelector('[aria-hidden="true"]')?.textContent).toBe('d  x/ (d\\u0020\\u0020x/)');
  expect(screen.getByRole('checkbox', { name: 'Select d x/' })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select d\\u0020\\u0020x/' })).toBeInTheDocument();
});

it('keeps the text, link and selection name for an ordinary key', async () => {
  open('<Contents><Key>archive 100%.txt</Key></Contents>');

  const name = 'archive 100%.txt';
  const link = await screen.findByRole('link', { name });
  expect(screen.getByRole('rowheader', { name }).textContent).toBe(name);
  expect(link.textContent).toBe(name);
  expect(link).toHaveAttribute('href', '/aws/s3/buckets/alpha/object?key=archive+100%25.txt');
  expect(screen.getByRole('checkbox', { name: 'Select ' + name })).toBeInTheDocument();
});
