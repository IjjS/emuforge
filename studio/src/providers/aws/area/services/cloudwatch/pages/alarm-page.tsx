import type { StateValue, Tag } from '@aws-sdk/client-cloudwatch';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router';

import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { isEditableAlarm } from '../alarm';
import { useAlarm, useAlarmHistory, useAlarmTags } from '../alarm-queries';
import { AlarmActions } from '../components/alarm-actions';
import { AlarmCondition } from '../components/alarm-condition';
import { AlarmHistory } from '../components/alarm-history';
import { AlarmName } from '../components/alarm-name';
import { AlarmSummary } from '../components/alarm-summary';
import { AlarmTags } from '../components/alarm-tags';
import { DeleteAlarmDialog } from '../components/delete-alarm-dialog';
import { ManageTagsDialog } from '../components/manage-tags-dialog';
import { SetStateDialog } from '../components/set-state-dialog';
import { alarmStateText } from '../format';
import { alarmNameFromSearch, ALARMS_PATH, editAlarmPath } from '../paths';
import type { TagOperation } from '../tags-api';
import { SET_ALARM_STATE } from '../try-api';
import { useActionsSwitch } from '../use-actions-switch';

const HISTORY_ID = 'cloudwatch-alarm-history';

export function AlarmPage({ connection }: ScreenPageProps) {
  useShowsResources('alarms');
  const { search } = useLocation();
  const name = alarmNameFromSearch(search);
  return <AlarmDetail key={name} name={name} connection={connection} />;
}

