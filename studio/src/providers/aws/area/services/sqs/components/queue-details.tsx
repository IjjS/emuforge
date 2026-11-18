import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { QueueDetails } from '../api';
import { receives } from './counts';
import { NONE, queuePath, queueType, type QueueSettings } from '../format';

// S2's summary "Details" (issue 481, design task 2): the queue's URL and ARN with their copy controls, its type and
// counts, its dead-letter queue and the queues it is one for. Every value is the emulator's, rendered as text.

/** Under the URL (requirement, "EmuForge's own text"). */
export const URL_NOTE = 'As the emulator returns it. Studio never sends a request to this address.';

/** Two columns leave an ARN at least a line of its parts at 390 wide; one column below that. */
const MIN_COLUMN_WIDTH = 280;

/** The three counts keep one row down to 390 wide. */
const COUNT_MIN_COLUMN_WIDTH = 80;

function count(value: number | undefined): ReactNode {
  return <ValueText kind="fixed" value={value === undefined ? undefined : String(value)} none={NONE} />;
}

export function QueueDetailsSection({ details, settings }: { details: QueueDetails; settings: QueueSettings }) {
  const handleFollow = useFollow();
  const link = (name: string) => (
    <Link href={queuePath(name)} onFollow={handleFollow}>
      <ValueText kind="name" value={name} />
    </Link>
  );
  const policy = settings.redrivePolicy;
  return (
    <Container header={<Header variant="h2">Details</Header>}>
      <SpaceBetween size="l">
        <KeyValuePairs
          columns={3}
          minColumnWidth={MIN_COLUMN_WIDTH}
          items={[
            {
              label: 'URL',
              value: (
                <SpaceBetween size="xxxs">
                  <CopyValue label="URL" value={details.url} kind="address" none={NONE} />
                  <Box variant="small" color="text-body-secondary">
                    {URL_NOTE}
                  </Box>
                </SpaceBetween>
              ),
            },
            { label: 'ARN', value: <CopyValue label="ARN" value={settings.arn} kind="address" none={NONE} /> },
            { label: 'Type', value: <ValueText kind="fixed" value={queueType(settings)} /> },
          ]}
        />
        <KeyValuePairs
          columns={3}
          minColumnWidth={COUNT_MIN_COLUMN_WIDTH}
          items={[
            { label: 'Available', value: count(settings.available) },
            { label: 'In flight', value: count(settings.inFlight) },
            { label: 'Delayed', value: count(settings.delayed) },
          ]}
        />
        <KeyValuePairs
          columns={3}
          minColumnWidth={MIN_COLUMN_WIDTH}
          items={[
            {
              label: 'Dead-letter queue',
              value:
                policy === undefined ? (
                  NONE
                ) : (
                  <>
                    {link(policy.deadLetterQueue)}
                    {policy.maxReceiveCount !== undefined && (
                      <>
                        {' '}
                        <ValueText kind="text" value={`after ${receives(policy.maxReceiveCount)}`} />
                      </>
                    )}
                  </>
                ),
            },
            {
              label: 'Dead-letter queue for',
              value:
                details.sources.length === 0 ? (
                  NONE
                ) : (
                  <SpaceBetween size="xxxs">
                    {details.sources.map((source) => (
                      <div key={source}>{link(source)}</div>
                    ))}
                  </SpaceBetween>
                ),
            },
          ]}
        />
      </SpaceBetween>
    </Container>
  );
}
