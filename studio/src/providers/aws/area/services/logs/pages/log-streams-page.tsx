import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';

import { ChoiceSelect } from '../../../components/choice-select';
import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import type { ScreenPageProps } from '../../../screens';
import { logGroupChoices } from '../choices';
import { StreamSection } from '../components/stream-section';
import { useLogGroup } from '../queries';

export function LogStreamsPage({ connection }: ScreenPageProps) {
  useShowsResources('log streams');
  const [search, setSearch] = useSearchParams();
  const group = search.get('group') || undefined;
  const read = useLogGroup(connection.engineOrigin, group ?? '', group !== undefined);
  const failure = read.failure && readFailureState(read.failure, connection, 'log group');
  const [announcement, announce] = useAnnouncer();
  const message = failure?.firstText ?? (read.value?.kind === 'not-found' ? 'Log group not found' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  return (
    <ContentLayout header={<Header variant="h1">Log streams</Header>}>
      <SpaceBetween size="l">
        <Container>
          <FormField label="Log group">
            <ChoiceSelect
              connection={connection}
              source={logGroupChoices(connection.engineOrigin)}
              things="log groups"
              value={group}
              placeholder="Choose a log group"
              onChange={(name) => {
                const next = new URLSearchParams(search);
                if (name === undefined) next.delete('group');
                else next.set('group', name);
                setSearch(next);
              }}
            />
          </FormField>
        </Container>
        {group === undefined && <Box>Choose a log group.</Box>}
        {group !== undefined && (
          <>
            {read.value?.kind === 'found' && <StreamSection key={group} group={group} connection={connection} />}
            {read.loading && <StatusIndicator type="loading">Loading log group</StatusIndicator>}
            {read.value?.kind === 'not-found' && <Box variant="strong">Log group not found</Box>}
            {failure && <ReadFailure state={failure} onRetry={read.refresh} />}
          </>
        )}
      </SpaceBetween>
      {announcement}
    </ContentLayout>
  );
}