function AlarmDetail({ name, connection }: { name: string | undefined; connection: AreaConnection }) {
  const follow = useFollow();
  const flash = usePageFlash();
  const historySection = useRef<HTMLElement>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteUnavailable, setDeleteUnavailable] = useState(false);
  const [stateDialog, setStateDialog] = useState<{ currentState: StateValue | undefined }>();
  const [stateUnavailable, setStateUnavailable] = useState(false);
  const [tagDialog, setTagDialog] = useState<{ arn: string; initialTags: Tag[] }>();
  const [tagUnavailable, setTagUnavailable] = useState<ReadonlySet<TagOperation>>(() => new Set());
  const { engineOrigin } = connection;
  const [announcement, announce] = useAnnouncer();
  const read = useAlarm(connection.engineOrigin, name);
  const alarm = read.value;
  const history = useAlarmHistory(connection.engineOrigin, alarm?.data.AlarmName);
  const arn = alarm?.data.AlarmArn;
  const tags = useAlarmTags(connection.engineOrigin, tagDialog?.arn ?? arn);
  const canManageTags = engineOrigin !== undefined && arn !== undefined && tags.value !== undefined;
  const actions = useActionsSwitch({
    endpoint: engineOrigin,
    name,
    actionsEnabled: alarm?.data.ActionsEnabled,
    refreshAlarm: read.refresh,
    refreshHistory: () => history.goToPage(1),
  });
  const failure = read.failure && readFailureState(read.failure, connection, 'alarm');
  const missing = !read.loading && alarm === undefined && failure === undefined;
  const message = failure?.firstText ?? (missing ? 'Alarm not found' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  const handleRefresh = () => {
    void read.refresh();
    if (alarm !== undefined) {
      history.refresh();
      void tags.refresh();
    }
  };

  const handleStateSet = (state: StateValue) => {
    if (name === undefined) return;
    setStateDialog(undefined);
    flash.show([
      {
        type: 'success',
        content: (
          <>
            <span>
              State of <AlarmName name={name} /> set to {alarmStateText(state)}.
            </span>{' '}
            <Link
              color="inverted"
              variant="primary"
              href={`#${HISTORY_ID}`}
              onFollow={(event) => {
                event.preventDefault();
                const section = historySection.current;
                section?.focus({ preventScroll: true });
                section?.scrollIntoView?.({ block: 'start' });
              }}
            >
              View history
            </Link>
          </>
        ),
      },
    ]);
    void read.refresh();
    history.goToPage(1);
  };

  const handleTagsSaved = () => {
    if (name === undefined) return;
    setTagDialog(undefined);
    flash.show([
      {
        type: 'success',
        content: (
          <>
            Tags of <AlarmName name={name} /> saved.
          </>
        ),
      },
    ]);
    void tags.refresh();
  };

  const handleDeleted = (deletedName: string) => {
    setDeleteOpen(false);
    flash.handOver(ALARMS_PATH, [
      {
        type: 'success',
        content: (
          <>
            Alarm <AlarmName name={deletedName} /> deleted.
          </>
        ),
      },
    ]);
  };

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description={stateUnavailable ? `Not implemented by the emulator (${SET_ALARM_STATE}).` : undefined}
          actions={
            name !== undefined && (
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" disabled={actions.pending} onClick={handleRefresh} />
                {alarm !== undefined && (
                  <>
                    <Button
                      disabled={engineOrigin === undefined || alarm.type === 'log' || actions.pending}
                      disabledReason={
                        alarm.type === 'log' ? 'The emulator does not set the state of a log alarm.' : undefined
                      }
                      onClick={() => setStateDialog({ currentState: alarm.data.StateValue })}
                    >
                      Set state
                    </Button>
                    <Button
                      disabled={engineOrigin === undefined || actions.pending || actions.unavailable}
                      disabledReason={actions.disabledReason}
                      loading={actions.pending}
                      onClick={() => void actions.toggle()}
                    >
                      {actions.label}
                    </Button>
                  </>
                )}
                {alarm !== undefined && isEditableAlarm(alarm) && (
                  <Button href={editAlarmPath(name)} onFollow={follow}>
                    Edit
                  </Button>
                )}
                {alarm !== undefined && (
                  <Button disabled={engineOrigin === undefined} onClick={() => setDeleteOpen(true)}>
                    Delete
                  </Button>
                )}
              </SpaceBetween>
            )
          }
        >
          {name === undefined ? (
            'Alarm not found'
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>
              <ValueText kind="name" value={name} />
            </span>
          )}
        </Header>
      }
    >
      {alarm !== undefined ? (
        <SpaceBetween size="l">
          <AlarmSummary alarm={alarm} />
          <AlarmCondition alarm={alarm} />
          <AlarmActions alarm={alarm} />
          <section id={HISTORY_ID} aria-label="History" tabIndex={-1} ref={historySection}>
            <AlarmHistory connection={connection} listing={history} />
          </section>
          <AlarmTags
            connection={connection}
            tags={tags}
            manage={{
              enabled: canManageTags,
              unavailable: tagUnavailable,
              open: () => {
                if (arn !== undefined && tags.value !== undefined) setTagDialog({ arn, initialTags: tags.value });
              },
            }}
          />
        </SpaceBetween>
      ) : (
        <Container>
          {failure ? (
            <ReadFailure state={failure} onRetry={handleRefresh} />
          ) : read.loading ? (
            <StatusIndicator type="loading">Loading alarm</StatusIndicator>
          ) : (
            <SpaceBetween size="s">
              {name !== undefined && <Box variant="h2">Alarm not found</Box>}
              <Link href={ALARMS_PATH} onFollow={follow}>
                Alarms
              </Link>
            </SpaceBetween>
          )}
        </Container>
      )}
      {deleteOpen && name !== undefined && engineOrigin !== undefined && (
        <DeleteAlarmDialog
          endpoint={engineOrigin}
          name={name}
          unavailable={deleteUnavailable}
          onUnavailable={() => setDeleteUnavailable(true)}
          onDeleted={handleDeleted}
          onDismiss={() => setDeleteOpen(false)}
        />
      )}
      {stateDialog !== undefined && name !== undefined && engineOrigin !== undefined && (
        <SetStateDialog
          endpoint={engineOrigin}
          name={name}
          currentState={stateDialog.currentState}
          unavailable={stateUnavailable}
          onUnavailable={() => setStateUnavailable(true)}
          onSet={handleStateSet}
          onDismiss={() => setStateDialog(undefined)}
        />
      )}
      {tagDialog !== undefined && engineOrigin !== undefined && (
        <ManageTagsDialog
          endpoint={engineOrigin}
          connection={connection}
          arn={tagDialog.arn}
          initialTags={tagDialog.initialTags}
          tags={tags}
          unavailable={tagUnavailable}
          onUnavailable={(operation) => setTagUnavailable((known) => new Set([...known, operation]))}
          onSaved={handleTagsSaved}
          onDismiss={() => setTagDialog(undefined)}
        />
      )}
      {announcement}
    </ContentLayout>
  );
}
