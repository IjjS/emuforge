import type { LogGroup } from '@aws-sdk/client-cloudwatch-logs';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { DeleteLogGroupDialog } from '../components/delete-log-group-dialog';
import { EditRetentionDialog } from '../components/edit-retention-dialog';
import { GroupDetails } from '../components/group-details';
import { GroupStreams } from '../components/group-streams';
import { ManageTagsDialog } from '../components/manage-tags-dialog';
import { LOG_EVENTS_PATH, LOG_GROUPS_PATH, nameFromSegment, retentionText } from '../format';
import { DELETE_LOG_GROUP } from '../group-delete-api';
import { GROUP_SETTINGS_OPERATIONS, putLogGroupDeletionProtection } from '../group-settings-api';
import { useLogGroup, useLogGroupTags } from '../queries';

type SettingsDialog =
  | { kind: 'retention'; retention: number | undefined }
  | { kind: 'tags'; initialTags: Record<string, string> }
  | { kind: 'delete'; protectedFromDeletion: boolean };

export function LogGroupPage({ connection, params }: ScreenPageProps) {
  useShowsResources('log streams');
  const name = nameFromSegment(params.group ?? '');
  const { engineOrigin } = connection;
  const follow = useFollow();
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const [announcement, announce] = useAnnouncer();
  const [dialog, setDialog] = useState<SettingsDialog>();
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(() => new Set());
  const [protectionPending, setProtectionPending] = useState(false);
  const protectionBusy = useRef(false);
  const [leavingAfterDelete, setLeavingAfterDelete] = useState(false);
  const [lastGroup, setLastGroup] = useState<LogGroup>();
  const streamsSection = useRef<HTMLElement>(null);

  const read = useLogGroup(engineOrigin, name, !leavingAfterDelete);
  const currentGroup = read.value?.kind === 'found' ? read.value.group : undefined;
  if (currentGroup !== undefined && currentGroup !== lastGroup) setLastGroup(currentGroup);
  const deleting = dialog?.kind === 'delete' || leavingAfterDelete;
  // Keep the details during refresh, and while a confirmed deletion can make an outstanding read find nothing.
  const group = currentGroup ?? (read.loading || deleting ? lastGroup : undefined);
  const tags = useLogGroupTags(engineOrigin, name, lastGroup !== undefined && !leavingAfterDelete);
  const failure = read.failure && readFailureState(read.failure, connection, 'log group');
  const message = deleting
    ? ''
    : (failure?.firstText ?? (read.value?.kind === 'not-found' ? 'Log group not found' : ''));

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  const markUnavailable = (operation: string) => setUnavailable((current) => new Set([...current, operation]));
  const dismiss = () => setDialog(undefined);

  const saved = (content: ReactNode) => {
    flash.show([{ type: 'success', content }]);
    dismiss();
    read.refresh();
    tags.refresh();
  };

  const deleted = () => {
    flash.handOver(LOG_GROUPS_PATH, [
      {
        type: 'success',
        content: (
          <>
            Log group <ValueText kind="name" value={name} /> deleted.
          </>
        ),
      },
    ]);
    dismiss();
    setLeavingAfterDelete(true);
  };

  const protectionOperation = GROUP_SETTINGS_OPERATIONS.putDeletionProtection;
  const protectionUnavailable = unavailable.has(protectionOperation);

  async function switchProtection() {
    if (engineOrigin === undefined || group === undefined || protectionBusy.current || protectionUnavailable) return;
    const enabled = group.deletionProtectionEnabled !== true;
    const signal = pageSignal();
    protectionBusy.current = true;
    setProtectionPending(true);
    try {
      await putLogGroupDeletionProtection(engineOrigin, name, enabled, signal);
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, protectionOperation);
      if (refusal.kind === 'not-implemented') markUnavailable(protectionOperation);
      const item = actionFailureItem(refusal, protectionOperation, engineOrigin);
      flash.show([
        refusal.kind === 'engine-did-not-answer' || refusal.kind === 'emulator-did-not-answer'
          ? {
              ...item,
              content: (
                <>
                  {protectionOperation} failed. {item.content}
                </>
              ),
            }
          : item,
      ]);
      protectionBusy.current = false;
      setProtectionPending(false);
      return;
    }
    if (signal.aborted) return;
    saved(
      <>
        Deletion protection turned {enabled ? 'on' : 'off'} for <ValueText kind="name" value={name} />.
      </>,
    );
    protectionBusy.current = false;
    setProtectionPending(false);
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            group && (
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={engineOrigin === undefined || read.loading || protectionPending || leavingAfterDelete}
                  onClick={() =>
                    setDialog({ kind: 'delete', protectedFromDeletion: group.deletionProtectionEnabled === true })
                  }
                >
                  Delete
                </Button>
                <Button
                  href={`${LOG_EVENTS_PATH}?${new URLSearchParams({ group: name }).toString()}`}
                  onFollow={follow}
                >
                  Search log events
                </Button>
                <Button
                  href="#log-streams"
                  onFollow={(event) => {
                    const section = streamsSection.current;
                    if (section === null) return;
                    event.preventDefault();
                    section.focus({ preventScroll: true });
                    section.scrollIntoView({ block: 'start' });
                  }}
                >
                  Jump to log streams
                </Button>
              </SpaceBetween>
            )
          }
        >
          <ValueText kind="name" value={name} />
        </Header>
      }
    >
      {group === undefined ? (
        <Container>
          {failure === undefined ? (
            <Box textAlign="center" color="inherit">
              {read.loading ? (
                <StatusIndicator type="loading">Loading log group</StatusIndicator>
              ) : (
                <Box variant="strong" color="inherit">
                  Log group not found
                </Box>
              )}
            </Box>
          ) : (
            <ReadFailure state={failure} onRetry={read.refresh} />
          )}
        </Container>
      ) : (
        <SpaceBetween size="l">
          <GroupDetails
            connection={connection}
            group={group}
            tags={tags}
            groupLoading={read.loading || leavingAfterDelete}
            protectionPending={protectionPending}
            protectionUnavailable={protectionUnavailable}
            onEditRetention={() => setDialog({ kind: 'retention', retention: group.retentionInDays })}
            onSwitchProtection={() => void switchProtection()}
            onManageTags={() => {
              if (tags.value !== undefined) setDialog({ kind: 'tags', initialTags: tags.value });
            }}
          />
          <section ref={streamsSection} id="log-streams" tabIndex={-1} aria-label="Log streams">
            <GroupStreams connection={connection} group={name} />
          </section>
        </SpaceBetween>
      )}
      {engineOrigin !== undefined && dialog?.kind === 'retention' && (
        <EditRetentionDialog
          endpoint={engineOrigin}
          name={name}
          retention={dialog.retention}
          unavailable={unavailable}
          onUnavailable={markUnavailable}
          onSaved={(retention) =>
            saved(
              <>
                Retention of <ValueText kind="name" value={name} /> set to {retentionText(retention)}.
              </>,
            )
          }
          onDismiss={dismiss}
        />
      )}
      {engineOrigin !== undefined && dialog?.kind === 'tags' && (
        <ManageTagsDialog
          connection={connection}
          endpoint={engineOrigin}
          name={name}
          initialTags={dialog.initialTags}
          tags={tags}
          unavailable={unavailable}
          onUnavailable={markUnavailable}
          onSaved={() =>
            saved(
              <>
                Tags of <ValueText kind="name" value={name} /> saved.
              </>,
            )
          }
          onDismiss={dismiss}
        />
      )}
      {engineOrigin !== undefined && dialog?.kind === 'delete' && (
        <DeleteLogGroupDialog
          endpoint={engineOrigin}
          name={name}
          protectedFromDeletion={dialog.protectedFromDeletion}
          unavailable={unavailable.has(DELETE_LOG_GROUP)}
          onUnavailable={() => markUnavailable(DELETE_LOG_GROUP)}
          onDeleted={deleted}
          onDismiss={dismiss}
        />
      )}
      {announcement}
    </ContentLayout>
  );
}
