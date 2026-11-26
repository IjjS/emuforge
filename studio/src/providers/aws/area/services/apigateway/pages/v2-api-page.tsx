import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { RequestReadFailure } from '../components/request-read-failure';
import { V2Details } from '../components/v2-details';
import { V2Integrations } from '../components/v2-integrations';
import { V2Routes } from '../components/v2-routes';
import { V2Stages } from '../components/v2-stages';
import { apisPath, servicePath } from '../format';
import { useV2Api, useV2Integrations, useV2Routes, useV2Stages } from '../v2-queries';

const apiLinks = [
  ['Deployments', 'v2-deployments'],
  ['Authorizers', 'v2-authorizers'],
] as const;

const webSocketLinks = [
  ['Models', 'v2-models'],
  ['Route responses', 'route-responses'],
  ['Integration responses', 'integration-responses'],
] as const;

export function V2ApiPage({ connection, params }: ScreenPageProps) {
  useShowsResources('APIs');
  const id = params.api_id ?? '';
  const endpoint = connection.engineOrigin;
  const reading = useV2Api(endpoint, id);
  const routes = useV2Routes(endpoint, id);
  const integrations = useV2Integrations(endpoint, id);
  const stages = useV2Stages(endpoint, id);
  const handleFollow = useFollow();
  const api = reading.value?.found === true ? reading.value.api : undefined;

  let heading: ReactNode = <ValueText kind="name" value={api?.Name ?? id} />;
  let content;
  if (reading.failure !== undefined) {
    content = (
      <Container>
        <RequestReadFailure
          failure={reading.failure}
          connection={connection}
          thing="API"
          onRetry={() => void reading.refresh()}
        />
      </Container>
    );
  } else if (reading.value === undefined) {
    content = (
      <Container>
        <StatusIndicator type="loading">Loading API…</StatusIndicator>
      </Container>
    );
  } else if (api === undefined) {
    heading = 'API not found';
    content = (
      <Container>
        <Box textAlign="center">
          <SpaceBetween size="xxs">
            <Box>
              The emulator holds no HTTP or WebSocket API with the ID <ValueText kind="name" value={id} />.
            </Box>
            <Link href={apisPath} onFollow={handleFollow}>
              View APIs
            </Link>
          </SpaceBetween>
        </Box>
      </Container>
    );
  } else {
    const links = api.ProtocolType === 'WEBSOCKET' ? [...apiLinks, ...webSocketLinks] : apiLinks;
    content = (
      <>
        <V2Details api={api} id={id} endpoint={endpoint} onRefresh={() => void reading.refresh()} />
        <V2Routes
          id={id}
          isHttp={api.ProtocolType === 'HTTP'}
          routes={routes}
          integrations={integrations.items ?? []}
          connection={connection}
        />
        <V2Integrations integrations={integrations} routes={routes} connection={connection} />
        <V2Stages api={api} stages={stages} connection={connection} />
        <Container header={<Header variant="h2">More API settings</Header>}>
          <SpaceBetween size="xs">
            {links.map(([name, segment]) => (
              <Link key={segment} href={`${servicePath}/${segment}`} onFollow={handleFollow}>
                {name}
              </Link>
            ))}
          </SpaceBetween>
        </Container>
      </>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1">{heading}</Header>
      {content}
    </SpaceBetween>
  );
}
