import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Input from '@cloudscape-design/components/input';
import Multiselect, { type MultiselectProps } from '@cloudscape-design/components/multiselect';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useLayoutEffect, useRef, useState } from 'react';

import { bindAwsMutationAuthorization, type RequestFailure } from '../../../../../../../lib/aws/request';
import { AreaModal } from '../../../../components/area-modal';
import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash } from '../../../../components/page-flash';
import { failureOf } from '../../../../components/use-token-listing';
import { useRefreshParameterLabels, useUnsupportedOperation } from '../../queries';
import {
  addVersionLabels,
  LABEL_PARAMETER_VERSION,
  removeVersionLabels,
  UNLABEL_PARAMETER_VERSION,
  type HistoryVersion,
} from '../../version-api';

export function LabelDialog({
  connection,
  name,
  version,
  mode,
  onClose,
}: {
  connection: AreaConnection;
  name: string;
  version: HistoryVersion;
  mode: 'add' | 'remove';
  onClose: () => void;
}) {
  const adding = mode === 'add';
  const title = adding ? 'Add labels' : 'Remove labels';
  const operation = adding ? LABEL_PARAMETER_VERSION : UNLABEL_PARAMETER_VERSION;
  const unsupported = useUnsupportedOperation(connection, operation);
  const flash = usePageFlash();
  const refresh = useRefreshParameterLabels(connection);
  const [input, setInput] = useState('');
  const [selected, setSelected] = useState<readonly MultiselectProps.Option[]>([]);
  const [failure, setFailure] = useState<RequestFailure>();
  const [pending, setPending] = useState(false);
  const request = useRef<AbortController | undefined>(undefined);
  useLayoutEffect(
    () => () => {
      request.current?.abort();
      request.current = undefined;
    },
    [],
  );

  const labels = adding
    ? [
        ...new Set(
          input
            .split(',')
            .map((label) => label.trim())
            .filter(Boolean),
        ),
      ]
    : selected.flatMap(({ value }) => (value === undefined ? [] : [value]));
  const endpoint = connection.engineOrigin;
  const disabled = endpoint === undefined || pending || labels.length === 0 || unsupported.failure !== undefined;
  const handleSubmit = async () => {
    if (disabled || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const release = bindAwsMutationAuthorization(controller, { cancelInFlight: true });
    setPending(true);
    setFailure(undefined);
    try {
      const writeLabels = adding ? addVersionLabels : removeVersionLabels;
      const result = await writeLabels(endpoint, name, version.Version, labels, controller.signal);
      if (controller.signal.aborted) return;

      const changed = result.applied.length > 0;
      const rejected = result.rejected.length > 0;
      flash.show([
        {
          type: rejected ? (changed ? 'warning' : 'error') : changed ? 'success' : 'info',
          content: (
            <>
              {changed && (
                <div>
                  {adding ? 'Added' : 'Removed'} labels for {name}, version {result.version}:{' '}
                  {result.applied.join(', ')}.
                </div>
              )}
              {rejected && <div>Rejected labels: {result.rejected.join(', ')}.</div>}
              {!changed && !rejected && (
                <div>
                  No labels changed for {name}, version {result.version}.
                </div>
              )}
            </>
          ),
        },
      ]);
      refresh(name);
      onClose();
    } catch (error) {
      if (controller.signal.aborted) return;
      const nextFailure = failureOf(error, operation);
      if (nextFailure.kind === 'not-implemented') {
        unsupported.markUnsupported(nextFailure);
        onClose();
      } else {
        setFailure(nextFailure);
      }
    } finally {
      release();
      if (request.current === controller) {
        request.current = undefined;
        setPending(false);
      }
    }
  };
  const handleDismiss = () => {
    if (!request.current) onClose();
  };
  const feedback = failure && actionFailureItem(failure, title, endpoint);

  return (
    <AreaModal
      visible
      header={title}
      closeAriaLabel="Close dialog"
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" onClick={handleDismiss} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" loading={pending} disabled={disabled} onClick={() => void handleSubmit()}>
              {title}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <Box>Version {version.Version}</Box>
        {adding ? (
          <FormField label="Labels" constraintText="Separate multiple labels with commas.">
            <Input value={input} onChange={({ detail }) => setInput(detail.value)} disabled={pending} />
          </FormField>
        ) : (
          <FormField label="Labels">
            <Multiselect
              placeholder="Choose labels"
              options={version.Labels?.map((label) => ({ label, value: label })) ?? []}
              selectedOptions={selected}
              onChange={({ detail }) => setSelected(detail.selectedOptions)}
              disabled={pending}
              inlineTokens
            />
          </FormField>
        )}
        {feedback && (
          <Alert type="error" header={feedback.header}>
            {feedback.content}
          </Alert>
        )}
      </SpaceBetween>
    </AreaModal>
  );
}
