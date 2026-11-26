import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useState } from 'react';

import type { AreaConnection } from '../../../components/emulator-line';
import { useAnnouncer } from '../../../components/failure-states';
import { creationDateText } from '../../../components/format-date';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import type { DeleteApiTarget } from '../api-delete-api';
import type { ApiRow } from '../apis-api';
import { DeleteApiDialog } from '../components/delete-api-dialog';
import { RequestReadFailure, requestReadFailureState } from '../components/request-read-failure';
import { createApiPath, endpointTypeText, restApiPath, v2ApiPath } from '../format';
import { useApiLists, type AppendedPages } from '../queries';

const title = 'APIs';

function apiRowKey(api: ApiRow): string {
  return `${api.kind === 'REST' ? 'rest' : 'v2'}:${api.id}`;
}

function ListFailure({
  list,
  connection,
  thing,
  inTable,
}: {
  list: AppendedPages<ApiRow>;
  connection: AreaConnection;
  thing: string;
  inTable: boolean;
}) {
  const { failure, retry } = list;
  const handleFollow = useFollow();
  if (failure === undefined) return null;
  if (inTable) {
    return <RequestReadFailure failure={failure} connection={connection} thing={thing} onRetry={retry} />;
  }

  const state = requestReadFailureState(failure, connection, thing);
  return (
    <Alert
      type={state.type === 'info' ? 'info' : 'error'}
      header={state.first}
      action={<Button onClick={retry}>Retry</Button>}
    >
      <SpaceBetween size="xxs">
        {state.detail}
        {state.recovery && (
          <Link href="/" onFollow={handleFollow}>
            Connection status
          </Link>
        )}
      </SpaceBetween>
    </Alert>
  );
}

