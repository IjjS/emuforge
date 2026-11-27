import createWrapper from '@cloudscape-design/components/test-utils/dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useRef } from 'react';
import { assert, beforeEach, expect, it, vi } from 'vitest';

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

async function open(table: Table, items: Item[]) {
  vi.mocked(readItems).mockResolvedValue({ items });
  const { container } = render(
    <QueryClientProvider client={new QueryClient()}>
      <InArea table={table} />
    </QueryClientProvider>,
  );
  const itemsTable = createWrapper(container).findTable();
  assert(itemsTable);
  await waitFor(() => expect(itemsTable.findRows()).toHaveLength(items.length));
  return itemsTable;
}

function itemButton(itemsTable: Awaited<ReturnType<typeof open>>, row: number) {
  const button = itemsTable.findBodyCell(row, 2)?.findLink()?.getElement();
  assert(button);
  expect(button).toHaveRole('button');
  return button;
}

it('distinguishes sort keys with repeated spaces in the cells, opening buttons, and selection controls', async () => {
  const itemsTable = await open(sortedTable, [singleSpaceItem, twoSpaceItem]);

  for (const [row, key] of [
    [1, singleSpaceKey],
    [2, twoSpaceKey],
  ] as const) {
    expect(itemButton(itemsTable, row)).toHaveAccessibleName(key);
    const checkbox = itemsTable.findRowSelectionArea(row)?.findCheckbox()?.findNativeInput().getElement();
    expect(checkbox).toHaveRole('checkbox');
    expect(checkbox).toHaveAccessibleName(`Select ${key}`);
  }
  const cell = itemsTable.findBodyCell(2, 3)?.getElement();
  assert(cell);
  expect(cell).toHaveRole('cell');
  expect(cell).toHaveAccessibleName('S a\\u0020\\u0020b');
  expect(within(cell).getByText('a  b', { normalizer: (text) => text })).toBeVisible();
  expect(within(cell).getByText('(a\\u0020\\u0020b)')).toBeVisible();
});

it('distinguishes a key containing literal escape notation from the key with repeated spaces', async () => {
  const itemsTable = await open(table, [{ pk: { S: 'a b (a\\u0020\\u0020b)' } }, { pk: { S: 'a  b' } }]);

  expect(itemButton(itemsTable, 2)).toHaveAccessibleName('{"pk":{"S":"a\\u0020\\u0020b"}}');
  expect(itemButton(itemsTable, 1)).toHaveAccessibleName('{"pk":{"S":"a b (a\\\\\\\\u0020\\\\\\\\u0020b)"}}');
});

it('opens the editor for the item whose sort key has two spaces', async () => {
  vi.mocked(getItem).mockResolvedValue(twoSpaceItem);
  const itemsTable = await open(sortedTable, [singleSpaceItem, twoSpaceItem]);

  const button = itemButton(itemsTable, 2);
  expect(button).toHaveAccessibleName(twoSpaceKey);
  await userEvent.click(button);
  const editor = await waitFor(() => {
    const modal = createWrapper(document.body).findModal();
    assert(modal);
    expect(modal.getElement()).toHaveRole('dialog');
    expect(modal.getElement()).toHaveAccessibleName('Edit item');
    return modal;
  });
  expect(vi.mocked(getItem)).toHaveBeenCalledExactlyOnceWith(
    connection.engineOrigin,
    sortedTable.name,
    { partition: sortedTable.partitionKey, sort: sortedTable.sortKey },
    twoSpaceItem,
    expect.any(AbortSignal),
  );
  const field = editor.findContent().findTextarea()?.findNativeTextarea().getElement();
  assert(field);
  expect(field).toHaveRole('textbox');
  expect(field).toHaveAccessibleName('Item');
  expect(JSON.parse(field.value)).toEqual(twoSpaceItem);
});

it('draws a single key without hidden whitespace as the attribute type and value', async () => {
  const itemsTable = await open(table, [{ pk: { S: 'a b' } }]);

  const button = itemButton(itemsTable, 1);
  expect(button).toHaveAccessibleName('{"pk":{"S":"a b"}}');
  expect(button.textContent).toBe('S a b');
});
