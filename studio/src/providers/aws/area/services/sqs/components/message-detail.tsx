import './message-detail.css';

import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import CopyToClipboard from '@cloudscape-design/components/copy-to-clipboard';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs, { type KeyValuePairsProps } from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import Toggle from '@cloudscape-design/components/toggle';
import { useEffect, useRef, useState } from 'react';

import { creationDateText } from '../../../components/format-date';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { MessageAttribute, ReadMessage } from '../api';
import { formattedJson, nameFromArn, NONE, queuePath } from '../format';

// One message of a read, in full (issue 481, design task 2, step 4): its body exactly as returned, with "Format JSON"
// for a body that parses as JSON; its message attributes (a Binary value as Base64 of its bytes); its system
// attributes. Every value is text, never HTML and never a followed link.

/** The container's heading, which takes focus each time a message is chosen. */
function messageTitle(id: string): string {
  return `Message ${id}`;
}

function Attributes({ attributes }: { attributes: readonly MessageAttribute[] }) {
  return (
    <Table<MessageAttribute>
      variant="embedded"
      header={<Header variant="h3">Message attributes</Header>}
      items={[...attributes]}
      trackBy="name"
      wrapLines
      empty={
        <Box textAlign="center" color="inherit">
          No message attributes
        </Box>
      }
      columnDefinitions={[
        { id: 'name', header: 'Name', isRowHeader: true, cell: (item) => <ValueText kind="name" value={item.name} /> },
        { id: 'type', header: 'Type', cell: (item) => <ValueText kind="fixed" value={item.type} /> },
        { id: 'value', header: 'Value', cell: (item) => <ValueText kind="text" value={item.value} none={NONE} /> },
      ]}
    />
  );
}

export function MessageDetail({ message }: { message: ReadMessage }) {
  const handleFollow = useFollow();
  const heading = useRef<HTMLDivElement>(null);
  const formatted = formattedJson(message.body);
  const [format, setFormat] = useState(false);

  // Focus moves to the heading each time another message is shown; "Format JSON" starts off for each.
  const [shownId, setShownId] = useState(message.id);
  if (shownId !== message.id) {
    setShownId(message.id);
    setFormat(false);
  }
  useEffect(() => {
    const h2 = heading.current?.querySelector('h2');
    if (h2 instanceof HTMLElement) {
      h2.setAttribute('tabindex', '-1');
      h2.focus();
    }
  }, [message.id]);

  const system: KeyValuePairsProps.Item[] = [
    { label: 'Sender ID', value: <ValueText kind="name" value={message.senderId} none={NONE} /> },
    { label: 'Sent', value: <ValueText kind="fixed" value={creationDateText(message.sent)} /> },
    { label: 'First received', value: <ValueText kind="fixed" value={creationDateText(message.firstReceived)} /> },
    {
      label: 'Receive count',
      value: (
        <ValueText
          kind="fixed"
          value={message.receiveCount === undefined ? undefined : String(message.receiveCount)}
          none={NONE}
        />
      ),
    },
  ];
  if (message.groupId !== undefined) {
    system.push({ label: 'Group ID', value: <ValueText kind="name" value={message.groupId} /> });
  }
  if (message.deduplicationId !== undefined) {
    system.push({ label: 'Deduplication ID', value: <ValueText kind="name" value={message.deduplicationId} /> });
  }
  if (message.sequenceNumber !== undefined) {
    system.push({ label: 'Sequence number', value: <ValueText kind="fixed" value={message.sequenceNumber} /> });
  }
  if (message.deadLetterSourceArn !== undefined) {
    const source = nameFromArn(message.deadLetterSourceArn);
    system.push({
      label: 'Dead-letter source queue',
      value: (
        <Link href={queuePath(source)} onFollow={handleFollow}>
          <ValueText kind="name" value={source} />
        </Link>
      ),
    });
  }

  return (
    <div ref={heading}>
      <Container header={<Header variant="h2">{messageTitle(message.id)}</Header>}>
        <SpaceBetween size="l">
          <SpaceBetween size="xs">
            <SpaceBetween direction="horizontal" size="m" alignItems="center">
              <Box variant="h3">Body</Box>
              <CopyToClipboard
                variant="button"
                textToCopy={message.body}
                copyButtonText="Copy body"
                copySuccessText="Body copied"
                copyErrorText="Body could not be copied"
                popoverRenderWithPortal={false}
              />
              {formatted !== undefined && (
                <Toggle
                  checked={format}
                  onChange={({ detail }) => {
                    setFormat(detail.checked);
                  }}
                >
                  Format JSON
                </Toggle>
              )}
            </SpaceBetween>
            <Box variant="code" display="block">
              <span className="aws-sqs-message-body">
                <ValueText kind="text" value={format && formatted !== undefined ? formatted : message.body} />
              </span>
            </Box>
          </SpaceBetween>
          <Attributes attributes={message.attributes} />
          <SpaceBetween size="xs">
            <Box variant="h3">System attributes</Box>
            <KeyValuePairs columns={2} items={system} />
          </SpaceBetween>
        </SpaceBetween>
      </Container>
    </div>
  );
}
