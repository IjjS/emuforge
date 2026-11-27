import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';

import { AreaRootContext } from '../../../area-root';
import type { AreaConnection } from '../../../components/emulator-line';
import { getItem, readItems, type Item, type Table } from '../api';
import { useItemsExplorer } from './items-explorer';
import { ItemsTab } from './items-tab';

vi.mock('../api', { spy: true });

const table: Table = {
  name: 'items',
  status: 'ACTIVE',
  partitionKey: { name: 'pk', type: 'S' },
  indexes: [],
  capacity: { mode: 'on-demand' },
  stream: { enabled: false },
};
const sortedTable: Table = { ...table, sortKey: { name: 'sk', type: 'S' } };
const connection: AreaConnection = {
  engineOrigin: 'http://127.0.0.1:9681',
  result: {
    kind: 'connected',
    checkedAt: 1,
    emulator: { port: 9682, endpoint: 'https://127.0.0.1:9682' },
  },
};
const singleSpaceItem: Item = { pk: { S: 'p' }, sk: { S: 'a b' } };
const twoSpaceItem: Item = { pk: { S: 'p' }, sk: { S: 'a  b' } };
const singleSpaceKey = '{"pk":{"S":"p"},"sk":{"S":"a b"}}';
const twoSpaceKey = '{"pk":{"S":"p"},"sk":{"S":"a\\u0020\\u0020b"}}';

beforeEach(() => vi.resetAllMocks());

function InArea({ table }: { table: Table }) {
  const root = useRef<HTMLDivElement>(null);
  const explorer = useItemsExplorer(table, connection);
  return (
    <div ref={root}>
      <AreaRootContext value={root}>
        <ItemsTab
          table={table}
          explorer={explorer}
          connection={connection}
          selection={[]}
          onSelectionChange={vi.fn()}
        />
      </AreaRootContext>
    </div>
  );
}

function open(table: Table, items: Item[]) {
  vi.mocked(readItems).mockResolvedValue({ items });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <InArea table={table} />
    </QueryClientProvider>,
  );
}

it('distinguishes sort keys with repeated spaces in the cells, opening buttons, and selection controls', async () => {
  open(sortedTable, [singleSpaceItem, twoSpaceItem]);

  const button = await screen.findByRole('button', { name: twoSpaceKey });
  expect(screen.getByRole('button', { name: singleSpaceKey })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select ' + singleSpaceKey })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Select ' + twoSpaceKey })).toBeInTheDocument();
  const row = button.closest('tr');
  if (!row) throw new Error('Missing row for the two-space key');
  const cell = within(row).getByRole('cell', { name: 'S a\\u0020\\u0020b' });
  expect(within(cell).getByText('a  b', { normalizer: (text) => text })).toBeVisible();
  expect(within(cell).getByText('(a\\u0020\\u0020b)')).toBeVisible();
});

it('distinguishes a key containing literal escape notation from the key with repeated spaces', async () => {
  open(table, [{ pk: { S: 'a b (a\\u0020\\u0020b)' } }, { pk: { S: 'a  b' } }]);

  expect(await screen.findByRole('button', { name: '{"pk":{"S":"a\\u0020\\u0020b"}}' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '{"pk":{"S":"a b (a\\\\\\\\u0020\\\\\\\\u0020b)"}}' })).toBeInTheDocument();
});

it('opens the editor for the item whose sort key has two spaces', async () => {
  vi.mocked(getItem).mockResolvedValue(twoSpaceItem);
  open(sortedTable, [singleSpaceItem, twoSpaceItem]);

  await userEvent.click(await screen.findByRole('button', { name: twoSpaceKey }));
  const editor = await screen.findByRole('dialog', { name: 'Edit item' });
  expect(vi.mocked(getItem)).toHaveBeenCalledExactlyOnceWith(
    connection.engineOrigin,
    sortedTable.name,
    { partition: sortedTable.partitionKey, sort: sortedTable.sortKey },
    twoSpaceItem,
    expect.any(AbortSignal),
  );
  const field = within(editor).getByRole<HTMLTextAreaElement>('textbox', { name: 'Item' });
  expect(JSON.parse(field.value)).toEqual(twoSpaceItem);
});

it('draws a single key without hidden whitespace as the attribute type and value', async () => {
  open(table, [{ pk: { S: 'a b' } }]);

  const button = await screen.findByRole('button', { name: '{"pk":{"S":"a b"}}' });
  expect(button.textContent).toBe('S a b');
});
