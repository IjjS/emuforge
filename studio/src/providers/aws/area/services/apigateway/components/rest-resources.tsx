import type { Method, Resource } from '@aws-sdk/client-api-gateway';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { createMethodPath } from '../format';
import type { AppendedPages } from '../queries';
import { orderedResources, restIntegration } from '../rest-format';
import { useShowPart } from '../show-part';
import { RequestReadFailure } from './request-read-failure';

function Responses({ method }: { method: Method }) {
  const methodResponses = Object.entries(method.methodResponses ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const integrations = Object.entries(method.methodIntegration?.integrationResponses ?? {}).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  return (
    <ExpandableSection headerText="Responses" variant="footer">
      <SpaceBetween size="s">
        <Box variant="strong">Method responses</Box>
        {methodResponses.length === 0 ? (
          <Box>No method responses</Box>
        ) : (
          <KeyValuePairs
            columns={1}
            items={methodResponses.map(([code, response]) => ({
              label: 'Status code',
              value: <ValueText kind="fixed" value={response.statusCode ?? code} />,
            }))}
          />
        )}
        <Box variant="strong">Integration responses</Box>
        {integrations.length === 0 && <Box>No integration responses</Box>}
        {integrations.map(([code, response]) => (
          <SpaceBetween key={code} size="xs">
            <KeyValuePairs
              columns={2}
              items={[
                { label: 'Status code', value: <ValueText kind="fixed" value={response.statusCode ?? code} /> },
                ...(response.selectionPattern === undefined
                  ? []
                  : [
                      {
                        label: 'Selection pattern',
                        value: <ValueText kind="text" value={response.selectionPattern} />,
                      },
                    ]),
              ]}
            />
            {Object.entries(response.responseTemplates ?? {}).map(([contentType, template]) => (
              <div key={contentType}>
                <Box variant="strong">
                  <ValueText kind="name" value={contentType} />
                </Box>
                <Box variant="pre" nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}>
                  {template}
                </Box>
              </div>
            ))}
          </SpaceBetween>
        ))}
      </SpaceBetween>
    </ExpandableSection>
  );
}

function ResourceMethod({ method, verb }: { method: Method; verb: string }) {
  const integration = restIntegration(method.methodIntegration);
  return (
    <SpaceBetween size="xs">
      <Box variant="h4">
        <ValueText kind="fixed" value={verb} />
      </Box>
      <KeyValuePairs
        columns={3}
        items={[
          { label: 'Authorization', value: <ValueText kind="fixed" value={method.authorizationType} none="-" /> },
          { label: 'API key required', value: method.apiKeyRequired ? 'Yes' : 'No' },
          {
            label: 'Integration',
            value: (
              <SpaceBetween size="xxxs">
                <ValueText kind="fixed" value={integration.kind} />
                {integration.label && <CopyValue label={integration.label} value={integration.target} />}
              </SpaceBetween>
            ),
          },
        ]}
      />
      <Responses method={method} />
    </SpaceBetween>
  );
}

const depthPadding = ['n', 'xs', 's', 'm', 'l', 'xl'] as const;

function ResourcePart({ resource, depth, apiId }: { resource: Resource; depth: number; apiId: string }) {
  const follow = useFollow();
  const methods = Object.entries(resource.resourceMethods ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Box padding={{ left: depthPadding[Math.min(depth, depthPadding.length - 1)] ?? 'n' }}>
      <Container
        header={
          <Header
            variant="h3"
            actions={
              resource.id && (
                <Button href={createMethodPath(apiId, resource.id)} onFollow={follow}>
                  Create method
                </Button>
              )
            }
          >
            <ValueText kind="address" value={resource.path} none="-" />
          </Header>
        }
      >
        <SpaceBetween size="s">
          <KeyValuePairs
            columns={1}
            items={[
              {
                label: 'Resource ID',
                value: <CopyValue label="Resource ID" value={resource.id} kind="name" none="-" />,
              },
            ]}
          />
          {methods.length === 0 ? (
            <Box>No methods</Box>
          ) : (
            methods.map(([verb, method]) => (
              <ResourceMethod key={verb} method={method} verb={method.httpMethod ?? verb} />
            ))
          )}
        </SpaceBetween>
      </Container>
    </Box>
  );
}

export function RestResources({
  apiId,
  connection,
  list,
}: {
  apiId: string;
  connection: AreaConnection;
  list: AppendedPages<Resource>;
}) {
  const focusHeading = useShowPart('resources');
  return (
    <section aria-label="Resources">
      <SpaceBetween size="s">
        <Header
          variant="h2"
          actions={
            <Button iconName="refresh" onClick={() => void list.refresh()}>
              Refresh
            </Button>
          }
        >
          <span
            ref={(text) => {
              const heading = text?.closest('h2') ?? null;
              if (heading) heading.tabIndex = -1;
              focusHeading(heading);
            }}
          >
            Resources
          </span>
        </Header>
        {list.failure && (
          <RequestReadFailure failure={list.failure} connection={connection} thing="resources" onRetry={list.retry} />
        )}
        {list.items === undefined && list.loading && (
          <StatusIndicator type="loading">Loading resources…</StatusIndicator>
        )}
        {list.items?.length === 0 && <Box>No resources</Box>}
        {orderedResources(list.items ?? []).map(({ resource, depth }) => (
          <ResourcePart key={resource.id ?? resource.path} resource={resource} depth={depth} apiId={apiId} />
        ))}
        {list.more && (
          <Button loading={list.loading} onClick={list.loadMore}>
            Load more resources
          </Button>
        )}
      </SpaceBetween>
    </section>
  );
}
