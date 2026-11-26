import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useQueryClient } from '@tanstack/react-query';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { RequestReadFailure } from '../components/request-read-failure';
import { RestDetails } from '../components/rest-details';
import { RestResources } from '../components/rest-resources';
import { RestStages } from '../components/rest-stages';
import { ENTRIES } from '../entries';
import { apisPath, restApiPath, servicePath } from '../format';
import { refreshRestApi, useRestApi, useRestResources } from '../rest-queries';

const relatedParts = new Set([
  'Deployments',
  'Authorizers',
  'Models',
  'Request validators',
  'Gateway responses',
  'Documentation parts',
  'Documentation versions',
]);

export function RestApiPage({ connection, params }: ScreenPageProps) {
  useShowsResources('APIs');
  const apiId = params.api_id ?? '';
  const client = useQueryClient();
  const follow = useFollow();
  const api = useRestApi(apiId, connection.engineOrigin);
  const resources = useRestResources(apiId, connection.engineOrigin);
  const refresh = () => void refreshRestApi(client, apiId);
  const notFound = api.data === null;

  return (
    <SpaceBetween size="l">
      <Header variant="h1">
        {notFound ? 'API not found' : <ValueText kind="name" value={api.data?.name ?? apiId} none="REST API" />}
      </Header>
      {api.failure && (
        <RequestReadFailure failure={api.failure} connection={connection} thing="REST API" onRetry={refresh} />
      )}
      {notFound && (
        <SpaceBetween size="s">
          <Box>
            The emulator holds no REST API with the ID <ValueText kind="name" value={apiId} />.
          </Box>
          <Link href={apisPath} onFollow={follow}>
            APIs
          </Link>
        </SpaceBetween>
      )}
      {api.data === undefined && api.loading && <StatusIndicator type="loading">Loading API…</StatusIndicator>}
      {api.data && (
        <>
          <RestDetails api={api.data} apiId={apiId} onRefresh={refresh} />
          <RestResources apiId={apiId} connection={connection} list={resources} />
          <RestStages apiId={apiId} connection={connection} />
          <Container header={<Header variant="h2">Related API settings</Header>}>
            <SpaceBetween size="xs">
              {ENTRIES.filter(({ group, name }) => group === 'REST APIs' && relatedParts.has(name)).map(
                ({ name, path }) => (
                  <Link key={path} href={restApiPath(apiId) + path.slice(servicePath.length)} onFollow={follow}>
                    {name}
                  </Link>
                ),
              )}
            </SpaceBetween>
          </Container>
        </>
      )}
    </SpaceBetween>
  );
}
