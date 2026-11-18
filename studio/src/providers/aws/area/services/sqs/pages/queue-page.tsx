import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useState } from 'react';

import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { AreaConnection } from '../../../components/emulator-line';
import type { ScreenPageProps } from '../../../screens';
import { NO_SUCH_QUEUE, OPERATIONS, type OutgoingMessage, type QueueDetails, type ReadMessage } from '../api';
import { ConfirmDialog } from '../components/confirm-dialog';
import { MessagesTab, type ReadResult } from '../components/messages-tab';
import { actionFailureOf, usePageSignal } from '../components/page-signal';
import { QueueDetailsSection } from '../components/queue-details';
import { RedriveTab } from '../components/redrive-tab';
import { EMPTY_SEND_FORM, type SendForm } from '../components/send-form';
import { SendMessageForm } from '../components/send-message-form';
import { QUEUES_PATH, queueSettings, type QueueSettings } from '../format';
import { useDeleteMessages, usePurgeQueue, useQueue, useReceiveMessages, useSendMessage } from '../queries';
import { QUEUES_TITLE } from './queue-list-page';

// A queue's page, S2 (issue 481, design tasks 2 to 4): its details, then the tabs "Messages" (the read warning, a read
// that leaves the messages in the queue, a message in full, deleting the selected ones), "Send message" and, on a
// dead-letter queue, "Redrive". "Purge" is the header's. The selected tab is the page's own state, not the address's.
// Every value from the emulator is rendered as text; every action's result is the area's Flashbar's.

const REFRESHED = 'Queue refreshed';

type TabId = 'messages' | 'send' | 'redrive';

/** "{n} message" or "{n} messages". */
function messages(count: number): string {
  return count === 1 ? '1 message' : `${String(count)} messages`;
}

