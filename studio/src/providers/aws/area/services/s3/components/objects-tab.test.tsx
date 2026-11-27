import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
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
        <ObjectsTab
          name="alpha"
          prefix=""
          connection={{ engineOrigin: endpoint, result: undefined }}
          announce={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function objectRow(index: number) {
  return waitFor(() => {
    const table = createWrapper().findTable();
    const cell = table?.findBodyCell(index, 2);
    const link = cell?.findLink();
    const selection = table?.findRowSelectionArea(index)?.find('input[type="checkbox"]');
    if (!cell || !link || !selection) throw new Error('Expected an object or folder row with a link and checkbox');
    return { cell: cell.getElement(), link: link.getElement(), selection: selection.getElement() };
  });
}

it('distinguishes objects by their exact keys and links to the stored key', async () => {
  open('<Contents><Key>a b</Key></Contents><Contents><Key>a  b</Key></Contents>');

  const first = await objectRow(1);
  const second = await objectRow(2);
  expect(first.link.textContent).toBe('a b');
  expect(first.link).toHaveAccessibleName('a b');
  expect(second.link).toHaveAccessibleName('a\\u0020\\u0020b');
  expect(first.link).toHaveAttribute('href', '/aws/s3/buckets/alpha/object?key=a+b');
  expect(second.link).toHaveAttribute('href', '/aws/s3/buckets/alpha/object?key=a++b');
  expect(second.link.querySelector('[aria-hidden="true"]')?.textContent).toBe('a  b (a\\u0020\\u0020b)');
  expect(first.selection).toHaveAccessibleName('Select a b');
  expect(second.selection).toHaveAccessibleName('Select a\\u0020\\u0020b');
});

it('distinguishes folders by their exact names and links to the stored prefix', async () => {
  open('<CommonPrefixes><Prefix>d x/</Prefix></CommonPrefixes><CommonPrefixes><Prefix>d  x/</Prefix></CommonPrefixes>');

  const first = await objectRow(1);
  const second = await objectRow(2);
  expect(first.link.textContent).toBe('d x/');
  expect(first.link).toHaveAccessibleName('d x/');
  expect(second.link).toHaveAccessibleName('d\\u0020\\u0020x/');
  expect(first.link).toHaveAttribute('href', '/aws/s3/buckets/alpha?prefix=d+x%2F');
  expect(second.link).toHaveAttribute('href', '/aws/s3/buckets/alpha?prefix=d++x%2F');
  expect(second.link.querySelector('[aria-hidden="true"]')?.textContent).toBe('d  x/ (d\\u0020\\u0020x/)');
  expect(first.selection).toHaveAccessibleName('Select d x/');
  expect(second.selection).toHaveAccessibleName('Select d\\u0020\\u0020x/');
});

it('keeps the text, link and selection name for an ordinary key', async () => {
  open('<Contents><Key>archive 100%.txt</Key></Contents>');

  const name = 'archive 100%.txt';
  const { cell, link, selection } = await objectRow(1);
  expect(cell).toHaveRole('rowheader');
  expect(cell).toHaveAccessibleName(name);
  expect(cell.textContent).toBe(name);
  expect(link).toHaveAccessibleName(name);
  expect(link.textContent).toBe(name);
  expect(link).toHaveAttribute('href', '/aws/s3/buckets/alpha/object?key=archive+100%25.txt');
  expect(selection).toHaveAccessibleName('Select ' + name);
});
