import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { ReactNode } from 'react';

import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ReadMessage } from '../api';
import { times } from './counts';
import { bodyPreview, nameFromArn, NONE, queuePath, type QueueSettings } from '../format';
import { MessageDetail } from './message-detail';
import { ReadWarning } from './read-warning';

// S2's tab "Messages" (issue 481, design tasks 2 and 4): the read warning, the read's controls, the last read's
// messages in the order returned, what the read could not show, the chosen message in full, and "Delete" of the
// selected ones. Nothing is read until "Read messages" is pressed: a read counts as a receive (PM decision).

/** A message ID, a group and a source queue keep room for 24 characters, as the queue list's names (`aws-area.md`, entry 4). */
const NAME_MIN_WIDTH = '28ch';

/** At most this many messages come in one read. */
export const READ_SIZE = 10;

/** The waits "Wait for messages" offers, in seconds (`ReceiveMessage` took up to 20). */
const WAITS: readonly SelectProps.Option[] = [
  { value: '0', label: "Don't wait" },
  { value: '5', label: 'Up to 5 seconds' },
  { value: '10', label: 'Up to 10 seconds' },
  { value: '20', label: 'Up to 20 seconds' },
];

export const FIFO_SENTENCE =
  'Messages of a group your app has received and not yet deleted are not returned until they are visible again.';

export const EMPTY_READ =
  'No message is available to read. Messages in flight or delayed are not returned until they are visible again.';

function showingFirst(shown: number, available: number): string {
  return `Showing the first ${String(shown)} of ${String(available)} available messages. A read returns the same first messages each time, at most 10.`;
}

/** One read's answer. */
export interface ReadResult {
  messages: ReadMessage[];
  readAt: Date;
  /** The queue's `ApproximateNumberOfMessages`, read just before the read. */
  availableBefore?: number;
  /** On a queue with a redrive policy: how much the dead-letter queue's count rose across the read, when known. */
  deadLetterRise?: number;
}

/** What follows the table: why the read showed fewer than are available, or that none came. */
function afterRead(result: ReadResult, settings: QueueSettings, link: (name: string) => ReactNode): ReactNode {
  const shown = result.messages.length;
  const available = settings.available ?? 0;
  const policy = settings.redrivePolicy;
  // On a queue with a redrive policy a read that returned fewer than were available either moved them (the
  // dead-letter queue's count rose across it, probe-3 §1) or found them taken by another consumer.
  if (policy !== undefined && result.availableBefore !== undefined && shown < result.availableBefore) {
    // No more were moved than the read failed to show.
    const rise = Math.min(result.deadLetterRise ?? 0, result.availableBefore - shown);
    if (rise > 0) {
      const count = policy.maxReceiveCount === undefined ? 'the set number of times' : times(policy.maxReceiveCount);
      return (
        <>
          {rise === 1 ? '1 message' : `${String(rise)} messages`} received {count} in this queue{' '}
          {rise === 1 ? 'was' : 'were'} moved to {link(policy.deadLetterQueue)} by this read instead of being shown.
        </>
      );
    }
    const before = result.availableBefore;
    return `This read returned ${String(shown)} of the ${before === 1 ? '1 message' : `${String(before)} messages`} available at ${creationDateText(result.readAt)}.`;
  }
  if (settings.fifo && shown < available && shown < READ_SIZE) {
    return FIFO_SENTENCE;
  }
  if (shown === 0) {
    return EMPTY_READ;
  }
  return shown < available ? showingFirst(shown, available) : undefined;
}

export interface MessagesTabProps {
  settings: QueueSettings;
  /** The queue is a dead-letter queue: each message shows where it came from. */
  deadLetterQueue: boolean;
  wait: number;
  onWaitChange: (seconds: number) => void;
  reading: boolean;
  onRead: () => void;
  result: ReadResult | undefined;
  selected: readonly ReadMessage[];
  onSelectionChange: (selected: ReadMessage[]) => void;
  detail: ReadMessage | undefined;
  onShowDetail: (message: ReadMessage) => void;
  onDelete: () => void;
}

