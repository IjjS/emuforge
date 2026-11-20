import Box from '@cloudscape-design/components/box';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { ReactNode } from 'react';

import { ValueText } from '../../../components/value-text';
import type { Route } from '../api';
import { NONE } from '../format';

// The routes of a route table (S6's "Route table", S9's "Routes"): one row per route in the given order, its
// destination and its target as the API gave them, `local` as it is, and its state with a status of its kind
// (`active` success, `blackhole` warning, another as it came). With `selection` one row at a time can be selected,
// and the page is told which; without it no row can be.

/** A route's key in its table: its destination, which a table holds once. */
function routeKey(route: Route): string {
  return route.destination === undefined ? `${route.target ?? ''}|${route.state ?? ''}` : route.destination.value;
}

function RouteState({ state }: { state: string | undefined }) {
  if (state === 'active') {
    return <StatusIndicator type="success">active</StatusIndicator>;
  }
  if (state === 'blackhole') {
    return <StatusIndicator type="warning">blackhole</StatusIndicator>;
  }
  return <ValueText kind="fixed" value={state} none={NONE} />;
}

const COLUMNS: TableProps.ColumnDefinition<Route>[] = [
  {
    id: 'destination',
    header: 'Destination',
    isRowHeader: true,
    cell: (route) => <ValueText kind="name" value={route.destination?.value} none={NONE} />,
  },
  { id: 'target', header: 'Target', cell: (route) => <ValueText kind="name" value={route.target} none={NONE} /> },
  { id: 'state', header: 'State', cell: (route) => <RouteState state={route.state} /> },
];

/** The one route selected, and the page told of a change; no selection when absent. */
export interface RouteSelection {
  selected: Route | undefined;
  onChange: (route: Route | undefined) => void;
}

export interface RoutesTableProps {
  routes: readonly Route[];
  selection?: RouteSelection | undefined;
  header?: ReactNode;
  variant?: TableProps['variant'];
  pagination?: ReactNode;
  empty?: ReactNode;
  ariaLabel?: string;
}

export function RoutesTable({
  routes,
  selection,
  header,
  variant = 'container',
  pagination,
  empty,
  ariaLabel = 'Routes',
}: RoutesTableProps) {
  const selectable =
    selection === undefined
      ? {}
      : {
          selectionType: 'single' as const,
          selectedItems: selection.selected === undefined ? [] : [selection.selected],
          onSelectionChange: ({ detail }: { detail: TableProps.SelectionChangeDetail<Route> }) => {
            selection.onChange(detail.selectedItems[0]);
          },
          ariaLabels: {
            selectionGroupLabel: 'Route selection',
            itemSelectionLabel: (_: unknown, route: Route) => route.destination?.value ?? NONE,
          },
        };
  return (
    <Table<Route>
      variant={variant}
      items={[...routes]}
      trackBy={routeKey}
      columnDefinitions={COLUMNS}
      wrapLines
      header={header}
      pagination={pagination}
      ariaLabels={{ tableLabel: ariaLabel }}
      empty={
        empty ?? (
          <Box textAlign="center" color="inherit">
            <Box variant="strong" color="inherit">
              No routes
            </Box>
          </Box>
        )
      }
      {...selectable}
    />
  );
}
