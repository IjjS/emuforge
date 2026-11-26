import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect } from 'react';

import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { GroupDetails } from '../components/group-details';
import { GroupStreams } from '../components/group-streams';
import { LOG_EVENTS_PATH, nameFromSegment } from '../format';
import { useLogGroup, useLogGroupTags } from '../queries';

export function LogGroupPage({ connection, params }: ScreenPageProps) {
  useShowsResources('log streams');
  const name = nameFromSegment(params.group ?? '');
  const follow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const read = useLogGroup(connection.engineOrigin, name);
  const group = read.value?.kind === 'found' ? read.value.group : undefined;
  const tags = useLogGroupTags(connection.engineOrigin, name, group !== undefined);
  const failure = read.failure && readFailureState(read.failure, connection, 'log group');
  const message = failure?.firstText ?? (read.value?.kind === 'not-found' ? 'Log group not found' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            group && (
              <Button href={`${LOG_EVENTS_PATH}?${new URLSearchParams({ group: name }).toString()}`} onFollow={follow}>
                Search log events
              </Button>
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
          <GroupDetails connection={connection} group={group} tags={tags} />
          <GroupStreams connection={connection} group={name} />
        </SpaceBetween>
      )}
      {announcement}
    </ContentLayout>
  );
}
