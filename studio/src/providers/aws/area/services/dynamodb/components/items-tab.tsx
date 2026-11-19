import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import CollectionPreferences, {
  type CollectionPreferencesProps,
} from '@cloudscape-design/components/collection-preferences';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Pagination from '@cloudscape-design/components/pagination';
import SegmentedControl from '@cloudscape-design/components/segmented-control';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useId, type FormEvent, type ReactNode } from 'react';

import { useAreaModalRoot } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, type ReadFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import type { Item, Table as TableDescription } from '../api';
import { cellText } from '../format';
import { compareCodePoints } from '../item-json';
import {
  ANY,
  conditionsFor,
  keyLabel,
  keysOf,
  PAGE_SIZES,
  type ConditionChoice,
  type ItemsExplorer,
} from './items-explorer';

// S2's "Items" tab (issue 496, design.md task 2): one container, the request above and its result below. By default a
// scan of the table, first page, once the table is active; the developer chooses scan or query, the table or one of
// its indexes, and for a query the partition key's value and optionally one sort key condition and the order. "Run"
// starts a new exploration at page 1; the pages follow the emulator's own `LastEvaluatedKey`. Every value from the
// emulator is rendered as text.

/** The result's columns: the table's partition key and sort key, then every other name on the page by code point. */
function columnNames(table: TableDescription, items: readonly Item[]): { keys: string[]; others: string[] } {
  const keys = [table.partitionKey?.name, table.sortKey?.name].filter(
    (name): name is string => name !== undefined && name !== '',
  );
  const others = new Set<string>();
  for (const item of items) {
    for (const name of Object.keys(item)) {
      if (!keys.includes(name)) {
        others.add(name);
      }
    }
  }
  return { keys, others: [...others].sort(compareCodePoints) };
}

/** A cell: the attribute's type name, then its value as text; an attribute the item lacks is an empty cell. */
function Cell({ item, name, kind }: { item: Item; name: string; kind: 'name' | 'text' }) {
  const value = item[name];
  if (value === undefined) {
    return null;
  }
  const shown = cellText(value);
  return (
    <span>
      <Box variant="span" fontSize="body-s" color="text-body-secondary">
        {shown.type}
      </Box>{' '}
      <ValueText kind={kind} value={shown.text} />
    </span>
  );
}

/** What the result's body shows, the rows aside. */
type BodyState =
  | { kind: 'rows' }
  | { kind: 'loading' }
  | { kind: 'failure'; failure: ReadFailureState }
  | { kind: 'none'; title: string; text?: ReactNode };

function bodyState(explorer: ItemsExplorer, target: string, connection: AreaConnection): BodyState {
  const { exploration, applied } = explorer;
  if (exploration.failure !== undefined) {
    return { kind: 'failure', failure: readFailureState(exploration.failure, connection, 'items') };
  }
  if (exploration.items === undefined) {
    return { kind: 'loading' };
  }
  if (exploration.items.length > 0) {
    return { kind: 'rows' };
  }
  if (exploration.currentPage > 1) {
    return { kind: 'none', title: 'No more items' };
  }
  const name = <ValueText kind="name" value={target} />;
  return applied.read.kind === 'scan'
    ? {
        kind: 'none',
        title: 'No items',
        text: <>{name} holds no items. Create one here, or with any tool pointed at the emulator.</>,
      }
    : { kind: 'none', title: 'No matching items', text: <>No item of {name} matches this query.</> };
}

function Body({ state, onRetry }: { state: BodyState; onRetry: () => void }) {
  switch (state.kind) {
    case 'rows':
    case 'loading':
      return null;
    case 'failure':
      return <ReadFailure state={state.failure} onRetry={onRetry} />;
    case 'none':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <Box variant="strong" color="inherit">
              {state.title}
            </Box>
            {state.text !== undefined && (
              <Box variant="p" color="inherit">
                {state.text}
              </Box>
            )}
          </SpaceBetween>
        </Box>
      );
  }
}

/** The select's options: the table, then each index by kind. */
function targetOptions(table: TableDescription): SelectProps.Option[] {
  return [
    { value: '', label: `${table.name} (table)` },
    ...table.indexes.map((index) => ({
      value: index.name,
      label: `${index.name} (${index.kind === 'global' ? 'global' : 'local'} index)`,
    })),
  ];
}

interface RequestProps {
  table: TableDescription;
  explorer: ItemsExplorer;
}

