import type { KeyMetadata } from '@aws-sdk/client-kms';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { KMS_OPERATIONS } from '../api';
import { KEYS_PATH } from '../paths';
import { connectionFailure, useKmsKey } from '../queries';

function KeyDetails({ metadata }: { metadata: KeyMetadata }) {
  return (
    <Container header={<Header variant="h2">Key metadata</Header>}>
      <SpaceBetween size="l">
        <KeyValuePairs
          ariaLabel="Key identifiers"
          items={[
            { label: 'Key ID', value: <CopyValue label="Key ID" kind="name" value={metadata.KeyId} /> },
            { label: 'ARN', value: <CopyValue label="ARN" value={metadata.Arn} none="–" /> },
          ]}
        />
        <KeyValuePairs
          ariaLabel="Key properties"
          columns={3}
          items={[
            { label: 'Status', value: <ValueText kind="fixed" value={metadata.KeyState} none="–" /> },
            { label: 'Key spec', value: <ValueText kind="fixed" value={metadata.KeySpec} none="–" /> },
            { label: 'Key usage', value: <ValueText kind="fixed" value={metadata.KeyUsage} none="–" /> },
            { label: 'Origin', value: <ValueText kind="fixed" value={metadata.Origin} none="–" /> },
            { label: 'Created', value: creationDateText(metadata.CreationDate) },
          ]}
        />
        <KeyValuePairs
          items={[{ label: 'Description', value: <ValueText kind="text" value={metadata.Description} none="–" /> }]}
        />
      </SpaceBetween>
    </Container>
  );
}

function KeyVisit({ connection, keyId }: Pick<ScreenPageProps, 'connection'> & { keyId: string }) {
  const handleFollow = useFollow();
  const [attemptedRetry, setAttemptedRetry] = useState(false);
  const offline = connectionFailure(connection, KMS_OPERATIONS.describeKey);
  const read = useKmsKey(connection.engineOrigin, keyId, offline === undefined || attemptedRetry);
  const failure = read.failure ?? (attemptedRetry ? undefined : offline);
  const handleRefresh = () => {
    setAttemptedRetry(true);
    read.refresh();
  };

  return (
    <ContentLayout
      header={
        <Header variant="h1" actions={<Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />}>
          Key details
        </Header>
      }
    >
      {failure !== undefined ? (
        <Container>
          <ReadFailure
            state={readFailureState(failure, connection, `key (${failure.operation})`)}
            onRetry={handleRefresh}
          />
        </Container>
      ) : read.key === undefined ? (
        <Container>
          <StatusIndicator type="loading">Loading key…</StatusIndicator>
        </Container>
      ) : read.key === null ? (
        <Container>
          <Box textAlign="center">
            <SpaceBetween size="xs">
              <Box variant="strong">Key not found</Box>
              <Link href={KEYS_PATH} onFollow={handleFollow}>
                View customer managed keys
              </Link>
            </SpaceBetween>
          </Box>
        </Container>
      ) : (
        <KeyDetails metadata={read.key} />
      )}
    </ContentLayout>
  );
}

export function KeyPage({ connection, params }: ScreenPageProps) {
  useShowsResources('keys');
  const keyId = params.keyId ?? '';
  const connected = connection.result === undefined || connection.result.kind === 'connected';
  return (
    <KeyVisit key={JSON.stringify([keyId, connection.engineOrigin, connected])} connection={connection} keyId={keyId} />
  );
}
