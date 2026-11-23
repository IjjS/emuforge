import Alert from '@cloudscape-design/components/alert';
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

import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  RequestError,
  type RequestFailure,
} from '../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { putBucketVersioning, type BucketVersioningChange } from '../api';
import { actionFailure, type ActionFailure } from '../components/action-failure';
import { pageFailure, type StateLine } from '../components/bucket-read';
import { BucketReadFailure, StateLineText } from '../components/bucket-read-state';
import { bucketPropertiesPath } from '../format';
import { useVersioningEditorStatus } from '../queries';

export const VERSIONING_TITLE = 'Edit bucket versioning';

function refusalLine(code: string | undefined, message: string | undefined, context = ''): StateLine {
  if (code === undefined) return { before: [context, message].filter(Boolean).join(' ') };
  return {
    before: context === '' ? '' : `${context} `,
    code,
    ...(message && { after: `: ${message}` }),
  };
}

function versioningReadFailure(failure: RequestFailure, connection: AreaConnection) {
  const view = pageFailure(failure, connection, 'Bucket versioning could not be read');
  const code = failure.kind === 'other' ? failure.code : reportedServiceCode(failure);
  const message =
    failure.kind === 'not-implemented'
      ? reportedNotImplementedMessage(failure)
      : 'message' in failure
        ? failure.message
        : undefined;
  const context =
    failure.kind === 'not-implemented'
      ? `The emulator answered 501 Not Implemented for ${failure.operation}.`
      : failure.kind === 'access-denied'
        ? `${failure.operation} was refused.`
        : '';
  if (code === undefined && message === undefined && context === '') return view;
  return {
    ...view,
    ...(code === 'NoSuchBucket' && { first: { before: 'Bucket not found' } }),
    detail: refusalLine(code, message, context),
  };
}

function versioningWriteFailure(failure: RequestFailure, endpoint: string): ActionFailure {
  const view = actionFailure(failure, 'Updating bucket versioning', endpoint);
  const code = failure.kind === 'other' ? undefined : reportedServiceCode(failure);
  const message = reportedNotImplementedMessage(failure);
  if (code === undefined && message === undefined) return view;
  return {
    ...view,
    detail: (
      <>
        {view.detail} <StateLineText line={refusalLine(code, message)} />
      </>
    ),
  };
}

export function VersioningPage({ connection, params }: ScreenPageProps) {
  useShowsResources('buckets');
  const bucket = params.name ?? '';
  const read = useVersioningEditorStatus(connection.engineOrigin, bucket);

  return (
    <SpaceBetween size="l">
      <Header
        variant="h1"
        description={
          <>
            Bucket <ValueText kind="name" value={bucket} />
          </>
        }
      >
        {VERSIONING_TITLE}
      </Header>
      {read.value === undefined && read.failure === undefined && (
        <Container>
          <StatusIndicator type="loading">Loading bucket versioning</StatusIndicator>
        </Container>
      )}
      {read.failure !== undefined && (
        <BucketReadFailure view={versioningReadFailure(read.failure, connection)} onRetry={read.again} />
      )}
      {read.value !== undefined && read.failure === undefined && connection.engineOrigin !== undefined && (
        <VersioningForm
          key={bucket}
          bucket={bucket}
          endpoint={connection.engineOrigin}
          status={read.value.status}
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
      setFailure(versioningWriteFailure(error.failure, endpoint));
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
            <Button formAction="none" variant="link" disabled={pending} onClick={() => void navigate(properties)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              formAction="submit"
              loading={pending}
              loadingText="Saving bucket versioning"
              disabled={!canSave}
            >
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
