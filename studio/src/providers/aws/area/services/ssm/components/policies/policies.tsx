import type { GetResourcePoliciesResponseEntry } from '@aws-sdk/client-ssm';
import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { AreaModal } from '../../../../components/area-modal';
import { CopyValue } from '../../../../components/copy-value';
import { DocumentField } from '../../../../components/document-field';
import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../../components/failure-states';
import { ValueText } from '../../../../components/value-text';
import { useParameterPolicyWrite, useParameterResourcePolicies, useUnsupportedOperation } from '../../queries';
import {
  DELETE_RESOURCE_POLICY,
  deleteResourcePolicy,
  GET_RESOURCE_POLICIES,
  PUT_RESOURCE_POLICY,
  putResourcePolicy,
} from '../../resource-api';

interface PoliciesProps {
  connection: AreaConnection;
  name: string;
  arn: string;
}

type PolicyAction =
  { mode: 'create' } | { mode: 'edit'; policy: GetResourcePoliciesResponseEntry } | { mode: 'delete'; id: string };

function formatPolicyDocument(document: string | undefined) {
  if (document === undefined) return undefined;
  try {
    return JSON.stringify(JSON.parse(document), null, 2);
  } catch {
    return document;
  }
}

export function ParameterResourcePolicies(props: PoliciesProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ExpandableSection
      variant="container"
      headerText="Resource policies"
      expanded={expanded}
      onChange={({ detail }) => setExpanded(detail.expanded)}
    >
      {expanded && <PoliciesList {...props} />}
    </ExpandableSection>
  );
}

