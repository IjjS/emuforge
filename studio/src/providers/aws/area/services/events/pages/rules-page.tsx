import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';
import { useNavigationType, useSearchParams } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import type { ScreenPageProps } from '../../../screens';
import { BusSelect } from '../components/bus-select';
import { RulesTable } from '../components/rules-table';
import { createRulePath } from '../format';
import { useBusChoice } from '../use-bus-choice';

export function RulesPage({ connection }: Pick<ScreenPageProps, 'connection'>) {
  useShowsResources('rules');
  const follow = useFollow();
  const [search, setSearch] = useSearchParams();
  const navigationType = useNavigationType();
  const [selectedBus, setSelectedBus] = useState<string>();
  const choice = useBusChoice(
    connection.engineOrigin,
    search.get('bus'),
    navigationType === 'REPLACE' ? selectedBus : undefined,
  );
  const bus = choice.kind === 'chosen' ? choice.name : undefined;

  function handleBusChange(name: string) {
    setSelectedBus(name);
    setSearch({ bus: name }, { replace: true });
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            bus === undefined ? (
              <Button variant="primary" disabled>
                Create rule
              </Button>
            ) : (
              <Button variant="primary" href={createRulePath(bus)} onFollow={follow}>
                Create rule
              </Button>
            )
          }
        >
          Rules
        </Header>
      }
    >
      <SpaceBetween size="m">
        <Container>
          <BusSelect connection={connection} choice={choice} onChange={handleBusChange} />
        </Container>
        {bus !== undefined && <RulesTable key={bus} connection={connection} bus={bus} />}
        {choice.kind === 'invalid' && (
          <Container>
            <Box textAlign="center">{choice.message}</Box>
          </Container>
        )}
        {choice.kind === 'loading' && (
          <Container>
            <Box textAlign="center">
              <StatusIndicator type="loading">Loading rules</StatusIndicator>
            </Box>
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
