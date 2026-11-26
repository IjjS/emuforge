import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useQuery } from '@tanstack/react-query';
import { useId, useState } from 'react';
import { useNavigate } from 'react-router';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, noEndpoint } from '../../../components/use-token-listing';
import type { ScreenPageProps } from '../../../screens';
import { apiChoices } from '../api-choices';
import type { ApiRow } from '../apis-api';
import { PagedChoice } from '../components/paged-choice';
import { RequestReadFailure } from '../components/request-read-failure';
import type { ApiChoiceDestination } from '../entries';
import { createApiPath, restApiPath, v2ApiPath } from '../format';

interface ChooseApiPageProps extends ScreenPageProps {
  name: string;
  destination: ApiChoiceDestination;
}

export function ChooseApiPage({ connection, name, destination: { model, part } }: ChooseApiPageProps) {
  useShowsResources('APIs');
  const visit = useId();
  const navigate = useNavigate();
  const handleFollow = useFollow();
  const [selected, setSelected] = useState<ApiRow>();
  const things = model === 'rest' ? 'REST APIs' : 'HTTP or WebSocket APIs';
  const endpoint = connection.engineOrigin;
  const source = apiChoices(endpoint, model);
  const first = useQuery({
    queryKey: [...source.key, 'first-page', endpoint, visit],
    enabled: endpoint !== undefined,
    queryFn: ({ signal }) => (endpoint === undefined ? noEndpoint() : source.read(endpoint, '', undefined, signal)),
    gcTime: 0,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const firstPage = first.data;
  const failure = first.isError && !first.isFetching ? failureOf(first.error, source.operation) : undefined;

  return (
    <SpaceBetween size="l">
      <Header variant="h1" description={`${name} belong to an API. Choose the API to open them.`}>
        {name}
      </Header>
      <Container>
        {firstPage === undefined ? (
          failure === undefined ? (
            <StatusIndicator type="loading">Loading {things}</StatusIndicator>
          ) : (
            <RequestReadFailure
              failure={failure}
              connection={connection}
              thing={things}
              onRetry={() => void first.refetch()}
            />
          )
        ) : firstPage.items.length === 0 && firstPage.next === undefined ? (
          <Box textAlign="center">
            <SpaceBetween size="xs">
              <Box variant="strong">No {things}</Box>
              <Box variant="p">The emulator holds none.</Box>
              <Button href={createApiPath} onFollow={handleFollow}>
                Create API
              </Button>
            </SpaceBetween>
          </Box>
        ) : (
          <SpaceBetween size="m">
            <FormField label="API">
              <PagedChoice
                source={{
                  ...source,
                  // The screen already read the first page to determine its empty state.
                  read: (at, text, token, signal) =>
                    token === undefined ? Promise.resolve(firstPage) : source.read(at, text, token, signal),
                }}
                connection={connection}
                things={things}
                placeholder="Choose an API"
                value={selected}
                onChange={setSelected}
              />
            </FormField>
            <Button
              variant="primary"
              disabled={selected === undefined}
              onClick={() => {
                if (selected === undefined) return;
                const path = model === 'rest' ? restApiPath : v2ApiPath;
                void navigate(path(selected.id, part));
              }}
            >
              Open
            </Button>
          </SpaceBetween>
        )}
      </Container>
    </SpaceBetween>
  );
}
