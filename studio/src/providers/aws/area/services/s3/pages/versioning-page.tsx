import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import RadioGroup from '@cloudscape-design/components/radio-group';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';

import { reportedServiceCode, RequestError } from '../../../../../../lib/aws/request';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { putBucketVersioning, type BucketVersioningChange } from '../api';
import { actionFailure, type ActionFailure } from '../components/action-failure';
import { pageState } from '../components/bucket-read';
import { BucketNotFound, BucketReadFailure } from '../components/bucket-read-state';
import { bucketPropertiesPath } from '../format';
import { useBucketProperty } from '../queries';

export const VERSIONING_TITLE = 'Edit bucket versioning';

export function VersioningPage({ connection, params }: ScreenPageProps) {
  useShowsResources('buckets');
  const bucket = params.name ?? '';
  const read = useBucketProperty(connection.engineOrigin, bucket, 'versioning', { generation: 0, enabled: true });
  const state = pageState(read, connection);

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{VERSIONING_TITLE}</Header>
      {state.kind === 'loading' && (
        <Container>
          <StatusIndicator type="loading">Loading bucket versioning</StatusIndicator>
        </Container>
      )}
      {state.kind === 'failure' && <BucketReadFailure view={state.view} onRetry={read.again} />}
      {state.kind === 'not-found' && <BucketNotFound name={bucket} />}
      {state.kind === 'loaded' && connection.engineOrigin !== undefined && (
        <VersioningForm
          key={bucket}
          bucket={bucket}
          endpoint={connection.engineOrigin}
          status={state.value.status}
          disconnected={connection.result !== undefined && connection.result.kind !== 'connected'}
        />
      )}
    </SpaceBetween>
  );
}

function VersioningForm({
  bucket,
  endpoint,
  status,
  disconnected,
}: {
  bucket: string;
  endpoint: string;
  status: string;
  disconnected: boolean;
}) {
  const navigate = useNavigate();
  const flash = usePageFlash();
  const properties = bucketPropertiesPath(bucket);
  const [choice, setChoice] = useState<BucketVersioningChange>();
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<ActionFailure>();
  const inFlight = useRef<AbortController | null>(null);
  useEffect(() => () => inFlight.current?.abort(), []);

  const selected = choice ?? status;
  const canSave = !disconnected && selected !== status && failure?.type !== 'info';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current !== null || !canSave || choice === undefined) return;

    const controller = new AbortController();
    inFlight.current = controller;
    setPending(true);
    setFailure(undefined);
    try {
      await putBucketVersioning(endpoint, bucket, choice, controller.signal);
      if (!controller.signal.aborted) {
        flash.handOver(properties, [{ type: 'success', content: 'Bucket versioning updated.' }]);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      if (!(error instanceof RequestError)) throw error;
      const shown = actionFailure(error.failure, 'Updating bucket versioning', endpoint);
      const code = error.failure.kind === 'access-denied' ? reportedServiceCode(error.failure) : undefined;
      setFailure(
        code === undefined
          ? shown
          : {
              ...shown,
              detail: (
                <>
                  <Box variant="code" display="inline">
                    <ValueText kind="name" value={code} />
                  </Box>
                  {' — '}
                  {shown.detail}
                </>
              ),
            },
      );
    } finally {
      if (!controller.signal.aborted) {
        inFlight.current = null;
        setPending(false);
      }
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)}>
      <Form
        errorText={
          failure?.type === 'error' && (
            <>
              {failure.header}. {failure.detail}
            </>
          )
        }
        actions={
          <SpaceBetween size="xs" direction="horizontal">
            <Button disabled={pending} onClick={() => void navigate(properties)}>
              Cancel
            </Button>
            <Button variant="primary" formAction="submit" loading={pending} disabled={!canSave}>
              Save changes
            </Button>
          </SpaceBetween>
        }
      >
        <Container header={<Header variant="h2">Bucket versioning</Header>}>
          <SpaceBetween size="m">
            {failure?.type === 'info' && (
              <Alert type="info" header={failure.header}>
                {failure.detail}
              </Alert>
            )}
            <FormField
              label="Versioning setting"
              description={
                <>
                  Current status: <ValueText kind="text" value={status} />
                </>
              }
            >
              <RadioGroup
                value={selected}
                onChange={({ detail }) => setChoice(detail.value === 'Enabled' ? 'Enabled' : 'Suspended')}
                items={[
                  { value: 'Enabled', label: 'Enable', disabled: pending },
                  {
                    value: 'Suspended',
                    label: 'Suspend',
                    disabled: pending || status === 'Disabled',
                  },
                ]}
              />
            </FormField>
          </SpaceBetween>
        </Container>
      </Form>
    </form>
  );
}
