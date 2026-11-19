import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Tabs, { type TabsProps } from '@cloudscape-design/components/tabs';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { Role, RoleRead } from '../api';
import { ROLE_PAGE_TABS, ROLE_TAB_PARAMETER, ROLES_PATH, roleTabHref, roleTabOf } from '../format';
import { useRole } from '../queries';
import { DeleteRolesDialog, type DeleteRolesOutcome } from '../components/delete-roles-dialog';
import { EditSummaryDialog } from '../components/edit-summary-dialog';
import { readFailureState, type ReadFailureState } from '../components/failures';
import { useAnnouncer } from '../components/page-parts';
import { Quoted } from '../components/quoted';
import { PermissionsTab } from '../components/permissions-tab';
import { SummarySection } from '../components/role-sections';
import { ReadFailure } from '../components/states';
import { TrustTab } from '../components/trust-tab';

// A role's own page (issue 82, requirement R5, R6.1, R8, R10; issue 535, tasks 1 and 5): "Summary", then the tabs
// "Permissions" and "Trust relationships", the active one read from `?tab=`, in the console's words; "Delete" in the
// header; its states and Studio's own "Refresh role" in EmuForge's. Every value from the engine or the emulator is rendered as text, each as the kind of value it is (issue
// 467, requirement R6). The `h1` has no description: the area's frame says where the role is (issue 467, R3).

/** The path parameter that holds the role's name, decoded once by the area (R0). */
export const ROLE_NAME_PARAM = 'name';

const REFRESHED = 'Role refreshed';
/** What a failed read names (R10.1). */
const THING = 'role';

type FoundRead = Extract<RoleRead, { kind: 'found' }>;

/** What the page shows below its header (R5, R10). */
type PageState =
  | { kind: 'loading' }
  | { kind: 'found'; read: FoundRead }
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

/** Whether a page state is one a dialog keeps the last answer through: a failed read, or a read in flight. */
function heldThrough(state: PageState): boolean {
  return state.kind === 'failure' || state.kind === 'loading';
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
  const [searchParams] = useSearchParams();
  const activeTab = roleTabOf(searchParams.get(ROLE_TAB_PARAMETER));
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const editRef = useRef<ButtonProps.Ref>(null);
  const deleteRef = useRef<ButtonProps.Ref>(null);
  const name = params[ROLE_NAME_PARAM] ?? '';

  const query = useRole({ endpoint: connection.engineOrigin, name });
  const { refresh } = query;
  // Whether a dialog of a tab is open, per tab: the page then keeps the role it last showed through a read that
  // fails or is in flight behind the dialog, so the dialog, what was typed in it and its own result stay (issue 535,
  // fix-s6). A read that finds the role gone still shows "Role not found". Once no dialog is open the newest read
  // decides again.
  const [permissionsDialog, setPermissionsDialog] = useState(false);
  const [trustDialog, setTrustDialog] = useState(false);
  const [lastFound, setLastFound] = useState<FoundRead>();
  const queried = pageState(query, connection);
  if (queried.kind === 'found' && queried.read !== lastFound) {
    setLastFound(queried.read);
  }
  const state: PageState =
    (permissionsDialog || trustDialog) && heldThrough(queried) && lastFound !== undefined
      ? { kind: 'found', read: lastFound }
      : queried;
  const role: Role | undefined = state.kind === 'found' ? state.read.role : undefined;

  // The role "Edit summary" is open for; `undefined` while it is closed.
  const [editing, setEditing] = useState<Role>();
  // The role "Delete" is open for; `undefined` while it is closed.
  const [deleting, setDeleting] = useState<Role>();

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

  const handleCloseDelete = useCallback(() => {
    setDeleting(undefined);
    deleteRef.current?.focus();
  }, [setDeleting]);

  // Deleted: the role list opens with the dialog's result. A failed delete stays here with its result, and the role
  // is read again, so one already gone shows "Role not found" (issue 535, task 5).
  const handleDeleteOutcome = useCallback(
    ({ result, allDeleted }: DeleteRolesOutcome) => {
      if (allDeleted) {
        if (result === undefined) {
          void navigate(ROLES_PATH);
        } else {
          flash.handOver(ROLES_PATH, result);
        }
        return;
      }
      if (result !== undefined) {
        flash.show(result);
      }
      refresh();
    },
    [flash, navigate, refresh],
  );

  // A tab changes the query alone, as a new entry of the history: the page stays mounted and reads nothing again.
  const handleTab = useCallback(
    ({ detail }: { detail: TabsProps.ChangeDetail }) => {
      if (detail.activeTabHref !== undefined) {
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
      content = (
        <Container>
          <StatusIndicator type="loading">Loading role</StatusIndicator>
        </Container>
      );
      break;
    case 'found': {
      const found = state.read;
      // The tabs lead to the addresses of the name as the emulator holds it (R8).
      content = (
        <SpaceBetween size="l">
          <SummarySection
            role={found.role}
            editRef={editRef}
            onEdit={() => {
              setEditing(found.role);
            }}
          />
          <Tabs
            activeTabId={activeTab}
            // An arrow key moves between the tabs; Enter or a click chooses one, so the history holds only tabs chosen.
            keyboardActivationMode="manual"
            ariaLabel="Role"
            onChange={handleTab}
            tabs={ROLE_PAGE_TABS.map(({ id, label }) => ({
              id,
              label,
              href: roleTabHref(found.role.name, id),
              content:
                id === 'trust' ? (
                  <TrustTab role={found.role} connection={connection} onDialogOpen={setTrustDialog} />
                ) : (
                  <PermissionsTab
                    role={found.role}
                    policies={found.policies}
                    connection={connection}
                    onRetry={refresh}
                    onDialogOpen={setPermissionsDialog}
                  />
                ),
            }))}
          />
        </SpaceBetween>
      );
      break;
    }
  }

  return (
    <>
      <SpaceBetween size="m">
        <Header
          variant="h1"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" ariaLabel="Refresh role" onClick={handleRefresh} />
              <Button
                ref={deleteRef}
                disabled={role === undefined}
                onClick={() => {
                  setDeleting(role);
                }}
              >
                Delete
              </Button>
            </SpaceBetween>
          }
        >
          <ValueText kind="name" value={role?.name ?? name} />
        </Header>
        {content}
      </SpaceBetween>
      {announcement}
      {editing !== undefined && (
        <EditSummaryDialog role={editing} engineOrigin={connection.engineOrigin} onClose={handleCloseEdit} />
      )}
      {deleting !== undefined && (
        <DeleteRolesDialog
          roles={[deleting]}
          connection={connection}
          onClose={handleCloseDelete}
          onOutcome={handleDeleteOutcome}
        />
      )}
    </>
  );
}
