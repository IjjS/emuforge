import type { DescribeEventBusResponse } from '@aws-sdk/client-eventbridge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useState } from 'react';

import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { BUS_DELETE_UNAVAILABLE, DEFAULT_BUS_DELETE_REASON } from '../bus-change-api';
import { BusDetails } from '../components/bus-details';
import { DeleteEventBusDialog } from '../components/delete-event-bus-dialog';
import { RulesTable } from '../components/rules-table';
import { busFromParams, createRulePath, EVENT_BUSES_PATH, EVENT_BUSES_TITLE, sendEventsPath } from '../format';
import { useEventBus, useResourceTags } from '../queries';

export function EventBusPage({ connection, params }: ScreenPageProps) {
  useShowsResources('rules');
  const name = busFromParams(params);
  const follow = useFollow();
  const flash = usePageFlash();
  const { engineOrigin } = connection;
  const [deleting, setDeleting] = useState<{
    bus: DescribeEventBusResponse;
    tags: ReturnType<typeof useResourceTags>;
  }>();
  const [leaving, setLeaving] = useState(false);
  const [deleteUnavailable, setDeleteUnavailable] = useState(false);
  const read = useEventBus(engineOrigin, name, !leaving);
  const currentBus = read.value?.kind === 'found' ? read.value.bus : undefined;
  const bus = deleting?.bus ?? currentBus;
  const tags = useResourceTags(engineOrigin, bus?.Arn ?? '', Boolean(bus?.Arn) && !leaving);
  const shownTags = deleting?.tags ?? tags;
  const failure =
    deleting === undefined && read.failure ? readFailureState(read.failure, connection, 'event bus') : undefined;
  const missing = deleting === undefined && read.value?.kind === 'not-found';
  const deleteReason =
    name === 'default' ? DEFAULT_BUS_DELETE_REASON : deleteUnavailable ? BUS_DELETE_UNAVAILABLE : undefined;
  const canDelete =
    engineOrigin !== undefined && currentBus !== undefined && deleting === undefined && deleteReason === undefined;
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
                <Button
                  disabled={!canDelete}
                  disabledReason={deleteReason}
                  onClick={() => {
                    if (canDelete) setDeleting({ bus: currentBus, tags });
                  }}
                >
                  Delete
                </Button>
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
        {deleting === undefined && read.loading && (
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
            <BusDetails connection={connection} bus={bus} tags={shownTags} />
            <RulesTable
              key={bus.Name ?? name}
              connection={connection}
              bus={bus.Name ?? name}
              holdListing={deleting !== undefined}
              readsEnabled={!leaving}
            />
          </>
        )}
        {engineOrigin !== undefined && deleting !== undefined && (
          <DeleteEventBusDialog
            endpoint={engineOrigin}
            name={name}
            onDismiss={() => setDeleting(undefined)}
            onUnavailable={() => setDeleteUnavailable(true)}
            onDeleted={() => {
              setLeaving(true);
              flash.handOver(EVENT_BUSES_PATH, [
                {
                  type: 'success',
                  content: (
                    <>
                      Event bus <ValueText kind="name" value={name} /> deleted.
                    </>
                  ),
                },
              ]);
            }}
          />
        )}
        {announcement}
      </SpaceBetween>
    </ContentLayout>
  );
}