/** "No queue named {name}", with Cloudscape's empty-state pattern, in the place of the details and tabs. */
function NotFound({ name }: { name: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            <ValueText kind="text" value="No queue named " />
            <ValueText kind="name" value={name} />
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no queue of this name. It may have been deleted, or the emulator restarted.
          </Box>
          <Link href={QUEUES_PATH} onFollow={handleFollow}>
            {QUEUES_TITLE}
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/** The parts of the page that act on the queue once it has been read. */
interface QueueViewProps {
  details: QueueDetails;
  settings: QueueSettings;
  connection: AreaConnection;
  read: ReadState;
  onRead: (read: ReadState) => void;
  form: SendForm;
  onFormChange: (form: SendForm) => void;
  purgeOpen: boolean;
  onPurgeClose: () => void;
}

/** What "Messages" holds while the page is open, across its tabs. */
interface ReadState {
  wait: number;
  result: ReadResult | undefined;
  selected: ReadMessage[];
  detail: ReadMessage | undefined;
}

const START_READ: ReadState = { wait: 0, result: undefined, selected: [], detail: undefined };

function QueueView(props: QueueViewProps) {
  const { details, settings, connection, read, onRead } = props;
  const engineOrigin = connection.engineOrigin;
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const receive = useReceiveMessages(engineOrigin);
  const send = useSendMessage(engineOrigin);
  const remove = useDeleteMessages(engineOrigin);
  const purge = usePurgeQueue(engineOrigin);
  const [tab, setTab] = useState<TabId>('messages');
  const [reading, setReading] = useState(false);
  const [sending, setSending] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [purging, setPurging] = useState(false);
  const name = details.name;
  const deadLetterQueue = details.sources.length > 0;

  const fail = (error: unknown, operation: string, what: string, signal: AbortSignal) => {
    if (!signal.aborted) {
      flash.show([actionFailureItem(actionFailureOf(error, operation), what, engineOrigin)]);
    }
  };

  const handleRead = (availableBefore: number | undefined) => {
    if (reading) {
      return;
    }
    const signal = pageSignal();
    setReading(true);
    receive(details.url, read.wait, signal).then(
      (messages) => {
        if (!signal.aborted) {
          onRead({
            ...read,
            result: { messages, readAt: new Date(), ...(availableBefore === undefined ? {} : { availableBefore }) },
            selected: [],
            detail: undefined,
          });
          setReading(false);
        }
      },
      (error: unknown) => {
        fail(error, OPERATIONS.receiveMessage, 'Reading the messages', signal);
        if (!signal.aborted) {
          setReading(false);
        }
      },
    );
  };

  const handleSend = (message: OutgoingMessage) => {
    const signal = pageSignal();
    setSending(true);
    send({ url: details.url, fifo: settings.fifo }, message, signal).then(
      (sent) => {
        if (!signal.aborted) {
          setSending(false);
          flash.show([
            {
              type: 'success',
              header: `Message sent to ${name}`,
              content: (
                <SpaceBetween size="xxxs">
                  <div>
                    Message ID: <ValueText kind="name" value={sent.messageId} />
                  </div>
                  {sent.sequenceNumber !== undefined && (
                    <div>
                      Sequence number: <ValueText kind="fixed" value={sent.sequenceNumber} />
                    </div>
                  )}
                </SpaceBetween>
              ),
            },
          ]);
        }
      },
      (error: unknown) => {
        fail(error, OPERATIONS.sendMessage, 'Sending the message', signal);
        if (!signal.aborted) {
          setSending(false);
        }
      },
    );
  };

  const handleDelete = () => {
    const chosen = read.selected;
    const signal = pageSignal();
    setDeleting(true);
    remove(
      details.url,
      chosen.map(({ id, receiptHandle }) => ({ id, receiptHandle })),
      signal,
    ).then(
      (result) => {
        if (signal.aborted) {
          return;
        }
        setDeleting(false);
        setDeleteOpen(false);
        const deleted = new Set(result.deleted);
        const failed = new Set(result.failed.map((failure) => failure.id));
        const kept = (read.result?.messages ?? []).filter((message) => !deleted.has(message.id));
        onRead({
          ...read,
          result: read.result === undefined ? undefined : { ...read.result, messages: kept },
          selected: chosen.filter((message) => failed.has(message.id)),
          detail: read.detail !== undefined && deleted.has(read.detail.id) ? undefined : read.detail,
        });
        const total = chosen.length;
        if (result.failed.length === 0) {
          flash.show([{ type: 'success', content: `Deleted ${messages(total)} from ${name}` }]);
          return;
        }
        const item: FlashItem = {
          type: 'error',
          header: `${String(result.failed.length)} of ${messages(total)} could not be deleted`,
          content: (
            <SpaceBetween size="xxxs">
              <ul>
                {result.failed.map((failure) => (
                  <li key={failure.id}>
                    <ValueText kind="name" value={failure.id} />:{' '}
                    <Box variant="code" display="inline">
                      {failure.code}
                    </Box>
                    {failure.message === undefined ? null : <>: {failure.message}</>}
                  </li>
                ))}
              </ul>
              {result.deleted.length > 0 && <div>{`${String(result.deleted.length)} deleted`}</div>}
            </SpaceBetween>
          ),
        };
        flash.show([item]);
      },
      (error: unknown) => {
        fail(error, OPERATIONS.deleteMessageBatch, 'Deleting the messages', signal);
        if (!signal.aborted) {
          setDeleting(false);
          setDeleteOpen(false);
        }
      },
    );
  };

  const handlePurge = () => {
    const signal = pageSignal();
    setPurging(true);
    purge(details.url, signal).then(
      () => {
        if (!signal.aborted) {
          setPurging(false);
          props.onPurgeClose();
          onRead({ ...read, result: undefined, selected: [], detail: undefined });
          flash.show([{ type: 'success', content: `Purged ${name}` }]);
        }
      },
      (error: unknown) => {
        fail(error, OPERATIONS.purgeQueue, `Purging ${name}`, signal);
        if (!signal.aborted) {
          setPurging(false);
          props.onPurgeClose();
        }
      },
    );
  };

  const tabs: TabsProps.Tab[] = [
    {
      id: 'messages',
      label: 'Messages',
      content: (
        <MessagesTab
          settings={settings}
          deadLetterQueue={deadLetterQueue}
          wait={read.wait}
          onWaitChange={(wait) => {
            onRead({ ...read, wait });
          }}
          reading={reading}
          onRead={handleRead}
          result={read.result}
          selected={read.selected}
          onSelectionChange={(selected) => {
            onRead({ ...read, selected });
          }}
          detail={read.detail}
          onShowDetail={(detail) => {
            onRead({ ...read, detail });
          }}
          onDelete={() => {
            setDeleteOpen(true);
          }}
        />
      ),
    },
    {
      id: 'send',
      label: 'Send message',
      content: (
        <SendMessageForm
          settings={settings}
          form={props.form}
          onChange={props.onFormChange}
          sending={sending}
          onSend={handleSend}
        />
      ),
    },
  ];
  if (deadLetterQueue) {
    tabs.push({
      id: 'redrive',
      label: 'Redrive',
      content: <RedriveTab details={details} settings={settings} connection={connection} />,
    });
  }

  const count = read.selected.length;
  return (
    <>
      <SpaceBetween size="l">
        <QueueDetailsSection details={details} settings={settings} />
        <Tabs
          tabs={tabs}
          activeTabId={tab}
          onChange={({ detail }) => {
            setTab(detail.activeTabId as TabId);
          }}
          keyboardActivationMode="manual"
          ariaLabel="Queue tabs"
        />
      </SpaceBetween>
      <ConfirmDialog
        visible={deleteOpen}
        header={`Delete ${messages(count)} from ${name}?`}
        body="They are deleted from your local emulator. This cannot be undone."
        word="delete"
        action="Delete"
        pending={deleting}
        onConfirm={handleDelete}
        onDismiss={() => {
          setDeleteOpen(false);
        }}
      />
      <ConfirmDialog
        visible={props.purgeOpen}
        header={`Purge ${name}?`}
        body={`Every message in ${name} is deleted from your local emulator. This cannot be undone.`}
        word="purge"
        action="Purge"
        pending={purging}
        onConfirm={handlePurge}
        onDismiss={props.onPurgeClose}
      />
    </>
  );
}

/**
 * `/aws/sqs/queues/queue/{name}`: the queue `name`, read through the engine with `GetQueueUrl`, then its attributes
 * and dead-letter sources, on every opening, refresh and action. No message is read until "Read messages" is
 * pressed. A failed read, or one shown while the connection was not connected, is read again by itself once the
 * connection is connected again (requirement, "States": after an emulator restart, "No queue named …").
 */
export function QueuePage({ connection, params }: ScreenPageProps) {
  useShowsResources('queues');
  const name = params['name'] ?? '';
  const [announcement, announce] = useAnnouncer();
  const queue = useQueue(connection.engineOrigin, name);
  const { value, failure, refresh } = queue;
  const details = value !== undefined && value !== NO_SUCH_QUEUE ? value : undefined;
  const settings = details === undefined ? undefined : queueSettings(details.attributes);
  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'queue');
  const [read, setRead] = useState<ReadState>(START_READ);
  const [form, setForm] = useState<SendForm>(EMPTY_SEND_FORM);
  const [purgeOpen, setPurgeOpen] = useState(false);

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [refreshing, setRefreshing] = useState(false);
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (refreshing && value !== undefined && !queue.loading) {
    setRefreshing(false);
    announce(REFRESHED);
  } else if (refreshing && failure !== undefined) {
    setRefreshing(false);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }
  // A queue no longer held has no messages to show.
  if (value === NO_SUCH_QUEUE && read.result !== undefined) {
    setRead({ ...START_READ, wait: read.wait });
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
  }, [refresh]);

  let content;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={refresh} />
      </Container>
    );
  } else if (value === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading queue</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (details === undefined || settings === undefined) {
    content = <NotFound name={name} />;
  } else {
    content = (
      <QueueView
        details={details}
        settings={settings}
        connection={connection}
        read={read}
        onRead={setRead}
        form={form}
        onFormChange={setForm}
        purgeOpen={purgeOpen}
        onPurgeClose={() => {
          setPurgeOpen(false);
        }}
      />
    );
  }

  return (
    <>
      <ContentLayout
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={queue.loading}
                  disabledReason="Reading the queue"
                  onClick={handleRefresh}
                />
                <Button
                  disabled={details === undefined}
                  disabledReason={queue.loading ? 'Reading the queue' : 'There is no queue to purge'}
                  onClick={() => {
                    setPurgeOpen(true);
                  }}
                >
                  Purge
                </Button>
              </SpaceBetween>
            }
          >
            <ValueText kind="name" value={name} />
          </Header>
        }
      >
        {content}
      </ContentLayout>
      {announcement}
    </>
  );
}