/** The request: scan or query, the table or an index, the query's key fields, and "Run". */
function Request({ table, explorer }: RequestProps) {
  const { fields, errors, change } = explorer;
  // The segmented controls are named by their fields' labels, so a narrow screen's select names no label again.
  const readId = useId();
  const orderId = useId();
  const options = targetOptions(table);
  const keys = keysOf(table, fields.target);
  const sortKey = keys.sort;
  const conditions = sortKey === undefined ? [] : conditionsFor(sortKey);
  const condition = conditions.find((each) => each.value === fields.condition) ?? ANY;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    explorer.run();
  };

  const handleTarget = ({ detail }: { detail: SelectProps.ChangeDetail }) => {
    const target = detail.selectedOption.value ?? '';
    const next = keysOf(table, target).sort;
    const keep = next !== undefined && conditionsFor(next).some((each) => each.value === fields.condition);
    change({ target, ...(keep ? {} : { condition: 'any' }) });
  };

  return (
    <form onSubmit={handleSubmit} aria-label="Read items">
      <SpaceBetween size="m">
        <SpaceBetween direction="horizontal" size="m" alignItems="end">
          <FormField label={<span id={readId}>Read</span>}>
            <SegmentedControl
              ariaLabelledby={readId}
              selectedId={fields.kind}
              options={[
                { id: 'scan', text: 'Scan' },
                { id: 'query', text: 'Query' },
              ]}
              onChange={({ detail }) => {
                change({ kind: detail.selectedId === 'query' ? 'query' : 'scan' });
              }}
            />
          </FormField>
          <FormField label="Table or index">
            <Select
              selectedOption={options.find((option) => option.value === fields.target) ?? options[0] ?? null}
              options={options}
              onChange={handleTarget}
            />
          </FormField>
          {fields.kind === 'scan' && (
            <Button formAction="submit" variant="primary">
              Run
            </Button>
          )}
        </SpaceBetween>
        {fields.kind === 'query' && (
          <SpaceBetween direction="horizontal" size="m" alignItems="start">
            <FormField label={keyLabel(keys.partition)} errorText={errors.partition}>
              <Input
                value={fields.partition}
                onChange={({ detail }) => {
                  change({ partition: detail.value });
                }}
              />
            </FormField>
            {sortKey !== undefined && (
              <FormField label="Sort key condition">
                <Select
                  selectedOption={condition}
                  options={conditions}
                  onChange={({ detail }) => {
                    change({ condition: (detail.selectedOption.value ?? 'any') as ConditionChoice });
                  }}
                />
              </FormField>
            )}
            {sortKey !== undefined && condition.value !== 'any' && (
              <FormField label={keyLabel(sortKey)} errorText={errors.sort}>
                <Input
                  value={fields.sort[0]}
                  onChange={({ detail }) => {
                    change({ sort: [detail.value, fields.sort[1]] });
                  }}
                />
              </FormField>
            )}
            {sortKey !== undefined && condition.value === 'between' && (
              <FormField label={`${keyLabel(sortKey)}, upper bound`} errorText={errors.upper}>
                <Input
                  value={fields.sort[1]}
                  onChange={({ detail }) => {
                    change({ sort: [fields.sort[0], detail.value] });
                  }}
                />
              </FormField>
            )}
            <FormField label={<span id={orderId}>Order</span>}>
              <SegmentedControl
                ariaLabelledby={orderId}
                selectedId={fields.descending ? 'descending' : 'ascending'}
                options={[
                  { id: 'ascending', text: 'Ascending' },
                  { id: 'descending', text: 'Descending' },
                ]}
                onChange={({ detail }) => {
                  change({ descending: detail.selectedId === 'descending' });
                }}
              />
            </FormField>
            <FormField label={<span aria-hidden="true">&nbsp;</span>}>
              <Button formAction="submit" variant="primary">
                Run
              </Button>
            </FormField>
          </SpaceBetween>
        )}
      </SpaceBetween>
    </form>
  );
}

export interface ItemsTabProps {
  table: TableDescription;
  explorer: ItemsExplorer;
  connection: AreaConnection;
}

/** "Items": the request, and the page of items it read. */
export function ItemsTab({ table, explorer, connection }: ItemsTabProps) {
  const modalRoot = useAreaModalRoot();
  const { exploration, applied, unreadable } = explorer;

  if (unreadable !== undefined) {
    return (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="in-progress">{unreadable}</StatusIndicator>
        </Box>
      </Container>
    );
  }

  const target = applied.index ?? table.name;
  const items = exploration.items ?? [];
  const state = bodyState(explorer, target, connection);
  const { keys, others } = columnNames(table, items);
  const columns: TableProps.ColumnDefinition<Item>[] = [
    ...keys.map((name, position) => ({
      id: `key-${String(position)}`,
      header: <ValueText kind="name" value={name} />,
      isRowHeader: position === 0,
      cell: (item: Item) => <Cell item={item} name={name} kind="name" />,
    })),
    ...others.map((name, position) => ({
      id: `attribute-${String(position)}`,
      header: <ValueText kind="name" value={name} />,
      cell: (item: Item) => <Cell item={item} name={name} kind="text" />,
    })),
  ];

  const handlePreferences = ({ detail }: { detail: CollectionPreferencesProps.Preferences }) => {
    explorer.setPageSize(detail.pageSize ?? explorer.pageSize);
  };

  return (
    <Table<Item>
      variant="container"
      items={items}
      columnDefinitions={columns}
      wrapLines
      loading={state.kind === 'loading'}
      loadingText="Reading items"
      ariaLabels={{ tableLabel: 'Items' }}
      empty={<Body state={state} onRetry={exploration.refresh} />}
      header={
        <Header
          variant="h2"
          counter={exploration.items === undefined ? undefined : `(${String(exploration.items.length)})`}
        >
          {applied.read.kind === 'scan' ? 'Scan of ' : 'Query of '}
          <ValueText kind="name" value={target} />
        </Header>
      }
      filter={<Request table={table} explorer={explorer} />}
      pagination={
        <Pagination
          currentPageIndex={exploration.currentPage}
          pagesCount={exploration.pagesCount}
          openEnd={exploration.openEnd}
          disabled={exploration.loading}
          ariaLabels={{
            nextPageLabel: 'Next page',
            previousPageLabel: 'Previous page',
            pageLabel: (page) => `Page ${String(page)}`,
          }}
          onChange={({ detail }) => {
            exploration.goToPage(detail.currentPageIndex);
          }}
        />
      }
      preferences={
        <CollectionPreferences
          {...modalRoot}
          title="Preferences"
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          closeAriaLabel="Close modal"
          preferences={{ pageSize: explorer.pageSize }}
          pageSizePreference={{
            title: 'Items per page',
            options: PAGE_SIZES.map((size) => ({ value: size, label: `${String(size)} items` })),
          }}
          onConfirm={handlePreferences}
        />
      }
    />
  );
}
