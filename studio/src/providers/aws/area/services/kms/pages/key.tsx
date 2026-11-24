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
import { ReadFailure } from '../../../components/failure-states';
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
import { connectionFailure, KMS_KEYS, readFailureState, useKmsKey } from '../queries';

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
  const [retriedConnection, setRetriedConnection] = useState<ScreenPageProps['connection']['result']>();
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
  if (retriedConnection !== undefined && retriedConnection !== connection.result) setRetriedConnection(undefined);
  const attemptedRetry = retriedConnection !== undefined && retriedConnection === connection.result;
  const canRead = offline === undefined || attemptedRetry;
  const read = useKmsKey(connection.engineOrigin, keyId, canRead);
  // A new query generation cannot confirm the write with a cached or already in-flight answer.
  const action = useLifecycleAction(connection, keyId, read.refresh);
  const confirmReadback = action.confirmReadback;
  useLayoutEffect(() => {
    if (read.key !== undefined) confirmReadback();
  }, [confirmReadback, read.key]);
  const [openedPanels, setOpenedPanels] = useState(canRead);
  if (canRead && !openedPanels) setOpenedPanels(true);
  // A failed reread reports its error above the panels while the current visit keeps its last metadata.
  const [lastKey, setLastKey] = useState<typeof read.key>();
  if (read.key !== undefined && read.key !== lastKey) setLastKey(read.key);
  const metadata = read.key === undefined ? lastKey : read.key;
  const failure = !canRead || (offline !== undefined && refreshing) ? offline : read.failure;
  const retainedMetadataFailed = failure !== undefined && metadata !== undefined && metadata !== null;
  // A later connection check can replace the visible diagnosis for the same failed read.
  const initialMetadataFailed = metadata === undefined && read.failure !== undefined;
  const metadataAnnouncement = retainedMetadataFailed
    ? 'Key metadata could not be refreshed. Showing the last successful read.'
    : initialMetadataFailed
      ? 'Key metadata could not be loaded. Choose Retry to try again.'
      : '';
  const showPanels = openedPanels && metadata !== null;
  const writesEnabled = offline === undefined && metadata !== undefined && metadata !== null;
  useLayoutEffect(() => {
    if (failure !== undefined || read.key === undefined || !retryHadFocus.current) return;
    retryHadFocus.current = false;
    if (document.activeElement === document.body) refreshButton.current?.focus();
  }, [failure, read.key]);

  const handleRefresh = () => {
    if (refreshing) return;
    if (offline !== undefined) setRetriedConnection(connection.result);
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
        {refreshing ? '' : metadataAnnouncement}
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
        {showPanels && metadata === undefined && failure === undefined && (
          <Container>
            <SpaceBetween size="xxs">
              <StatusIndicator type="loading">Loading key…</StatusIndicator>
              <Box>Changes are available after the key metadata loads.</Box>
            </SpaceBetween>
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
                  ) : null,
              },
              {
                id: 'labels',
                label: 'Labels',
                contentRenderStrategy: 'eager',
                content: <Labels connection={connection} keyId={keyId} writesEnabled={writesEnabled} />,
              },
              {
                id: 'access',
                label: 'Access',
                contentRenderStrategy: 'lazy',
                content: <Access connection={connection} keyId={keyId} writesEnabled={writesEnabled} />,
              },
              {
                id: 'rotation',
                label: 'Rotation',
                contentRenderStrategy: 'lazy',
                content: (
                  <Rotation
                    connection={connection}
                    keyId={keyId}
                    keySpec={metadata?.KeySpec}
                    writesEnabled={writesEnabled}
                  />
                ),
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
  return <KeyVisit key={JSON.stringify([keyId, connection.engineOrigin])} connection={connection} keyId={keyId} />;
}