export function ApiListPage({ connection }: ScreenPageProps) {
  useShowsResources(title);
  const { rest, v2 } = useApiLists(connection.engineOrigin);
  const handleFollow = useFollow();
  const flash = usePageFlash();
  const [deleteTarget, setDeleteTarget] = useState<DeleteApiTarget>();
  const [selectedKey, setSelectedKey] = useState<string>();
  const [copyStatus, setCopyStatus] = useState<'success' | 'error'>();
  const [announcement, announce] = useAnnouncer();

  const rows = [...(rest.items ?? []), ...(v2.items ?? [])].sort(
    (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
  );
  const selected = rows.find((row) => apiRowKey(row) === selectedKey);
  const bothFailed = rest.failure !== undefined && v2.failure !== undefined && rows.length === 0;
  const bothRead = rest.items !== undefined && v2.items !== undefined;
  const loading = rows.length === 0 && (rest.loading || v2.loading);
  const copyText = copyStatus === 'success' ? 'ID copied' : 'ID could not be copied';

  function handleRefresh() {
    setSelectedKey(undefined);
    setCopyStatus(undefined);
    void rest.refresh();
    void v2.refresh();
  }

  function handleDeleted(api: DeleteApiTarget) {
    flash.show([
      {
        type: 'success',
        content: (
          <>
            API <ValueText kind="name" value={api.name} /> deleted.
          </>
        ),
      },
    ]);
    setDeleteTarget(undefined);
    setSelectedKey(undefined);
    setCopyStatus(undefined);
  }

  async function handleCopyId() {
    if (selected === undefined) return;
    try {
      await navigator.clipboard.writeText(selected.id);
      setCopyStatus('success');
      announce('ID copied');
    } catch {
      setCopyStatus('error');
      announce('ID could not be copied');
    }
  }

  const columns: TableProps.ColumnDefinition<ApiRow>[] = [
    {
      id: 'name',
      header: 'Name',
      isRowHeader: true,
      minWidth: '28ch',
      cell: (api) => (
        <Link href={api.kind === 'REST' ? restApiPath(api.id) : v2ApiPath(api.id)} onFollow={handleFollow}>
          <ValueText kind="name" value={api.name} />
        </Link>
      ),
    },
    {
      id: 'id',
      header: 'ID',
      minWidth: 'calc(15ch + 24px)',
      cell: (api) => <ValueText kind="name" value={api.id} />,
    },
    { id: 'kind', header: 'Kind', cell: (api) => <ValueText kind="fixed" value={api.kind} /> },
    {
      id: 'description',
      header: 'Description',
      cell: (api) => <ValueText kind="text" value={api.description} none="-" />,
    },
    {
      id: 'created',
      header: 'Creation time',
      cell: (api) => <ValueText kind="fixed" value={creationDateText(api.createdDate)} />,
    },
    {
      id: 'endpoint',
      header: 'Endpoint type',
      cell: (api) => <ValueText kind="fixed" value={api.endpointTypes.map(endpointTypeText).join(', ')} none="-" />,
    },
  ];
  const failures = (
    <SpaceBetween size="s">
      <ListFailure list={rest} connection={connection} thing="REST API list" inTable={bothFailed} />
      <ListFailure list={v2} connection={connection} thing="HTTP and WebSocket API list" inTable={bothFailed} />
    </SpaceBetween>
  );
  const createApi = (primary = false) => (
    <Button variant={primary ? 'primary' : 'normal'} href={createApiPath} onFollow={handleFollow}>
      Create API
    </Button>
  );
  return (
    <SpaceBetween size="s">
      {announcement}
      {deleteTarget !== undefined && (
        <DeleteApiDialog
          api={deleteTarget}
          endpoint={connection.engineOrigin}
          onDeleted={handleDeleted}
          onDismiss={() => setDeleteTarget(undefined)}
        />
      )}
      <Header
        variant="h1"
        actions={
          <SpaceBetween direction="horizontal" size="xs">
            <Button iconName="refresh" onClick={handleRefresh}>
              Refresh
            </Button>
            <Button iconName="copy" disabled={selected === undefined} onClick={() => void handleCopyId()}>
              Copy ID
            </Button>
            <Button disabled={selected === undefined} onClick={() => setDeleteTarget(selected)}>
              Delete
            </Button>
            {createApi(true)}
          </SpaceBetween>
        }
      >
        {title}
      </Header>
      {copyStatus !== undefined && <StatusIndicator type={copyStatus}>{copyText}</StatusIndicator>}
      {bothFailed && failures}
      {!bothFailed && (
        <>
          {(rest.failure !== undefined || v2.failure !== undefined) && failures}
          <Table<ApiRow>
            ariaLabels={{
              tableLabel: title,
              selectionGroupLabel: 'API selection',
              itemSelectionLabel: (_, api) => `Select ${api.name} (${api.kind})`,
            }}
            items={rows}
            trackBy={apiRowKey}
            columnDefinitions={columns}
            selectionType="single"
            selectedItems={selected === undefined ? [] : [selected]}
            onSelectionChange={({ detail }) => {
              const item = detail.selectedItems[0];
              setSelectedKey(item === undefined ? undefined : apiRowKey(item));
              setCopyStatus(undefined);
            }}
            wrapLines
            loading={loading}
            loadingText="Loading APIs…"
            empty={
              bothRead ? (
                <Box textAlign="center">
                  <SpaceBetween size="xs">
                    <Box variant="strong">No APIs</Box>
                    <Box>The emulator holds no REST, HTTP or WebSocket API.</Box>
                    {createApi()}
                  </SpaceBetween>
                </Box>
              ) : null
            }
            footer={
              (rest.more || v2.more) && (
                <SpaceBetween size="xs" direction="horizontal">
                  {rest.more && (
                    <Button loading={rest.loading} onClick={rest.loadMore}>
                      Load more REST APIs
                    </Button>
                  )}
                  {v2.more && (
                    <Button loading={v2.loading} onClick={v2.loadMore}>
                      Load more HTTP and WebSocket APIs
                    </Button>
                  )}
                </SpaceBetween>
              )
            }
          />
        </>
      )}
    </SpaceBetween>
  );
}
