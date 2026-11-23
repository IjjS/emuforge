import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState, ReadFailure } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { functionPath, queuePath } from '../../../components/resource-paths';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import {
  OPERATIONS,
  type AllowOutcome,
  type DeliveryProtocol,
  type Subscription,
  type SubscriptionSetting,
} from '../api';
import { endpointName, subscribeHref } from '../format';
import {
  failureOf,
  useAllowDelivery,
  useDelivery,
  usePageSignal,
  useSubscriptionListing,
  useUnsubscribe,
} from '../queries';
import { DeleteSubscriptionDialog } from './delete-subscription-dialog';
import { DELIVERY_LABELS, DeliveryStatus, deliveryView, type DeliveryView } from './delivery-status';
import { SubscriptionSettings, type FilterPolicyRecovery } from './subscription-settings';

// S3's "Subscriptions" tab (issue 536, design task 1 steps 3 to 5 and task 5 step 1): the topic's subscriptions, a
// page of `ListSubscriptionsByTopic` at a time on its own tokens, each with whether the policy of its queue or
// function lets the topic deliver. A confirmed row can open its subscription settings. The topic page owns
// the settings writes so their results survive the tab unmounting.

export interface SubscriptionsTabProps {
  topicArn: string;
  topicName: string;
  connection: AreaConnection;
  /** Reads the topic again, after a change of its subscriptions. */
  onTopicChanged: () => void;
  onSaveSetting: (arn: string, setting: SubscriptionSetting, recovery?: FilterPolicyRecovery) => Promise<boolean>;
  settingsSave: {
    pending: { arn: string; setting: SubscriptionSetting } | undefined;
    unavailableArns: ReadonlySet<string>;
  };
}

const DESCRIPTION =
  'Delivery says what the policy of the subscribed queue or function allows. The emulator delivers a notification only where that policy lets this topic deliver.';
const ALLOW_REASON = 'Select a subscription whose delivery says No permission.';
const PENDING_REASON = 'A subscription that is pending confirmation has no ARN to delete it by.';
const SELECT_FIRST = 'Select a subscription';

const STATUS_LABELS = ['Confirmed', 'Pending confirmation'] as const;

/**
 * A status column keeps room for its longest label with the indicator's icon and gap before it and the cell's padding
 * on both sides, so no label breaks inside a word (`aws-area.md`, entry 4: a fixed word's column is as wide as its
 * longest word). The icon and its gap take about two characters, the padding about six.
 */
/** The characters a label's column adds to the label: the icon, its gap and the cell's padding. */
const LABEL_ROOM = 8;

function labelColumnWidth(labels: readonly string[]): string {
  return `${String(Math.max(...labels.map((label) => label.length)) + LABEL_ROOM)}ch`;
}

/** The disabled reason of "Allow delivery" on a row that reads "Cannot tell". */
function cannotTellReason(endpoint: string, reason: string): string {
  return `The policy of ${endpoint} is not one Studio evaluates: ${reason}.`;
}

/** An endpoint keeps room for a queue's or a function's name (`aws-area.md`, entry 4). */
const ENDPOINT_MIN_WIDTH = '28ch';

interface Row {
  /** Unique on the page: the subscription's ARN, or for a pending one its protocol, endpoint and occurrence. */
  key: string;
  subscription: Subscription;
  /** The protocol whose delivery is read, or `undefined` for any other. */
  deliveryProtocol: DeliveryProtocol | undefined;
  /** The key of its delivery: two rows of one protocol and endpoint share it. */
  deliveryKey: string;
}

function deliveryProtocolOf(protocol: string): DeliveryProtocol | undefined {
  return protocol === 'sqs' || protocol === 'lambda' ? protocol : undefined;
}

function rowsOf(subscriptions: readonly Subscription[]): Row[] {
  const seen = new Map<string, number>();
  return subscriptions.map((subscription) => {
    const base = subscription.pending
      ? `pending\n${subscription.protocol}\n${subscription.endpoint}`
      : subscription.arn;
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return {
      key: count === 1 ? base : `${base}\n${String(count)}`,
      subscription,
      deliveryProtocol: deliveryProtocolOf(subscription.protocol),
      deliveryKey: `${subscription.protocol}\n${subscription.endpoint}`,
    };
  });
}

/** The header's counter: the page's rows, with a plus while a next page follows. */
function counterText(rows: number, openEnd: boolean): string {
  return `(${String(rows)}${openEnd ? '+' : ''})`;
}

/** The result of "Allow delivery" in the Flashbar (design task 1 step 5). */
function allowItem(outcome: AllowOutcome, endpoint: string, topic: string): FlashItem {
  switch (outcome.outcome) {
    case 'added':
      return { type: 'success', content: `${endpoint} may now receive from ${topic}.` };
    case 'already-allowed':
      return { type: 'info', content: `${endpoint} already receives from ${topic}. Nothing was changed.` };
    case 'not-changed':
      return { type: 'warning', content: `The policy of ${endpoint} was not changed: ${outcome.reason}.` };
  }
}

