import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';

import { ConfirmDialog } from '../../../components/confirm-dialog';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { PolicyRead, PolicyVersion } from '../api';
import { POLICIES_PATH, policyArnOf, policyNameOfArn } from '../format';
import {
  failureOf,
  useDeletePolicyVersion,
  useManagedPolicyDocument,
  usePolicy,
  useSetDefaultPolicyVersion,
} from '../queries';
import { DeletePolicyDialog } from '../components/delete-policy-dialog';
import { EditPolicyDialog } from '../components/edit-policy-dialog';
import { actionFailureItem, readFailureState, type ReadFailureState } from '../components/failures';
import { useAnnouncer } from '../components/page-parts';
import {
  AttachedSection,
  AWS_MANAGED_REASON,
  DetailsSection,
  DocumentSection,
  VersionsSection,
} from '../components/policy-sections';
import { ReadFailure } from '../components/states';

// A policy's own page (issue 535, S5): "Policy details", "Policy document", "Versions" and "Attached to", read with
// `GetPolicy`, `ListPolicyVersions` and `ListEntitiesForPolicy` on opening, on "Refresh policy" and after each change;
// a version's document with `GetPolicyVersion`. Every value from the emulator is rendered as text. A customer managed
// policy's document is changed by "Edit" (a new default version), its versions by "Set as default" and "Delete", and
// the policy by "Delete"; an AWS managed policy is only read.

const REFRESHED = 'Policy refreshed';
/** What a failed read names (R10.1). */
const THING = 'policy';
const VERSION_WORD = 'delete';

type FoundRead = Extract<PolicyRead, { kind: 'found' }>;

/** What the page shows below its header. */
type PageState =
  | { kind: 'loading' }
  | { kind: 'found'; read: FoundRead }
  | { kind: 'not-found' }
  | ({ kind: 'failure' } & ReadFailureState);

function pageState(
  query: ReturnType<typeof usePolicy>,
  arn: string | undefined,
  connection: ScreenPageProps['connection'],
): PageState {
  if (arn === undefined) {
    return { kind: 'not-found' };
  }
  if (query.failure !== undefined) {
    return query.loading
      ? { kind: 'loading' }
      : { kind: 'failure', ...readFailureState(query.failure, connection, THING) };
  }
  if (query.read === undefined) {
    return { kind: 'loading' };
  }
  return query.read.kind === 'found' ? { kind: 'found', read: query.read } : { kind: 'not-found' };
}

