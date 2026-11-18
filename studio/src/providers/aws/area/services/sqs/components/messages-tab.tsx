import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ReadMessage } from '../api';
import { bodyPreview, nameFromArn, NONE, queuePath, type QueueSettings } from '../format';
import { MessageDetail } from './message-detail';
import { ReadWarning } from './read-warning';

// S2's tab "Messages" (issue 481, design tasks 2 and 4): the read warning, the read's controls, the last read's
// messages in the order returned, what the read could not show, the chosen message in full, and "Delete" of the
// selected ones. Nothing is read until "Read messages" is pressed: a read counts as a receive (PM decision).

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
}

/** What follows the table: why the read showed fewer than are available, or that none came. */
function afterRead(result: ReadResult, settings: QueueSettings): string | undefined {
  const shown = result.messages.length;
  const available = settings.available ?? 0;
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
  ];
  if (settings.fifo) {
    columns.push({
      id: 'group',
      header: 'Group',
      cell: (message) => <ValueText kind="name" value={message.groupId} none={NONE} />,
    });
  }
  if (deadLetterQueue) {
    columns.push({
      id: 'from',
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

  const sentence = result === undefined ? undefined : afterRead(result, settings);

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
          {sentence !== undefined && (
            <Box variant="p" color="text-body-secondary">
              {sentence}
            </Box>
          )}
        </SpaceBetween>
      )}
      {detail !== undefined && <MessageDetail message={detail} />}
    </SpaceBetween>
  );
}
