import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { TextareaProps } from '@cloudscape-design/components/textarea';
import { useQuery } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState } from 'react';

import { DiscardDialog } from '../../../../components/discard-dialog';
import { DocumentField } from '../../../../components/document-field';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../../components/failure-states';
import { failureOf, noEndpoint } from '../../../../components/use-token-listing';
import { ACCESS_OPERATIONS, getDefaultPolicy, hasDefaultPolicy, putDefaultPolicy } from '../../access-api';
import { connectionFailure } from '../../queries';
import { AccessDialog } from './access-dialog';
import { ActionNotice } from './action-notice';
import type { AccessProps } from './access';
import { useAccessAction } from './use-access-action';

const { listPolicies, getPolicy, putPolicy } = ACCESS_OPERATIONS;

function useDefaultPolicy(connection: AreaConnection, keyId: string) {
  const [attemptedRetry, setAttemptedRetry] = useState(false);
  const endpoint = connection.engineOrigin;
  const offline = connectionFailure(connection, listPolicies);
  const enabled = endpoint !== undefined && (offline === undefined || attemptedRetry);
  const names = useQuery({
    queryKey: ['kms', 'policy-names', endpoint, keyId],
    queryFn: ({ signal }) => hasDefaultPolicy(endpoint ?? noEndpoint(), keyId, signal),
    enabled,
    retry: false,
    gcTime: 0,
  });
  const policy = useQuery({
    queryKey: ['kms', 'default-policy', endpoint, keyId],
    queryFn: ({ signal }) => getDefaultPolicy(endpoint ?? noEndpoint(), keyId, signal),
    enabled: enabled && names.data === true,
    retry: false,
    gcTime: 0,
  });

  const failure = names.isError
    ? failureOf(names.error, listPolicies)
    : policy.isError && names.data === true
      ? failureOf(policy.error, getPolicy)
      : attemptedRetry
        ? undefined
        : offline;

  function refresh() {
    setAttemptedRetry(true);
    if (enabled) {
      void names.refetch();
      if (names.data === true) void policy.refetch();
    }
  }

  return {
    document: names.data === true ? policy.data : undefined,
    fetching: names.isFetching || (names.data === true && policy.isFetching),
    loading: names.data === undefined || (names.data && policy.data === undefined),
    failure,
    refresh,
  };
}

export function KeyPolicy({ connection, keyId }: AccessProps) {
  const policy = useDefaultPolicy(connection, keyId);
  const action = useAccessAction(connection);
  const [draft, setDraft] = useState<{ original: string; text: string }>();
  const [syntaxError, setSyntaxError] = useState<{ message: string }>();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const textarea = useRef<TextareaProps.Ref>(null);
  const pending = action.pending === putPolicy;

  useLayoutEffect(() => {
    if (syntaxError !== undefined) textarea.current?.focus();
  }, [syntaxError]);

  function handleSave() {
    if (draft === undefined) return;
    try {
      JSON.parse(draft.text);
    } catch (error) {
      action.clearFailure();
      setSyntaxError({
        message: error instanceof SyntaxError ? `Invalid JSON. ${error.message}` : 'Enter valid JSON.',
      });
      return;
    }
    void action.run(
      putPolicy,
      (endpoint, signal) => putDefaultPolicy(endpoint, keyId, draft.text, signal),
      'Key policy saved.',
      () => {
        setDraft(undefined);
        policy.refresh();
      },
    );
  }

  function handleDismiss() {
    if (draft?.text !== draft?.original) {
      setConfirmDiscard(true);
    } else {
      setDraft(undefined);
    }
  }

  return (
    <Container
      header={
        <Header
          variant="h2"
          actions={
            <Button
              disabled={
                action.disabled(putPolicy) ||
                policy.failure !== undefined ||
                policy.fetching ||
                policy.document === undefined
              }
              onClick={() => {
                if (policy.document === undefined) return;
                action.clearFailure();
                setSyntaxError(undefined);
                setDraft({ original: policy.document, text: policy.document });
              }}
            >
              Edit key policy
            </Button>
          }
        >
          Key policy
        </Header>
      }
    >
      <SpaceBetween size="m">
        {action.unavailable.has(putPolicy) && draft === undefined && (
          <ActionNotice
            failure={{ kind: 'not-implemented', operation: putPolicy }}
            endpoint={connection.engineOrigin}
          />
        )}
        {policy.failure !== undefined ? (
          <ReadFailure
            state={readFailureState(
              policy.failure,
              connection,
              policy.failure.kind === 'other'
                ? `default key policy (${policy.failure.operation})`
                : 'default key policy',
            )}
            onRetry={policy.refresh}
          />
        ) : policy.loading ? (
          <StatusIndicator type="loading">Loading key policy…</StatusIndicator>
        ) : policy.document === undefined ? (
          <Box color="text-body-secondary">This key has no default policy.</Box>
        ) : (
          <Box variant="code" nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
            {policy.document}
          </Box>
        )}
      </SpaceBetween>
      {draft !== undefined && (
        <AccessDialog
          title="Edit key policy"
          submitLabel="Save policy"
          size="large"
          pending={pending}
          disabled={action.disabled(putPolicy)}
          onDismiss={handleDismiss}
          onSubmit={handleSave}
        >
          <DocumentField
            label="Policy document"
            value={draft.text}
            onChange={(text) => {
              setSyntaxError(undefined);
              setDraft({ ...draft, text });
            }}
            errorText={syntaxError?.message}
            disabled={pending}
            textareaRef={textarea}
            rows={16}
          />
          {action.failure !== undefined && (
            <ActionNotice failure={action.failure} endpoint={connection.engineOrigin} focusOnFailure />
          )}
        </AccessDialog>
      )}
      <DiscardDialog
        visible={confirmDiscard}
        onAnswer={(answer) => {
          setConfirmDiscard(false);
          if (answer === 'discard') setDraft(undefined);
        }}
      />
    </Container>
  );
}
