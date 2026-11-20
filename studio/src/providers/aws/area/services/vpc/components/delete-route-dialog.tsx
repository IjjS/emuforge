import type { ReactNode } from 'react';
import { useState } from 'react';

import type { RequestFailure } from '../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../components/confirm-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { ROUTE_CHANGE_OPERATIONS } from '../route-changes-api';
import { useDeleteRoute } from '../route-changes';

// "Delete route?" (issue 574, requirement "Delete a route"), from S9: the area's dialog confirmed by typing `delete`,
// which names the route by its destination and target, and the table. The word is typed because a route made
// elsewhere (to a NAT gateway, an endpoint, a peering connection) cannot be added again in Studio. The dialog sends
// `DeleteRoute` itself by the route's IPv4 destination; its answer, a success or a failure, goes to the page, which
// closes the dialog and shows it in the area's flash.

/** The route to delete: its table, and its destination and target as the table shows them. */
export interface RouteTarget {
  routeTableId: string;
  /** How the dialog names the table: its name, else its ID. */
  tableLabel: string;
  destination: string;
  target: string;
}

export interface DeleteRouteDialogProps {
  /** The route; none while the dialog is closed. */
  route: RouteTarget | undefined;
  connection: AreaConnection;
  /** The emulator answered 200. */
  onDeleted: (route: RouteTarget) => void;
  /** The request failed: the page closes the dialog and shows the failure. */
  onFailed: (route: RouteTarget, failure: RequestFailure) => void;
  onDismiss: () => void;
}

function Dialog({
  route,
  connection,
  onDeleted,
  onFailed,
  onDismiss,
}: Omit<DeleteRouteDialogProps, 'route'> & { route: RouteTarget }) {
  const remove = useDeleteRoute(connection.engineOrigin);
  const pageSignal = usePageSignal();
  const [pending, setPending] = useState(false);

  const handleConfirm = () => {
    if (pending) {
      return;
    }
    const signal = pageSignal();
    setPending(true);
    remove(route.routeTableId, route.destination, signal).then(
      () => {
        if (signal.aborted) return;
        setPending(false);
        onDeleted(route);
      },
      (error: unknown) => {
        if (signal.aborted) return;
        setPending(false);
        onFailed(route, failureOf(error, ROUTE_CHANGE_OPERATIONS.deleteRoute));
      },
    );
  };

  const body: ReactNode = (
    <>
      The route <ValueText kind="name" value={route.destination} /> to <ValueText kind="name" value={route.target} />{' '}
      is removed from <ValueText kind="name" value={route.tableLabel} />.
    </>
  );

  return (
    <ConfirmDialog
      visible
      header="Delete route?"
      body={body}
      word="delete"
      action="Delete"
      pending={pending}
      onConfirm={handleConfirm}
      onDismiss={onDismiss}
    />
  );
}

/** The dialog, mounted only while a route is given, so each opening starts with an empty field. */
export function DeleteRouteDialog({ route, ...props }: DeleteRouteDialogProps) {
  return route === undefined ? null : (
    <Dialog key={`${route.routeTableId}|${route.destination}`} route={route} {...props} />
  );
}
