import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
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
import { deletionProtectionText, logGroupClassText, retentionText } from '../format';
import type { useLogGroupTags } from '../queries';

interface GroupDetailsProps {
  connection: AreaConnection;
  group: LogGroup;
  tags: ReturnType<typeof useLogGroupTags>;
  groupLoading: boolean;
  protectionPending: boolean;
  protectionUnavailable: boolean;
  onEditRetention: () => void;
  onSwitchProtection: () => void;
  onManageTags: () => void;
}

export function GroupDetails({
  connection,
  group,
  tags,
  groupLoading,
  protectionPending,
  protectionUnavailable,
  onEditRetention,
  onSwitchProtection,
  onManageTags,
}: GroupDetailsProps) {
  const protectionOn = group.deletionProtectionEnabled === true;
  const settingsDisabled = groupLoading || protectionPending || connection.engineOrigin === undefined;
  const [announcement, announce] = useAnnouncer();
  const failure = tags.failure && readFailureState(tags.failure, connection, 'log group tags');
  const message = failure?.firstText;

  useEffect(() => {
    announce(message ?? '');
  }, [announce, message]);

  return (
    <SpaceBetween size="m">
      <Container
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={settingsDisabled}
                  disabledReason={groupLoading ? 'Loading log group.' : undefined}
                  onClick={onEditRetention}
                >
                  Edit retention
                </Button>
                <Button
                  disabled={settingsDisabled || protectionUnavailable}
                  loading={protectionPending}
                  disabledReason={groupLoading && !protectionUnavailable ? 'Loading log group.' : undefined}
                  onClick={onSwitchProtection}
                >
                  {protectionOn ? 'Turn off deletion protection' : 'Turn on deletion protection'}
                </Button>
              </SpaceBetween>
            }
          >
            Details
          </Header>
        }
      >
        <SpaceBetween size="m">
          <KeyValuePairs
            items={[{ label: 'ARN', value: <CopyValue label="ARN" value={group.logGroupArn ?? group.arn} none="-" /> }]}
          />
          <KeyValuePairs
            columns={4}
            items={[
              { label: 'Class', value: <ValueText kind="fixed" value={logGroupClassText(group.logGroupClass)} /> },
              { label: 'Retention', value: <ValueText kind="fixed" value={retentionText(group.retentionInDays)} /> },
              {
                label: 'Deletion protection',
                value: <ValueText kind="fixed" value={deletionProtectionText(group.deletionProtectionEnabled)} />,
              },
              {
                label: 'Creation time',
                value: (
                  <ValueText
                    kind="fixed"
                    value={creationDateText(
                      group.creationTime === undefined ? undefined : new Date(group.creationTime),
                    )}
                  />
                ),
              },
            ]}
          />
        </SpaceBetween>
      </Container>
      <Table
        header={
          <Header
            variant="h2"
            actions={
              <Button
                disabled={settingsDisabled || tags.value === undefined}
                disabledReason={tags.loading ? 'Loading tags.' : undefined}
                onClick={onManageTags}
              >
                Manage tags
              </Button>
            }
          >
            Tags
          </Header>
        }
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