/** "Policy not found", with the link to the list. */
function NotFound() {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Policy not found
          </Box>
          <Box variant="p" color="inherit">
            The emulator holds no policy with this ARN.
          </Box>
          <Link href={POLICIES_PATH} onFollow={handleFollow}>
            Policies
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/iam/policies/details?arn={arn}`: the policy of the address's ARN. Its `h1` is the name the emulator returns,
 * or the ARN's text after its last `/` while nothing is read. A failed read shows its state below the header; once
 * the connection is connected again the policy is read again by itself.
 */
export function PolicyPage({ connection }: ScreenPageProps) {
  useShowsResources('policies');
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const [searchParams] = useSearchParams();
  const arn = policyArnOf(searchParams);
  const engineOrigin = connection.engineOrigin;
  const editRef = useRef<ButtonProps.Ref>(null);
  const deleteRef = useRef<ButtonProps.Ref>(null);

  const query = usePolicy({ endpoint: engineOrigin, arn: arn ?? '', enabled: arn !== undefined });
  const { refresh } = query;
  const state = pageState(query, arn, connection);
  const found = state.kind === 'found' ? state.read : undefined;
  const policy = found?.policy;
  const awsManaged = policy?.type === 'AWS managed';
  const name = policy?.name ?? (arn === undefined ? 'Policy' : policyNameOfArn(arn));

  // The version "Show document" chose; the default's is shown while none is, or once the chosen one is gone.
  const [chosenVersion, setChosenVersion] = useState<string>();
  const versions = found?.versions.kind === 'read' ? found.versions.items : undefined;
  const shownId =
    chosenVersion !== undefined && (versions === undefined || versions.some((version) => version.id === chosenVersion))
      ? chosenVersion
      : policy?.defaultVersionId;
  const shownVersion =
    shownId === undefined ? undefined : { id: shownId, isDefault: shownId === policy?.defaultVersionId };
  const document = useManagedPolicyDocument({
    endpoint: engineOrigin,
    arn: arn ?? '',
    ...(shownId === undefined ? {} : { versionId: shownId }),
    enabled: shownId !== undefined,
  });

  const [selectedVersion, setSelectedVersion] = useState<string>();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletingVersion, setDeletingVersion] = useState<PolicyVersion>();
  const setDefault = useSetDefaultPolicyVersion(engineOrigin);
  const removeVersion = useDeletePolicyVersion(engineOrigin);

  // Kept from the previous render, as the role's page does: what was last seen of the read and the connection.
  const [refreshing, setRefreshing] = useState(false);
  const failureLine = state.kind === 'failure' ? state.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (refreshing && !query.loading) {
    setRefreshing(false);
    if (query.failure === undefined) {
      announce(REFRESHED);
    }
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && arn !== undefined && (query.failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
  }, [refresh]);

  const handleSetDefault = (version: PolicyVersion) => {
    if (arn === undefined || setDefault.isPending) {
      return;
    }
    setDefault.mutate(
      { arn, versionId: version.id },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `Version ${version.id} is now the default of ${name}.` }]);
        },
        onError: (error) => {
          flash.show([
            actionFailureItem(failureOf(error), `Setting version ${version.id} as the default`, engineOrigin),
          ]);
        },
      },
    );
  };

  const handleDeleteVersion = () => {
    const version = deletingVersion;
    if (arn === undefined || version === undefined) {
      return;
    }
    removeVersion.mutate(
      { arn, versionId: version.id },
      {
        onSuccess: () => {
          flash.show([{ type: 'success', content: `Version ${version.id} of ${name} deleted.` }]);
          setDeletingVersion(undefined);
        },
        onError: (error) => {
          flash.show([actionFailureItem(failureOf(error), `Deleting version ${version.id}`, engineOrigin)]);
          setDeletingVersion(undefined);
        },
      },
    );
  };

  let content: ReactNode;
  switch (state.kind) {
    case 'not-found':
      content = <NotFound />;
      break;
    case 'failure':
      content = (
        <Container>
          <ReadFailure state={state} onRetry={refresh} />
        </Container>
      );
      break;
    case 'loading':
      content = (
        <Container>
          <StatusIndicator type="loading">Loading policy</StatusIndicator>
        </Container>
      );
      break;
    case 'found':
      content = (
        <SpaceBetween size="l">
          <DetailsSection policy={state.read.policy} />
          <DocumentSection
            arn={state.read.policy.arn}
            version={shownVersion}
            query={document}
            connection={connection}
            editDisabledReason={awsManaged ? AWS_MANAGED_REASON : undefined}
            editRef={editRef}
            onEdit={() => {
              setEditing(true);
            }}
          />
          <VersionsSection
            versions={state.read.versions}
            awsManaged={awsManaged}
            selectedId={selectedVersion}
            onSelect={setSelectedVersion}
            onShow={(version) => {
              setChosenVersion(version.id);
            }}
            onSetDefault={handleSetDefault}
            onDelete={setDeletingVersion}
            settingDefault={setDefault.isPending}
            connection={connection}
            onRetry={refresh}
          />
          <AttachedSection entities={state.read.entities} connection={connection} onRetry={refresh} />
        </SpaceBetween>
      );
      break;
  }

  return (
    <>
      <SpaceBetween size="m">
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                iconName="refresh"
                ariaLabel="Refresh policy"
                disabled={arn === undefined}
                onClick={handleRefresh}
              />
              <Button
                ref={deleteRef}
                disabled={policy === undefined || awsManaged}
                {...(awsManaged ? { disabledReason: AWS_MANAGED_REASON } : {})}
                onClick={() => {
                  if (policy !== undefined && !awsManaged) setDeleting(true);
                }}
              >
                Delete
              </Button>
            </SpaceBetween>
          }
        >
          <ValueText kind="name" value={name} />
        </Header>
        {content}
      </SpaceBetween>
      {announcement}
      {editing && policy !== undefined && (
        <EditPolicyDialog
          policy={{ arn: policy.arn, name: policy.name }}
          connection={connection}
          onSaved={() => {
            setChosenVersion(undefined);
          }}
          onClose={() => {
            setEditing(false);
            editRef.current?.focus();
          }}
        />
      )}
      {deleting && policy !== undefined && found !== undefined && (
        <DeletePolicyDialog
          policy={{ arn: policy.arn, name: policy.name }}
          entities={found.entities.kind === 'read' ? found.entities.items : undefined}
          from="page"
          connection={connection}
          onClose={() => {
            setDeleting(false);
            deleteRef.current?.focus();
          }}
        />
      )}
      <ConfirmDialog
        visible={deletingVersion !== undefined}
        header={`Delete version ${deletingVersion?.id ?? ''}?`}
        body={`This version of ${name} and its document are removed from the local emulator. This cannot be undone.`}
        word={VERSION_WORD}
        action="Delete"
        pending={removeVersion.isPending}
        onConfirm={handleDeleteVersion}
        onDismiss={() => {
          setDeletingVersion(undefined);
        }}
      />
    </>
  );
}