interface RowDeliveryProps {
  row: Row;
  topicArn: string;
  connection: AreaConnection;
  onView: (deliveryKey: string, view: DeliveryView) => void;
}

/** A row's "Delivery": read when the row is shown, and told to the tab, which decides "Allow delivery" by it. */
function RowDelivery({ row, topicArn, connection, onView }: RowDeliveryProps) {
  const protocol = row.deliveryProtocol;
  const read = useDelivery(
    connection.engineOrigin,
    topicArn,
    protocol ?? 'sqs',
    row.subscription.endpoint,
    protocol !== undefined,
  );
  const view: DeliveryView = protocol === undefined ? { kind: 'other-protocol' } : deliveryView(read);
  const signature = JSON.stringify(view);
  useEffect(() => {
    onView(row.deliveryKey, JSON.parse(signature) as DeliveryView);
  }, [onView, row.deliveryKey, signature]);
  return <DeliveryStatus view={view} connection={connection} />;
}

export function SubscriptionsTab({
  topicArn,
  topicName,
  connection,
  onSaveSetting,
  settingsSave,
}: SubscriptionsTabProps) {
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const allow = useAllowDelivery(connection.engineOrigin);
  const unsubscribe = useUnsubscribe(connection.engineOrigin);
  const [selectedKey, setSelectedKey] = useState<string>();
  const [settingsFor, setSettingsFor] = useState<Subscription>();
  const settingsButton = useRef<ButtonProps.Ref>(null);
  const [views, setViews] = useState<Readonly<Record<string, DeliveryView>>>({});
  const [allowing, setAllowing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const listing = useSubscriptionListing(connection.engineOrigin, topicArn);
  const { items, currentPage, goToPage } = listing;
  const loaded = items !== undefined && !listing.loading;
  const rows = rowsOf(items ?? []);
  const selected = loaded ? rows.find((row) => row.key === selectedKey) : undefined;
  if (
    settingsFor !== undefined &&
    loaded &&
    listing.failure === undefined &&
    !rows.some((row) => row.subscription.arn === settingsFor.arn)
  ) {
    setSettingsFor(undefined);
    setSelectedKey(undefined);
  }
  const selectedView = selected === undefined ? undefined : views[selected.deliveryKey];
  const canAllow = selectedView?.kind === 'read' && selectedView.delivery.kind === 'none';
  const allowReason =
    selected !== undefined && selectedView?.kind === 'read' && selectedView.delivery.kind === 'unknown'
      ? cannotTellReason(endpointName(selected.subscription.endpoint), selectedView.delivery.reason)
      : ALLOW_REASON;

  const handleView = useCallback((deliveryKey: string, view: DeliveryView) => {
    setViews((current) =>
      JSON.stringify(current[deliveryKey]) === JSON.stringify(view) ? current : { ...current, [deliveryKey]: view },
    );
  }, []);

  const handleRetry = useCallback(() => {
    setSelectedKey(undefined);
    goToPage(currentPage);
  }, [goToPage, currentPage]);

  // A failed read is read again once the connection is connected again; kept from the previous render, as React's
  // own pattern for it, so the change is acted on once.
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && listing.failure !== undefined) {
      handleRetry();
    }
  }

  const handleAllow = () => {
    if (selected === undefined || selected.deliveryProtocol === undefined || !canAllow) {
      return;
    }
    const protocol = selected.deliveryProtocol;
    const endpoint = selected.subscription.endpoint;
    const name = endpointName(endpoint);
    const signal = pageSignal();
    setAllowing(true);
    allow({ topicArn, protocol, endpoint }, signal).then(
      (outcome) => {
        if (signal.aborted) {
          return;
        }
        setAllowing(false);
        flash.show([allowItem(outcome, name, topicName)]);
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        setAllowing(false);
        const operation = protocol === 'sqs' ? OPERATIONS.setQueueAttributes : OPERATIONS.addPermission;
        flash.show([
          actionFailureItem(failureOf(error, operation), `Allow delivery to ${name}`, connection.engineOrigin),
        ]);
      },
    );
  };

  const handleDelete = () => {
    if (selected === undefined || selected.subscription.pending) {
      return;
    }
    const name = endpointName(selected.subscription.endpoint);
    const signal = pageSignal();
    setDeleting(true);
    unsubscribe(selected.subscription.arn, signal).then(
      () => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteOpen(false);
        setSelectedKey(undefined);
        flash.show([{ type: 'success', content: `Deleted the subscription of ${name}` }]);
      },
      (error: unknown) => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteOpen(false);
        flash.show([
          actionFailureItem(
            failureOf(error, OPERATIONS.unsubscribe),
            `Delete the subscription of ${name}`,
            connection.engineOrigin,
          ),
        ]);
      },
    );
  };

  const handlePageChange = ({ detail }: { detail: { currentPageIndex: number } }) => {
    setSettingsFor(undefined);
    setSelectedKey(undefined);
    goToPage(detail.currentPageIndex);
  };

  const columns: TableProps.ColumnDefinition<Row>[] = [
    {
      id: 'protocol',
      header: 'Protocol',
      cell: (row) => <ValueText kind="fixed" value={row.subscription.protocol} />,
    },
    {
      id: 'endpoint',
      header: 'Endpoint',
      isRowHeader: true,
      minWidth: ENDPOINT_MIN_WIDTH,
      cell: (row) => {
        const { endpoint } = row.subscription;
        const value = <ValueText kind="address" value={endpoint} />;
        if (row.deliveryProtocol === undefined) {
          return value;
        }
        const name = endpointName(endpoint);
        const href = row.deliveryProtocol === 'sqs' ? queuePath(name) : functionPath(name);
        return (
          <Link href={href} onFollow={handleFollow}>
            {value}
          </Link>
        );
      },
    },
    {
      id: 'status',
      header: 'Status',
      minWidth: labelColumnWidth(STATUS_LABELS),
      cell: (row) =>
        row.subscription.pending ? (
          <StatusIndicator type="pending">Pending confirmation</StatusIndicator>
        ) : (
          <StatusIndicator type="success">Confirmed</StatusIndicator>
        ),
    },
    {
      id: 'delivery',
      header: 'Delivery',
      minWidth: labelColumnWidth(DELIVERY_LABELS),
      cell: (row) => <RowDelivery row={row} topicArn={topicArn} connection={connection} onView={handleView} />,
    },
  ];

  const createButton = (primary: boolean) => (
    <Button variant={primary ? 'primary' : 'normal'} href={subscribeHref(topicArn)} onFollow={handleFollow}>
      Create subscription
    </Button>
  );

  let empty = null;
  if (listing.failure !== undefined) {
    empty = (
      <ReadFailure state={readFailureState(listing.failure, connection, 'subscription list')} onRetry={handleRetry} />
    );
  } else if (items !== undefined && items.length === 0) {
    empty = (
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            No subscriptions
          </Box>
          <Box variant="p" color="inherit">
            Nothing published to this topic is delivered anywhere yet.
          </Box>
        </SpaceBetween>
        <Box margin={{ top: 's' }}>{createButton(false)}</Box>
      </Box>
    );
  }

  let deleteReason = SELECT_FIRST;
  if (selected?.subscription.pending === true) {
    deleteReason = PENDING_REASON;
  }

  const settingsTarget = selected?.subscription;
  const canOpenSettings = settingsTarget !== undefined && !settingsTarget.pending && settingsTarget.arn !== '';

  return (
    <SpaceBetween size="l">
      <Table<Row>
        items={rows}
        trackBy="key"
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          const key = detail.selectedItems[0]?.key;
          if (key !== selectedKey) {
            setSettingsFor(undefined);
            setSelectedKey(key);
          }
        }}
        ariaLabels={{
          selectionGroupLabel: 'Subscription selection',
          itemSelectionLabel: (_, row) => `${row.subscription.protocol} ${row.subscription.endpoint}`,
        }}
        columnDefinitions={columns}
        wrapLines
        loading={listing.failure === undefined && items === undefined}
        loadingText="Loading subscriptions"
        empty={empty}
        header={
          <Header
            variant="h2"
            counter={items === undefined ? undefined : counterText(items.length, listing.openEnd)}
            description={DESCRIPTION}
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  ref={settingsButton}
                  disabled={!canOpenSettings}
                  disabledReason={
                    settingsTarget === undefined ? 'Select a subscription.' : 'A pending subscription has no ARN.'
                  }
                  onClick={() => {
                    if (canOpenSettings) {
                      setSettingsFor(settingsTarget);
                    }
                  }}
                >
                  Subscription settings
                </Button>
                <Button disabled={!canAllow} disabledReason={allowReason} loading={allowing} onClick={handleAllow}>
                  Allow delivery
                </Button>
                <Button
                  disabled={selected === undefined || selected.subscription.pending}
                  disabledReason={deleteReason}
                  onClick={() => {
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
                {createButton(true)}
              </SpaceBetween>
            }
          >
            Subscriptions
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={!loaded}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${String(page)}`,
            }}
            onChange={handlePageChange}
          />
        }
      />
      {settingsFor !== undefined && (
        <SubscriptionSettings
          key={settingsFor.arn}
          subscription={settingsFor}
          connection={connection}
          onSave={onSaveSetting}
          pending={settingsSave.pending}
          saveUnavailable={settingsSave.unavailableArns.has(settingsFor.arn)}
          onClose={() => {
            setSettingsFor(undefined);
            settingsButton.current?.focus();
          }}
        />
      )}
      {selected !== undefined && (
        <DeleteSubscriptionDialog
          visible={deleteOpen}
          endpointName={endpointName(selected.subscription.endpoint)}
          topicName={topicName}
          pending={deleting}
          onConfirm={handleDelete}
          onDismiss={() => {
            setDeleteOpen(false);
          }}
        />
      )}
    </SpaceBetween>
  );
}
