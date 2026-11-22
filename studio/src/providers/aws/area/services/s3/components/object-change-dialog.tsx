import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { reportedServiceCode, requestFailure, type RequestFailure } from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { usePageFlash } from '../../../components/page-flash';
import { ValueText } from '../../../components/value-text';
import { OPERATIONS, type MetadataEntry, type ObjectHead, type ObjectLocation } from '../api';
import { objectPath, s3Uri } from '../format';
import { useObjectChanges } from '../queries';
import { actionFailure } from './action-failure';
import { confirmsName } from './confirms-name';
import { ObjectChangeProperties } from './object-change-properties';

export type ObjectChange = 'copy' | 'rename' | 'edit';

interface ObjectChangeDialogProps {
  action: ObjectChange;
  endpoint: string | undefined;
  bucket: string;
  head: ObjectHead;
  onClose: () => void;
  onUnsupported: (operation: string) => void;
  onPropertiesSaved: () => void;
}

const LABELS = {
  copy: 'Copy object',
  rename: 'Rename object',
  edit: 'Edit object properties',
} as const;

function Location({ bucket, objectKey }: { bucket: string; objectKey: string }) {
  return <ValueText kind="address" value={s3Uri(bucket, objectKey)} />;
}

function Locations({ source, destination }: { source: ObjectLocation; destination: ObjectLocation }) {
  return (
    <KeyValuePairs
      items={[
        { label: 'Original object', value: <Location bucket={source.bucket} objectKey={source.key} /> },
        { label: 'Destination object', value: <Location bucket={destination.bucket} objectKey={destination.key} /> },
      ]}
    />
  );
}

function failureView(failure: RequestFailure, label: string, endpoint: string | undefined) {
  const view = actionFailure(failure, label, endpoint);
  const code = failure.kind === 'other' ? undefined : reportedServiceCode(failure);
  if (code === undefined) return view;
  return {
    ...view,
    detail: (
      <>
        <Box variant="code" display="inline">
          <ValueText kind="name" value={code} />
        </Box>{' '}
        {view.detail}
      </>
    ),
  };
}

function metadataKeyErrors(metadata: MetadataEntry[]): (string | undefined)[] {
  // S3 user metadata is carried in case-insensitive HTTP headers.
  const keys = metadata.map(({ key }) => key.toLowerCase());
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return keys.map((key) => {
    if (key === '') return 'Enter a metadata key.';
    return (counts.get(key) ?? 0) > 1 ? 'Use a different metadata key.' : undefined;
  });
}

function PartialRenameHeading() {
  const heading = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    // Wait for the dialog to release scroll and restore its trigger before focusing the result.
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({ block: 'center' });
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <span ref={heading} tabIndex={-1}>
      Object copied, but the original could not be deleted.
    </span>
  );
}

