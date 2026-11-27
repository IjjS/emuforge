import type { DescribeEventBusResponse } from '@aws-sdk/client-eventbridge';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useEffect } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import type { useResourceTags } from '../queries';

interface BusDetailsProps {
  connection: AreaConnection;
  bus: DescribeEventBusResponse;
  tags: ReturnType<typeof useResourceTags>;
}

export function BusDetails({ connection, bus, tags }: BusDetailsProps) {
  const [announcement, announce] = useAnnouncer();
  const failure = tags.failure && readFailureState(tags.failure, connection, 'event bus tags');
  const message = failure?.firstText ?? '';
  const deadLetterArn = bus.DeadLetterConfig?.Arn;

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  return (
    <SpaceBetween size="m">
      <Container header={<Header variant="h2">Details</Header>}>
        <SpaceBetween size="m">
          <KeyValuePairs
            items={[
              { label: 'ARN', value: <CopyValue label="ARN" value={bus.Arn} none="-" /> },
              { label: 'Description', value: <ValueText kind="text" value={bus.Description} none="-" /> },
            ]}
          />
          <KeyValuePairs
            columns={2}
            items={[
              {
                label: 'Creation time',
                value: <ValueText kind="fixed" value={creationDateText(bus.CreationTime)} />,
              },
              {
                label: 'Last change',
                value: <ValueText kind="fixed" value={creationDateText(bus.LastModifiedTime)} />,
              },
            ]}
          />
          {bus.KmsKeyIdentifier && (
            <KeyValuePairs
              items={[{ label: 'KMS key', value: <CopyValue label="KMS key" value={bus.KmsKeyIdentifier} /> }]}
            />
          )}
          {deadLetterArn && (
            <KeyValuePairs
              items={[
                {
                  label: 'Dead-letter queue ARN',
                  value: <CopyValue label="Dead-letter queue ARN" value={deadLetterArn} />,
                },
              ]}
            />
          )}
          {bus.Policy && (
            <KeyValuePairs
              items={[
                {
                  label: 'Resource policy',
                  value: (
                    <Box
                      variant="pre"
                      margin={{ top: 'n', bottom: 'n' }}
                      nativeAttributes={{ style: { whiteSpace: 'pre-wrap' } }}
                    >
                      <ValueText kind="text" value={bus.Policy} />
                    </Box>
                  ),
                },
              ]}
            />
          )}
        </SpaceBetween>
      </Container>
      <Table
        ariaLabels={{ tableLabel: 'Tags' }}
        header={<Header variant="h2">Tags</Header>}
        items={Object.entries(tags.value ?? {}).map(([key, value]) => ({ key, value }))}
        trackBy="key"
        columnDefinitions={[
          {
            id: 'key',
            header: 'Key',
            isRowHeader: true,
            minWidth: '28ch',
            cell: ({ key }) => <ValueText kind="name" value={key} />,
          },
          { id: 'value', header: 'Value', cell: ({ value }) => <ValueText kind="text" value={value} /> },
        ]}
        wrapLines
        loading={tags.loading}
        loadingText="Loading tags"
        empty={
          failure === undefined ? (
            <Box textAlign="center">No tags</Box>
          ) : (
            <ReadFailure state={failure} onRetry={tags.refresh} />
          )
        }
      />
      {announcement}
    </SpaceBetween>
  );
}
