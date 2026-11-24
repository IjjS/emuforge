import type { KeyMetadata } from '@aws-sdk/client-kms';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs from '@cloudscape-design/components/tabs';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { KMS_OPERATIONS } from '../api';
import { Access } from '../components/access/access';
import { Labels } from '../components/labels/labels';
import { KeyState } from '../components/lifecycle/key-state';
import { Lifecycle } from '../components/lifecycle/lifecycle';
import { useLifecycleAction, type LifecycleAction } from '../components/lifecycle/use-lifecycle-action';
import { Rotation } from '../components/rotation/rotation';
import { KEYS_PATH } from '../paths';
import { connectionFailure, KMS_KEYS, useKmsKey } from '../queries';

type ReadKey = KeyMetadata & { KeyId: string };

function KeyDetails({ action, metadata }: { action: LifecycleAction; metadata: ReadKey }) {
  const deletion =
    metadata.DeletionDate === undefined
      ? []
      : [{ label: 'Deletion date', value: creationDateText(metadata.DeletionDate) }];
  return (
    <Container
      header={
        <Header variant="h2" actions={<Lifecycle action={action} metadata={metadata} />}>
          Key metadata
        </Header>
      }
    >
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
          minColumnWidth={220}
          items={[
            { label: 'Status', value: <KeyState state={metadata.KeyState} /> },
            { label: 'Key spec', value: <ValueText kind="fixed" value={metadata.KeySpec} none="–" /> },
            { label: 'Key usage', value: <ValueText kind="fixed" value={metadata.KeyUsage} none="–" /> },
            { label: 'Origin', value: <ValueText kind="fixed" value={metadata.Origin} none="–" /> },
            { label: 'Created', value: creationDateText(metadata.CreationDate) },
            ...deletion,
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
  const queryClient = useQueryClient();
  const action = useLifecycleAction(connection, keyId);
  const [attemptedRetry, setAttemptedRetry] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const refreshButton = useRef<ButtonProps.Ref>(null);
  const retryRequested = useRef(false);
  const retryHadFocus = useRef(false);
  const captureRetryFocus = useCallback((region: HTMLDivElement | null) => {
    if (region === null) return;
    retryHadFocus.current = false;
    return () => {
      // Capture focus before the successful read removes the Retry button.
      const focused = region.ownerDocument.activeElement;
      retryHadFocus.current =
        retryRequested.current && focused instanceof HTMLButtonElement && region.contains(focused);
      retryRequested.current = false;
    };
  }, []);
  const offline = connectionFailure(connection, KMS_OPERATIONS.describeKey);
  const read = useKmsKey(connection.engineOrigin, keyId, offline === undefined || attemptedRetry);
  // A failed reread reports its error above the panels while the current visit keeps its last metadata.
  const [lastKey, setLastKey] = useState<typeof read.key>();
  if (read.key !== undefined && read.key !== lastKey) setLastKey(read.key);
  const metadata = read.key === undefined ? lastKey : read.key;
  const failure = read.failure ?? (attemptedRetry ? undefined : offline);
  const retainedMetadataFailed = read.failure !== undefined && metadata !== undefined && metadata !== null;
  const showPanels = metadata !== null && (failure === undefined || metadata !== undefined || attemptedRetry);
  useLayoutEffect(() => {
    if (failure !== undefined || read.key === undefined || !retryHadFocus.current) return;
    retryHadFocus.current = false;
    if (document.activeElement === document.body) refreshButton.current?.focus();
  }, [failure, read.key]);

  const handleRefresh = () => {
    if (refreshing) return;
    setAttemptedRetry(true);
    setRefreshing(true);
    const endpoint = connection.engineOrigin;
    // Keep the previous metadata mounted while this visit's query reads again.
    const detail = { queryKey: [...KMS_KEYS.detail(keyId), endpoint] };
    void queryClient
      .cancelQueries(detail)
      .then(() => queryClient.invalidateQueries(detail))
      .finally(() => setRefreshing(false));
    const panelReads = [
      ['kms', 'aliases', keyId],
      ['kms', 'tags', keyId],
      ['kms', 'policy-names', endpoint, keyId],
      ['kms', 'default-policy', endpoint, keyId],
      ['kms', 'grants', keyId],
      ['kms', 'rotation-status', endpoint, keyId],
      ['kms', 'rotation-history', keyId],
    ];
    for (const queryKey of panelReads) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            <Button
              ref={refreshButton}
              iconName="refresh"
              ariaLabel="Refresh"
              loading={refreshing}
              loadingText="Refreshing key metadata"
              onClick={handleRefresh}
            />
          }
        >
          Key details
        </Header>
      }
    >
      <div className="aws-area-announcer" role="status" aria-atomic="true">
        {retainedMetadataFailed && !refreshing
          ? 'Key metadata could not be refreshed. Showing the last successful read.'
          : ''}
      </div>
      <SpaceBetween size="l">
        {failure !== undefined && (
          <div ref={captureRetryFocus}>
            <Container>
              <ReadFailure
                state={readFailureState(failure, connection, `key (${failure.operation})`)}
                onRetry={() => {
                  if (refreshing) return;
                  retryRequested.current = true;
                  handleRefresh();
                }}
              />
            </Container>
          </div>
        )}
        {read.key === null && (
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
        )}
        {showPanels && (
          <Tabs
            key="key-settings"
            ariaLabel="Key settings"
            tabs={[
              {
                id: 'details',
                label: 'Details',
                contentRenderStrategy: 'lazy',
                content:
                  metadata !== undefined && metadata !== null ? (
                    <KeyDetails action={action} metadata={metadata as ReadKey} />
                  ) : failure === undefined ? (
                    <Container>
                      <StatusIndicator type="loading">Loading key…</StatusIndicator>
                    </Container>
                  ) : null,
              },
              {
                id: 'labels',
                label: 'Labels',
                contentRenderStrategy: 'eager',
                content: <Labels connection={connection} keyId={keyId} />,
              },
              {
                id: 'access',
                label: 'Access',
                contentRenderStrategy: 'lazy',
                content: <Access connection={connection} keyId={keyId} />,
              },
              {
                id: 'rotation',
                label: 'Rotation',
                contentRenderStrategy: 'lazy',
                content: <Rotation connection={connection} keyId={keyId} keySpec={metadata?.KeySpec} />,
              },
            ]}
          />
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}

export function KeyPage({ connection, params }: ScreenPageProps) {
  useShowsResources('keys');
  const keyId = params.keyid ?? '';
  const connected = connection.result === undefined || connection.result.kind === 'connected';
  return (
    <KeyVisit key={JSON.stringify([keyId, connection.engineOrigin, connected])} connection={connection} keyId={keyId} />
  );
}
