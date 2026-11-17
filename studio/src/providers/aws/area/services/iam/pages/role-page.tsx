import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Role, RoleRead } from '../api';
import { ROLES_PATH, roleTabPath, type RoleTab } from '../format';
import { useRole } from '../queries';
import { EditSummaryDialog } from '../components/edit-summary-dialog';
import { readFailureState, type ReadFailureState } from '../components/failures';
import { useAnnouncer } from '../components/page-parts';
import { Quoted } from '../components/quoted';
import { BoundarySection, PoliciesSection, SummarySection } from '../components/role-sections';
import { ReadFailure } from '../components/states';

// A role's own page (issue 82, requirement R5, R6.1, R8, R10): the tab "Permissions" with "Summary", "Permissions
// policies" and "Permissions boundary", in the console's words; its states and Studio's own "Refresh role" in
// EmuForge's. Every value from the engine or the emulator is rendered as text, each as the kind of value it is (issue
// 467, requirement R6). The `h1` has no description: the area's frame says where the role is (issue 467, R3).

/** The path parameter that holds the role's name, decoded once by the area (R0). */
export const ROLE_NAME_PARAM = 'name';

const REFRESHED = 'Role refreshed';
/** What a failed read names (R10.1). */
const THING = 'role';
const PERMISSIONS = 'permissions';

/** The four other tabs, in order, and the routes they lead to (R5.2, R8). */
const OTHER_TABS: readonly { id: RoleTab; label: string }[] = [
  { id: 'trust-relationships', label: 'Trust relationships' },
  { id: 'tags', label: 'Tags' },
  { id: 'last-accessed', label: 'Last Accessed' },
  { id: 'revoke-sessions', label: 'Revoke sessions' },
];

/** What the page shows below its header (R5, R10). */
type PageState =
  | { kind: 'loading' }
  | { kind: 'found'; read: Extract<RoleRead, { kind: 'found' }> }
  | { kind: 'not-found' }
  | ({ kind: 'failure' } & ReadFailureState);

/**
 * The page's state: a failed read once no read is in flight; the last answer while it is the newest one, kept while
 * "Refresh role" reads again; otherwise loading.
 */
function pageState(query: ReturnType<typeof useRole>, connection: ScreenPageProps['connection']): PageState {
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

/** "Role not found" (R5.4): the sentence with the address's name, and the link to the list. */
function NotFound({ name }: { name: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="strong" color="inherit">
            Role not found
          </Box>
          <Box variant="p" color="inherit">
            <Quoted
              before="The emulator holds no role named “"
              name={name}
              after="”. It may have been deleted, or the emulator restarted."
            />
          </Box>
          <Link href={ROLES_PATH} onFollow={handleFollow}>
            Roles
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/iam/roles/details/{name}`: the role `name`, read through the engine with `GetRole`,
 * `ListAttachedRolePolicies` and `ListRolePolicies` on every opening and on "Refresh role" (R5.1). Its `h1` is the
 * name as the emulator returns it, or the address's name while nothing is read. A failed read shows its state below
 * the header; once the connection is connected again the role is read again by itself (R10.2).
 */
export function RolePage({ connection, params }: ScreenPageProps) {
  useShowsResources('roles');
  const navigate = useNavigate();
  const [announcement, announce] = useAnnouncer();
  const editRef = useRef<ButtonProps.Ref>(null);
  const name = params[ROLE_NAME_PARAM] ?? '';

  const query = useRole({ endpoint: connection.engineOrigin, name });
  const { refresh } = query;
  const state = pageState(query, connection);
  const role: Role | undefined = state.kind === 'found' ? state.read.role : undefined;

  // The role "Edit summary" is open for; `undefined` while it is closed.
  const [editing, setEditing] = useState<Role>();

  // Kept from the previous render, as React's own pattern for it (as the role list does): what was last seen of the
  // read and the connection, so each change is acted on once, in the render that first shows it.
  const [refreshing, setRefreshing] = useState(false);
  const failureLine = state.kind === 'failure' ? state.firstText : undefined;
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  // Whether the connection was not connected (a state other than "Checking") since the page last read: the emulator
  // may have restarted then, so the role shown may be gone.
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  // "Role refreshed", once the refreshed read is shown (R8).
  if (refreshing && !query.loading) {
    setRefreshing(false);
    if (query.failure === undefined) {
      announce(REFRESHED);
    }
  }
  // A failure state is announced once, with its first line (R10.2).
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  // Once the connection becomes connected again, a failed read, or a role shown while the connection was not
  // connected, is read again by itself (R10.2).
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (query.failure !== undefined || wasDown)) {
      setWasDown(false);
      refresh();
    }
  }

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    refresh();
  }, [refresh]);

  const handleCloseEdit = useCallback(() => {
    setEditing(undefined);
    editRef.current?.focus();
  }, []);

  const handleTab = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined && detail.activeTabId !== PERMISSIONS) {
        void navigate(detail.activeTabHref);
      }
    },
    [navigate],
  );

  let content: ReactNode;
  switch (state.kind) {
    case 'not-found':
      content = <NotFound name={name} />;
      break;
    case 'failure':
      content = (
        <Container>
          <ReadFailure state={state} onRetry={refresh} />
        </Container>
      );
      break;
    case 'loading':
    case 'found': {
      // The tabs lead to the routes of the name as the emulator holds it, once it is read (R8).
      const tabName = role?.name ?? name;
      const permissions =
        state.kind === 'found' ? (
          <SpaceBetween size="l">
            <SummarySection
              role={state.read.role}
              editRef={editRef}
              onEdit={() => {
                setEditing(state.read.role);
              }}
            />
            <PoliciesSection policies={state.read.policies} connection={connection} onRetry={refresh} />
            <BoundarySection role={state.read.role} />
          </SpaceBetween>
        ) : (
          <Container>
            <StatusIndicator type="loading">Loading role</StatusIndicator>
          </Container>
        );
      content = (
        <Tabs
          activeTabId={PERMISSIONS}
          keyboardActivationMode="manual"
          ariaLabel="Role"
          onChange={handleTab}
          tabs={[
            { id: PERMISSIONS, label: 'Permissions', content: permissions },
            ...OTHER_TABS.map(({ id, label }) => ({
              id,
              label,
              href: roleTabPath(tabName, id),
              disabled: role === undefined,
            })),
          ]}
        />
      );
      break;
    }
  }

  return (
    <>
      <SpaceBetween size="m">
        <Header variant="h1" actions={<Button iconName="refresh" ariaLabel="Refresh role" onClick={handleRefresh} />}>
          <ValueText kind="name" value={role?.name ?? name} />
        </Header>
        {content}
      </SpaceBetween>
      {announcement}
      {editing !== undefined && (
        <EditSummaryDialog role={editing} engineOrigin={connection.engineOrigin} onClose={handleCloseEdit} />
      )}
    </>
  );
}