export function MessagesTab(props: MessagesTabProps) {
  const { settings, deadLetterQueue, result, selected, detail } = props;
  const handleFollow = useFollow();
  const waitOption = WAITS.find((option) => option.value === String(props.wait)) ?? WAITS[0] ?? null;

  const columns: TableProps.ColumnDefinition<ReadMessage>[] = [
    {
      id: 'id',
      minWidth: NAME_MIN_WIDTH,
      header: 'Message ID',
      isRowHeader: true,
      cell: (message) => (
        <Link
          onFollow={(event) => {
            event.preventDefault();
            props.onShowDetail(message);
          }}
        >
          <ValueText kind="name" value={message.id} />
        </Link>
      ),
    },
    {
      id: 'receiveCount',
      header: 'Receive count',
      cell: (message) => (
        <ValueText
          kind="fixed"
          value={message.receiveCount === undefined ? undefined : String(message.receiveCount)}
          none={NONE}
        />
      ),
    },
    {
      id: 'body',
      header: 'Body',
      cell: (message) => {
        const preview = bodyPreview(message.body);
        return <ValueText kind="text" value={preview.more ? `${preview.first}…` : preview.first} none={NONE} />;
      },
    },
    {
      id: 'sent',
      header: 'Sent',
      cell: (message) => <ValueText kind="fixed" value={creationDateText(message.sent)} />,
    },
  ];
  if (settings.fifo) {
    columns.push({
      id: 'group',
      minWidth: NAME_MIN_WIDTH,
      header: 'Group',
      cell: (message) => <ValueText kind="name" value={message.groupId} none={NONE} />,
    });
  }
  if (deadLetterQueue) {
    columns.push({
      id: 'from',
      minWidth: NAME_MIN_WIDTH,
      header: 'From',
      cell: (message) => {
        if (message.deadLetterSourceArn === undefined) {
          return NONE;
        }
        const source = nameFromArn(message.deadLetterSourceArn);
        return (
          <Link href={queuePath(source)} onFollow={handleFollow}>
            <ValueText kind="name" value={source} />
          </Link>
        );
      },
    });
  }

  const queueLink = (name: string) => (
    <Link href={queuePath(name)} onFollow={handleFollow}>
      <ValueText kind="name" value={name} />
    </Link>
  );
  const sentence = result === undefined ? undefined : afterRead(result, settings, queueLink);

  return (
    <SpaceBetween size="l">
      <SpaceBetween size="m">
        <ReadWarning policy={settings.redrivePolicy} />
        <SpaceBetween direction="horizontal" size="s" alignItems="end">
          <FormField label="Wait for messages">
            <Select
              selectedOption={waitOption}
              options={[...WAITS]}
              disabled={props.reading}
              onChange={({ detail: change }) => {
                props.onWaitChange(Number(change.selectedOption.value ?? '0'));
              }}
            />
          </FormField>
          <Button variant="primary" loading={props.reading} disabled={props.reading} onClick={props.onRead}>
            Read messages
          </Button>
        </SpaceBetween>
      </SpaceBetween>
      {result !== undefined && (
        <SpaceBetween size="s">
          <Table<ReadMessage>
            variant="container"
            items={result.messages}
            trackBy="id"
            columnDefinitions={columns}
            wrapLines
            stickyColumns={{ first: 1 }}
            selectionType="multi"
            selectedItems={[...selected]}
            onSelectionChange={({ detail: change }) => {
              props.onSelectionChange(change.selectedItems);
            }}
            ariaLabels={{
              selectionGroupLabel: 'Messages to delete',
              allItemsSelectionLabel: () => 'Select every message',
              itemSelectionLabel: (_, message) => `Select message ${message.id}`,
            }}
            empty={
              <Box textAlign="center" color="inherit">
                <Box variant="strong" color="inherit">
                  No messages read
                </Box>
              </Box>
            }
            header={
              <Header
                counter={`(${String(result.messages.length)})`}
                description={`Read at ${creationDateText(result.readAt)}`}
                actions={
                  <Button
                    disabled={selected.length === 0}
                    disabledReason="Select the messages to delete."
                    onClick={props.onDelete}
                  >
                    Delete
                  </Button>
                }
              >
                Messages read
              </Header>
            }
          />
        </SpaceBetween>
      )}
      {/* Always rendered, so what a read could not show is announced when it changes. */}
      <div role="status" aria-live="polite">
        {sentence !== undefined && (
          <Box variant="p" color="text-body-secondary">
            {sentence}
          </Box>
        )}
      </div>
      {detail !== undefined && <MessageDetail message={detail} />}
    </SpaceBetween>
  );
}