function PoliciesList({ connection, name, arn }: PoliciesProps) {
  const { items, loading, failure, retry } = useParameterResourcePolicies(connection, arn);
  const put = useUnsupportedOperation(connection, PUT_RESOURCE_POLICY);
  const remove = useUnsupportedOperation(connection, DELETE_RESOURCE_POLICY);
  const [action, setAction] = useState<PolicyAction>();
  const failures = [failure?.kind === 'not-implemented' ? failure : undefined, put.failure, remove.failure];

  return (
    <SpaceBetween size="m">
      <SpaceBetween size="xs" direction="horizontal">
        <Button onClick={retry} disabled={loading || failure?.kind === 'not-implemented'}>
          Refresh resource policies
        </Button>
        <Button onClick={() => setAction({ mode: 'create' })} disabled={put.failure !== undefined}>
          Create resource policy
        </Button>
      </SpaceBetween>
      {failures.map((unsupported) =>
        unsupported ? (
          <Alert
            key={unsupported.operation}
            header="Not implemented by the emulator"
            action={unsupported.operation === GET_RESOURCE_POLICIES ? <Button disabled>Retry</Button> : undefined}
          >
            The emulator answered 501 Not Implemented for {unsupported.operation}.
          </Alert>
        ) : null,
      )}
      {failure && failure.kind !== 'not-implemented' && (
        <ReadFailure state={readFailureState(failure, connection, 'resource policy list')} onRetry={retry} />
      )}
      {loading && items === undefined && <StatusIndicator type="loading">Loading resource policies…</StatusIndicator>}
      {!failure && items?.length === 0 && <Box textAlign="center">No resource policies</Box>}
      {items?.map(({ PolicyId, PolicyHash, Policy }, index) => (
        <Container
          key={PolicyId ?? index}
          header={
            <Header
              variant="h3"
              actions={
                <SpaceBetween size="xs" direction="horizontal">
                  <Button
                    ariaLabel={`Edit resource policy ${PolicyId ?? ''}`}
                    disabled={!PolicyId || !PolicyHash || put.failure !== undefined}
                    onClick={() => {
                      setAction({ mode: 'edit', policy: { PolicyId, PolicyHash, Policy } });
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    ariaLabel={`Delete resource policy ${PolicyId ?? ''}`}
                    disabled={!PolicyId || !PolicyHash || remove.failure !== undefined}
                    onClick={() => {
                      if (PolicyId) setAction({ mode: 'delete', id: PolicyId });
                    }}
                  >
                    Delete
                  </Button>
                </SpaceBetween>
              }
            >
              <CopyValue label="Policy ID" value={PolicyId} none="Policy ID unavailable" />
            </Header>
          }
        >
          <Box variant="pre" nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
            <ValueText kind="name" value={formatPolicyDocument(Policy)} none="Policy document unavailable" />
          </Box>
        </Container>
      ))}
      {action && (
        <PolicyDialog
          connection={connection}
          name={name}
          arn={arn}
          action={action}
          policy={
            action.mode === 'delete'
              ? items?.find(({ PolicyId }) => PolicyId === action.id)
              : action.mode === 'edit'
                ? action.policy
                : undefined
          }
          onClose={() => setAction(undefined)}
        />
      )}
    </SpaceBetween>
  );
}

function PolicyDialog({
  connection,
  name,
  arn,
  action,
  policy,
  onClose,
}: PoliciesProps & {
  action: PolicyAction;
  policy: GetResourcePoliciesResponseEntry | undefined;
  onClose: () => void;
}) {
  const deleting = action.mode === 'delete';
  const title = deleting
    ? 'Delete resource policy'
    : action.mode === 'edit'
      ? 'Edit resource policy'
      : 'Create resource policy';
  const submit = deleting ? title : 'Save resource policy';
  const [document, setDocument] = useState(policy?.Policy ?? '');
  const [confirmation, setConfirmation] = useState('');
  const write = useParameterPolicyWrite(connection, name, arn, deleting ? DELETE_RESOURCE_POLICY : PUT_RESOURCE_POLICY);
  const feedback = write.failure && actionFailureItem(write.failure, title, connection.engineOrigin);
  const { PolicyId, PolicyHash } = policy ?? {};
  const revision = PolicyId && PolicyHash ? { PolicyId, PolicyHash } : undefined;
  const handleDismiss = () => {
    if (!write.pending) onClose();
  };
  const handleSubmit = () => {
    if (deleting) {
      if (confirmation !== 'delete' || !revision) return;
      void write.run(
        (endpoint, signal) => deleteResourcePolicy(endpoint, arn, revision, signal),
        `Resource policy ${revision.PolicyId} deleted from ${name}.`,
        onClose,
      );
      return;
    }
    if (document.trim() === '') return;
    if (action.mode === 'edit') {
      if (revision) void write.edit(document, revision, onClose);
      return;
    }
    void write.run(
      (endpoint, signal) => putResourcePolicy(endpoint, arn, document, undefined, signal),
      `Resource policy created for ${name}.`,
      onClose,
    );
  };

  return (
    <AreaModal
      visible
      size={deleting ? 'medium' : 'large'}
      closeAriaLabel="Close dialog"
      header={title}
      onDismiss={handleDismiss}
      footer={
        <Box float="right">
          <SpaceBetween size="xs" direction="horizontal">
            <Button variant="link" onClick={handleDismiss} disabled={write.pending}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={handleSubmit}
              loading={write.pending}
              disabled={
                write.disabled ||
                (action.mode !== 'create' && revision === undefined) ||
                (deleting ? confirmation !== 'delete' : document.trim() === '')
              }
            >
              {submit}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {deleting ? (
          <>
            <CopyValue label="Policy ID" value={action.id} />
            <Box>
              This removes the resource policy from <ValueText kind="name" value={name} /> in your local emulator. Type
              delete to confirm.
            </Box>
            <FormField label="Confirmation">
              <Input
                value={confirmation}
                onChange={({ detail }) => setConfirmation(detail.value)}
                disabled={write.pending}
              />
            </FormField>
          </>
        ) : (
          <DocumentField
            label="Policy document"
            value={document}
            onChange={setDocument}
            rows={12}
            disabled={write.pending}
          />
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
