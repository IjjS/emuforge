import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect } from 'react';
import { useLocation } from 'react-router';

import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState, useAnnouncer } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ScreenPageProps } from '../../../screens';
import { isEditableAlarm } from '../alarm';
import { useAlarm, useAlarmHistory, useAlarmTags } from '../alarm-queries';
import { AlarmActions } from '../components/alarm-actions';
import { AlarmCondition } from '../components/alarm-condition';
import { AlarmHistory } from '../components/alarm-history';
import { AlarmName } from '../components/alarm-name';
import { AlarmSummary } from '../components/alarm-summary';
import { AlarmTags } from '../components/alarm-tags';
import { alarmNameFromSearch, ALARMS_PATH, editAlarmPath } from '../paths';

export function AlarmPage({ connection }: ScreenPageProps) {
  useShowsResources('alarms');
  const { search } = useLocation();
  const name = alarmNameFromSearch(search);
  return <AlarmDetail key={name} name={name} connection={connection} />;
}

function AlarmDetail({ name, connection }: { name: string | undefined; connection: AreaConnection }) {
  const follow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const read = useAlarm(connection.engineOrigin, name);
  const alarm = read.value;
  const history = useAlarmHistory(connection.engineOrigin, alarm?.data.AlarmName);
  const tags = useAlarmTags(connection.engineOrigin, alarm?.data.AlarmArn);
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

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            name !== undefined && (
              <SpaceBetween direction="horizontal" size="xs">
                <Button iconName="refresh" ariaLabel="Refresh" onClick={handleRefresh} />
                {alarm !== undefined && isEditableAlarm(alarm) && (
                  <Button href={editAlarmPath(name)} onFollow={follow}>
                    Edit
                  </Button>
                )}
              </SpaceBetween>
            )
          }
        >
          {name === undefined ? 'Alarm not found' : <AlarmName name={name} />}
        </Header>
      }
    >
      {alarm !== undefined ? (
        <SpaceBetween size="l">
          <AlarmSummary alarm={alarm} />
          <AlarmCondition alarm={alarm} />
          <AlarmActions alarm={alarm} />
          <AlarmHistory connection={connection} listing={history} />
          <AlarmTags connection={connection} tags={tags} />
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
      {announcement}
    </ContentLayout>
  );
}