export function ObjectChangeDialog({
  action,
  endpoint,
  bucket,
  head,
  onClose,
  onUnsupported,
  onPropertiesSaved,
}: ObjectChangeDialogProps) {
  const flash = usePageFlash();
  const changes = useObjectChanges(endpoint);
  const active = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(() => () => active.current?.abort(), []);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RequestFailure>();
  const refusal = useRef<AlertProps.Ref>(null);
  useLayoutEffect(() => {
    if (failure !== undefined) refusal.current?.focus();
  }, [failure]);
  const [destinationBucket, setDestinationBucket] = useState(bucket);
  const [destinationKey, setDestinationKey] = useState('');
  const [confirmation, setConfirmation] = useState<'replace' | 'rename'>();
  const [typed, setTyped] = useState('');
  const [contentType, setContentType] = useState(head.contentType ?? '');
  const [metadata, setMetadata] = useState(head.user);
  const label = LABELS[action];
  const source = { bucket, key: head.key };
  const destination = action === 'edit' ? source : { bucket: destinationBucket, key: destinationKey };
  const sameLocation = destinationBucket === bucket && destinationKey === head.key;
  const expectedKey = confirmation === 'replace' ? destinationKey : head.key;
  const keyMatches = confirmsName(typed, expectedKey);
  const keyErrors = metadataKeyErrors(metadata);
  const valid =
    action === 'edit'
      ? keyErrors.every((error) => error === undefined)
      : destinationBucket.trim() !== '' &&
        destinationKey !== '' &&
        !sameLocation &&
        (confirmation === undefined || keyMatches);

  async function submit() {
    if (!valid || active.current !== undefined || changes === undefined) return;
    const controller = new AbortController();
    const { signal } = controller;
    active.current = controller;
    setPending(true);
    setFailure(undefined);
    let operation: string = OPERATIONS.headObject;

    try {
      if (action !== 'edit' && confirmation === undefined) {
        const exists = await changes.destinationExists(destination, signal);
        if (signal.aborted) return;
        if (exists || action === 'rename') {
          setConfirmation(exists ? 'replace' : 'rename');
          return;
        }
      }

      operation = OPERATIONS.copyObject;
      const edit =
        action === 'edit'
          ? {
              contentType,
              metadata: Object.fromEntries(metadata.map(({ key, value }) => [key, value])),
              headers: head.copyHeaders,
            }
          : undefined;
      await changes.copy(source, destination, signal, edit);
      if (signal.aborted) return;

      if (action === 'rename') {
        operation = OPERATIONS.deleteObject;
        await changes.removeSource(source, signal);
        if (signal.aborted) return;
      }

      onClose();
      if (action === 'edit') {
        onPropertiesSaved();
        flash.show([{ type: 'success', content: 'Object properties updated.' }]);
      } else {
        flash.handOver(objectPath(destination.bucket, destination.key), [
          {
            type: 'success',
            header: action === 'copy' ? 'Object copied.' : 'Object renamed.',
            content: <Location bucket={destination.bucket} objectKey={destination.key} />,
          },
        ]);
      }
    } catch (error) {
      if (signal.aborted) return;
      const refused = requestFailure(operation, error);
      const view = failureView(refused, label, endpoint);
      if (refused.kind === 'not-implemented') onUnsupported(refused.operation);

      if (operation === OPERATIONS.deleteObject) {
        onClose();
        flash.show([
          {
            type: 'warning',
            header: <PartialRenameHeading />,
            content: (
              <SpaceBetween size="s">
                <Locations source={source} destination={destination} />
                <Box variant="strong">{view.header}</Box>
                {view.detail}
              </SpaceBetween>
            ),
          },
        ]);
      } else if (refused.kind === 'not-implemented') {
        onClose();
        flash.show([
          {
            type: view.type,
            header: view.header,
            content: (
              <>
                {label}. {view.detail}
              </>
            ),
          },
        ]);
      } else {
        setFailure(refused);
      }
    } finally {
      if (!signal.aborted) {
        active.current = undefined;
        setPending(false);
      }
    }
  }

  const handleClose = () => {
    if (active.current === undefined) onClose();
  };

  const view = failure === undefined ? undefined : failureView(failure, label, endpoint);
  return (
    <AreaModal
      visible
      header={
        confirmation === 'replace' ? 'Replace existing object?' : confirmation === 'rename' ? 'Rename object?' : label
      }
      closeAriaLabel="Close"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={!valid || changes === undefined}
              onClick={() => void submit()}
            >
              {confirmation === 'replace' ? 'Replace object' : action === 'edit' ? 'Save changes' : label}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {view !== undefined && (
          <Alert ref={refusal} type={view.type} header={view.header}>
            {view.detail}
          </Alert>
        )}
        {confirmation !== undefined ? (
          <SpaceBetween size="m">
            <Locations source={source} destination={destination} />
            <FormField
              label={confirmation === 'replace' ? 'Enter destination key to confirm' : 'Enter original key to confirm'}
              description={
                <SpaceBetween size="xs">
                  <Alert type="warning">
                    {confirmation === 'replace' && <div>The existing destination object will be replaced.</div>}
                    {action === 'rename' && <div>The original key will be deleted after the copy succeeds.</div>}
                    {action === 'rename' && head.copyHeaders?.WebsiteRedirectLocation !== undefined && (
                      <div>The renamed object will lose its website redirect.</div>
                    )}
                  </Alert>
                  <div>
                    Expected key{' '}
                    <Box variant="code" display="inline" nativeAttributes={{ style: { whiteSpace: 'break-spaces' } }}>
                      <ValueText kind="name" value={expectedKey} />
                    </Box>
                  </div>
                </SpaceBetween>
              }
              errorText={typed !== '' && !keyMatches ? 'Enter the exact key shown above.' : undefined}
            >
              <Input
                key="confirmation"
                autoFocus
                value={typed}
                onChange={({ detail }) => setTyped(detail.value)}
                disabled={pending}
                spellcheck={false}
              />
            </FormField>
          </SpaceBetween>
        ) : action === 'edit' ? (
          <ObjectChangeProperties
            contentType={contentType}
            metadata={metadata}
            keyErrors={keyErrors}
            pending={pending}
            onContentType={setContentType}
            onMetadata={setMetadata}
          />
        ) : (
          <SpaceBetween size="m">
            <KeyValuePairs
              items={[{ label: 'Original object', value: <Location bucket={source.bucket} objectKey={source.key} /> }]}
            />
            {action === 'copy' && (
              <FormField label="Destination bucket">
                <Input
                  value={destinationBucket}
                  onChange={({ detail }) => setDestinationBucket(detail.value)}
                  disabled={pending}
                  spellcheck={false}
                />
              </FormField>
            )}
            <FormField
              label={action === 'copy' ? 'Destination key' : 'New key'}
              errorText={sameLocation ? 'Choose a different location.' : undefined}
            >
              <Input
                value={destinationKey}
                onChange={({ detail }) => setDestinationKey(detail.value)}
                disabled={pending}
                spellcheck={false}
              />
            </FormField>
          </SpaceBetween>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
