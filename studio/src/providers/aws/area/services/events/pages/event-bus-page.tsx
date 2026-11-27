import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect } from 'react';

import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { BusDetails } from '../components/bus-details';
import { RulesTable } from '../components/rules-table';
import { busFromParams, createRulePath, EVENT_BUSES_PATH, EVENT_BUSES_TITLE, sendEventsPath } from '../format';
import { useEventBus, useResourceTags } from '../queries';

export function EventBusPage({ connection, params }: ScreenPageProps) {
  useShowsResources('rules');
  const name = busFromParams(params);
  const follow = useFollow();
  const read = useEventBus(connection.engineOrigin, name);
  const bus = read.value?.kind === 'found' ? read.value.bus : undefined;
  const tags = useResourceTags(connection.engineOrigin, bus?.Arn ?? '', Boolean(bus?.Arn));
  const failure = read.failure && readFailureState(read.failure, connection, 'event bus');
  const missing = read.value?.kind === 'not-found';
  const [announcement, announce] = useAnnouncer();
  const message = failure?.firstText ?? (missing ? 'Event bus not found' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            bus !== undefined && (
              <SpaceBetween direction="horizontal" size="xs">
                <Button href={sendEventsPath(name)} onFollow={follow}>
                  Send events
                </Button>
                <Button variant="primary" href={createRulePath(name)} onFollow={follow}>
                  Create rule
                </Button>
              </SpaceBetween>
            )
          }
        >
          <ValueText kind="name" value={name} />
        </Header>
      }
    >
      <SpaceBetween size="m">
        {read.loading && (
          <Container>
            <Box textAlign="center">
              <StatusIndicator type="loading">Loading event bus</StatusIndicator>
            </Box>
          </Container>
        )}
        {failure !== undefined && (
          <Container>
            <ReadFailure state={failure} onRetry={read.refresh} />
          </Container>
        )}
        {missing && (
          <Container>
            <Box textAlign="center">
              <SpaceBetween size="xs">
                <Box variant="strong">Event bus not found</Box>
                <Link href={EVENT_BUSES_PATH} onFollow={follow}>
                  {EVENT_BUSES_TITLE}
                </Link>
              </SpaceBetween>
            </Box>
          </Container>
        )}
        {bus !== undefined && (
          <>
            <BusDetails connection={connection} bus={bus} tags={tags} />
            <RulesTable key={bus.Name ?? name} connection={connection} bus={bus.Name ?? name} />
          </>
        )}
        {announcement}
      </SpaceBetween>
    </ContentLayout>
  );
}
