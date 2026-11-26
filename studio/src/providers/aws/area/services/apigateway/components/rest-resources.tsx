import type { Method, Resource } from '@aws-sdk/client-api-gateway';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useState } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { usePageFlash } from '../../../components/page-flash';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { createMethodPath } from '../format';
import type { AppendedPages } from '../queries';
import { orderedResources, restIntegration } from '../rest-format';
import { useShowPart } from '../show-part';
import { CreateResourceDialog } from './create-resource-dialog';
import { DeleteMethodDialog } from './delete-method-dialog';
import { DeleteResourceDialog } from './delete-resource-dialog';
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

function ResourceMethod({ method, verb, onDelete }: { method: Method; verb: string; onDelete?: () => void }) {
  const integration = restIntegration(method.methodIntegration);
  return (
    <SpaceBetween size="xs">
      <SpaceBetween direction="horizontal" size="xs">
        <Box variant="h4">
          <ValueText kind="fixed" value={verb} />
        </Box>
        {onDelete && <Button onClick={onDelete}>Delete</Button>}
      </SpaceBetween>
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

interface ResourceTarget {
  resourceId: string;
  path: string;
}

type DeleteTarget = ResourceTarget & ({ kind: 'resource' } | { kind: 'method'; method: string });

function ResourcePart({
  resource,
  depth,
  apiId,
  onDelete,
}: {
  resource: Resource;
  depth: number;
  apiId: string;
  onDelete: (target: DeleteTarget) => void;
}) {
  const follow = useFollow();
  const target = resource.id && resource.path ? { resourceId: resource.id, path: resource.path } : undefined;
  const root = resource.path === '/';
  const methods = Object.entries(resource.resourceMethods ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return (
    <Box padding={{ left: depthPadding[Math.min(depth, depthPadding.length - 1)] ?? 'n' }}>
      <Container
        header={
          <Header
            variant="h3"
            actions={
              resource.id && (
                <SpaceBetween direction="horizontal" size="xs">
                  <Button
                    disabled={root || target === undefined}
                    {...(root && { disabledReason: 'The root resource cannot be deleted.' })}
                    onClick={() => {
                      if (target && !root) onDelete({ ...target, kind: 'resource' });
                    }}
                  >
                    Delete
                  </Button>
                  <Button href={createMethodPath(apiId, resource.id)} onFollow={follow}>
                    Create method
                  </Button>
                </SpaceBetween>
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
            methods.map(([verb, method]) => {
              const name = method.httpMethod ?? verb;
              return (
                <ResourceMethod
                  key={verb}
                  method={method}
                  verb={name}
                  {...(target && { onDelete: () => onDelete({ ...target, kind: 'method', method: name }) })}
                />
              );
            })
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
  const flash = usePageFlash();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DeleteTarget>();
  const rootId = list.items?.find(({ path }) => path === '/')?.id;

  function handleCreated(path: string) {
    flash.show([
      {
        type: 'success',
        content: (
          <>
            Resource <ValueText kind="address" value={path} /> created.
          </>
        ),
      },
    ]);
    setCreating(false);
  }

  function handleDeleted(target: DeleteTarget) {
    flash.show([
      {
        type: 'success',
        content: (
          <>
            {target.kind === 'resource' ? (
              'Resource'
            ) : (
              <>
                Method <ValueText kind="fixed" value={target.method} />
              </>
            )}{' '}
            <ValueText kind="address" value={target.path} /> deleted.
          </>
        ),
      },
    ]);
    setDeleting(undefined);
  }
  return (
    <section aria-label="Resources">
      <SpaceBetween size="s">
        <Header
          variant="h2"
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button iconName="refresh" onClick={() => void list.refresh()}>
                Refresh
              </Button>
              <Button onClick={() => setCreating(true)}>Create resource</Button>
            </SpaceBetween>
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
          <ResourcePart
            key={resource.id ?? resource.path}
            resource={resource}
            depth={depth}
            apiId={apiId}
            onDelete={setDeleting}
          />
        ))}
        {list.more && (
          <Button loading={list.loading} onClick={list.loadMore}>
            Load more resources
          </Button>
        )}
      </SpaceBetween>
      {creating && (
        <CreateResourceDialog
          apiId={apiId}
          root={rootId ? { id: rootId, path: '/' } : undefined}
          connection={connection}
          onCreated={handleCreated}
          onDismiss={() => setCreating(false)}
        />
      )}
      {deleting?.kind === 'resource' && (
        <DeleteResourceDialog
          apiId={apiId}
          endpoint={connection.engineOrigin}
          resourceId={deleting.resourceId}
          path={deleting.path}
          onDeleted={() => handleDeleted(deleting)}
          onDismiss={() => setDeleting(undefined)}
        />
      )}
      {deleting?.kind === 'method' && (
        <DeleteMethodDialog
          apiId={apiId}
          endpoint={connection.engineOrigin}
          resourceId={deleting.resourceId}
          path={deleting.path}
          method={deleting.method}
          onDeleted={() => handleDeleted(deleting)}
          onDismiss={() => setDeleting(undefined)}
        />
      )}
    </section>
  );
}
