import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FileUpload from '@cloudscape-design/components/file-upload';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input from '@cloudscape-design/components/input';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useLayoutEffect, useRef, useState } from 'react';

import {
  bindAwsMutationAuthorization,
  refusalMessage,
  reportedNotImplementedMessage,
  reportedServiceCode,
  requestFailure,
  type RequestFailure,
} from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { DiscardDialog } from '../../../components/discard-dialog';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { ValueText } from '../../../components/value-text';
import { LIST_LAYERS, PUBLISH_LAYER_VERSION, type LayerSummary, type LayerVersion } from '../layer-api';
import { useLayerListing, useLayerVersions, usePublishLayerVersion, type LayerReading } from '../layer-queries';

export const LAYERS_TITLE = 'Layers';
const PUBLISH = 'Publish layer version';
const UNAVAILABLE = 'Not implemented by the emulator';

const LAYER_COLUMNS: TableProps.ColumnDefinition<LayerSummary>[] = [
  {
    id: 'name',
    header: 'Layer name',
    isRowHeader: true,
    minWidth: '28ch',
    cell: ({ name }) => (
      // A short name contributes its full width, including names with wider glyphs.
      <span style={name.length <= 24 ? { display: 'inline-block', minWidth: 'max-content' } : undefined}>
        <ValueText kind="name" value={name} />
      </span>
    ),
  },
  {
    id: 'latestVersion',
    header: 'Latest version',
    minWidth: '16ch',
    cell: ({ latestVersion }) => <ValueText kind="fixed" value={latestVersion?.toString()} none="-" />,
  },
];

const VERSION_COLUMNS: TableProps.ColumnDefinition<LayerVersion>[] = [
  { id: 'version', header: 'Version', isRowHeader: true, cell: ({ version }) => String(version) },
  { id: 'arn', header: 'Version ARN', cell: ({ arn }) => <ValueText kind="address" value={arn} /> },
];

function failureItem(failure: RequestFailure, header: string, connection: AreaConnection, resource: string): FlashItem {
  if (failure.kind === 'not-implemented') {
    const message = reportedNotImplementedMessage(failure);
    return {
      type: 'info',
      header: UNAVAILABLE,
      content: `The emulator answered 501 Not Implemented for ${failure.operation}.${message ? ` ${message}` : ''}`,
    };
  }
  const statusOrCode =
    failure.kind === 'other' ? (failure.code.match(/^HTTP \d{3}\b/)?.[0] ?? failure.code) : undefined;
  const code = reportedServiceCode(failure) ?? statusOrCode;
  if (code === undefined) {
    const state = readFailureState(failure, connection, resource);
    return {
      type: 'error',
      header,
      content: (
        <SpaceBetween size="xxs">
          {state.first}
          {state.detail}
        </SpaceBetween>
      ),
    };
  }
  const message = refusalMessage(failure);
  return {
    type: 'error',
    header,
    content: <ValueText kind="text" value={`${failure.operation} returned ${code}.${message ? ` ${message}` : ''}`} />,
  };
}

function ReadFailure({
  failure,
  resource,
  connection,
  refresh,
}: {
  failure: RequestFailure;
  resource: 'layers' | 'layer versions';
  connection: AreaConnection;
  refresh: () => void;
}) {
  const item = failureItem(failure, `Could not load ${resource}.`, connection, resource);
  return (
    <Alert
      type={item.type}
      header={item.header}
      action={
        <Button
          onClick={refresh}
          disabled={failure.kind === 'not-implemented' || connection.engineOrigin === undefined}
        >
          Retry
        </Button>
      }
    >
      {item.content}
    </Alert>
  );
}

function LayerPagination<T>({ reading, label }: { reading: LayerReading<T>; label: string }) {
  if (reading.pageCount <= 1) return null;
  return (
    <Pagination
      currentPageIndex={reading.pageIndex}
      pagesCount={reading.pageCount}
      disabled={reading.loading || reading.failure?.kind === 'not-implemented'}
      ariaLabels={{
        paginationLabel: label,
        nextPageLabel: 'Next page',
        previousPageLabel: 'Previous page',
        pageLabel: (page) => `Page ${String(page)}`,
      }}
      onChange={({ detail }) => reading.changePage(detail.currentPageIndex)}
    />
  );
}

export function LayersPage({ connection }: { connection: AreaConnection }) {
  useShowsResources('layers');
  const { engineOrigin, result } = connection;
  const scope = JSON.stringify([
    engineOrigin,
    result?.kind,
    result?.kind === 'connected' ? [result.emulator.endpoint, result.target] : undefined,
  ]);
  return <LayerWorkspace key={scope} connection={connection} scope={scope} />;
}

function LayerWorkspace({ connection, scope }: { connection: AreaConnection; scope: string }) {
  const connected = connection.result?.kind === 'connected';
  const endpoint = connection.engineOrigin;
  const options = { endpoint, scope };
  const [selected, setSelected] = useState<string>();
  const [publishOpen, setPublishOpen] = useState(false);
  const [publishUnavailable, setPublishUnavailable] = useState(false);
  const layers = useLayerListing(options);
  const versions = useLayerVersions(options, selected);
  const flash = usePageFlash();
  const listingFailure =
    layers.failure ??
    (endpoint === undefined && connection.result !== undefined
      ? { kind: 'engine-did-not-answer' as const, operation: LIST_LAYERS }
      : undefined);
  const canPublish = connected && endpoint !== undefined && !publishUnavailable;

  function handleRefresh() {
    layers.refresh();
    versions.refresh();
  }

  return (
    <SpaceBetween size="l">
      <Table
        items={layers.items ?? []}
        trackBy="name"
        columnDefinitions={LAYER_COLUMNS}
        wrapLines
        ariaLabels={{
          tableLabel: LAYERS_TITLE,
          selectionGroupLabel: 'Layer selection',
          itemSelectionLabel: (_, item) => item.name,
        }}
        selectionType="single"
        selectedItems={(layers.items ?? []).filter(({ name }) => name === selected)}
        onSelectionChange={({ detail }) => setSelected(detail.selectedItems[0]?.name)}
        loading={layers.loading || (endpoint === undefined && connection.result === undefined)}
        loadingText="Loading layers…"
        pagination={<LayerPagination reading={layers} label="Layers pagination" />}
        empty={
          listingFailure === undefined ? (
            <Box textAlign="center">
              <Box variant="strong">No layers</Box>
              <Box variant="p" color="text-body-secondary">
                Publish a ZIP file to create your first layer.
              </Box>
            </Box>
          ) : (
            <ReadFailure failure={listingFailure} resource="layers" connection={connection} refresh={layers.refresh} />
          )
        }
        header={
          <Header
            variant="h1"
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  iconName="refresh"
                  ariaLabel="Refresh"
                  disabled={layers.loading || listingFailure !== undefined}
                  onClick={handleRefresh}
                />
                <Button variant="primary" disabled={!canPublish} onClick={() => setPublishOpen(true)}>
                  {PUBLISH}
                </Button>
              </SpaceBetween>
            }
          >
            {LAYERS_TITLE}
          </Header>
        }
      />
      {selected !== undefined && (
        <Table
          items={versions.items ?? []}
          trackBy="arn"
          columnDefinitions={VERSION_COLUMNS}
          wrapLines
          ariaLabels={{ tableLabel: 'Versions' }}
          loading={versions.loading}
          loadingText="Loading layer versions…"
          pagination={<LayerPagination reading={versions} label="Versions pagination" />}
          empty={
            versions.failure === undefined ? (
              <Box textAlign="center">No versions</Box>
            ) : (
              <ReadFailure
                failure={versions.failure}
                resource="layer versions"
                connection={connection}
                refresh={versions.refresh}
              />
            )
          }
          header={<Header description={<ValueText kind="name" value={selected} />}>Versions</Header>}
        />
      )}
      {publishOpen && (
        <PublishDialog
          connection={connection}
          scope={scope}
          onClose={() => setPublishOpen(false)}
          onSuccess={({ name, version }) => {
            setPublishOpen(false);
            setSelected(name);
            versions.changePage(1);
            flash.show([{ type: 'success', content: `Published ${name} version ${String(version)}.` }]);
          }}
          onFailure={(failure) => {
            const item = failureItem(failure, 'Could not publish layer version.', connection, 'layer version');
            flash.show([item]);
            if (failure.kind === 'not-implemented') {
              setPublishUnavailable(true);
              setPublishOpen(false);
            }
            return item;
          }}
        />
      )}
    </SpaceBetween>
  );
}

function PublishDialog({
  connection,
  scope,
  onClose,
  onSuccess,
  onFailure,
}: {
  connection: AreaConnection;
  scope: string;
  onClose: () => void;
  onSuccess: (result: { name: string; version: number }) => void;
  onFailure: (failure: RequestFailure) => FlashItem;
}) {
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string>();
  const [failure, setFailure] = useState<FlashItem>();
  const [asking, setAsking] = useState(false);
  const [reading, setReading] = useState(false);
  const active = useRef<AbortController>(undefined);
  const file = files[0];
  const publish = usePublishLayerVersion({ endpoint: connection.engineOrigin, scope });
  const busy = reading || publish.isPending;
  useLayoutEffect(() => () => active.current?.abort(), []);

  function handleDismiss() {
    if (busy) return;
    if (name !== '' || file !== undefined) setAsking(true);
    else onClose();
  }

  async function handlePublish() {
    if (name.trim() === '' || file === undefined || active.current !== undefined || !navigator.onLine) return;

    const controller = new AbortController();
    active.current = controller;
    const dispose = bindAwsMutationAuthorization(controller, { cancelInFlight: true });
    setReading(true);
    setFailure(undefined);
    setFileError(undefined);
    try {
      let zip: Uint8Array;
      try {
        zip = new Uint8Array(await file.arrayBuffer());
      } catch {
        if (!controller.signal.aborted) setFileError('Could not read the ZIP file. Choose the file again.');
        return;
      }
      if (controller.signal.aborted) return;
      const result = await publish.mutateAsync({ name, zip, signal: controller.signal });
      if (!controller.signal.aborted) onSuccess(result);
    } catch (error) {
      if (!controller.signal.aborted) setFailure(onFailure(requestFailure(PUBLISH_LAYER_VERSION, error)));
    } finally {
      dispose();
      active.current = undefined;
      setReading(false);
    }
  }

  return (
    <>
      <AreaModal
        visible
        header={PUBLISH}
        closeAriaLabel="Close"
        onDismiss={handleDismiss}
        footer={
          <Box float="right">
            <SpaceBetween size="xs" direction="horizontal">
              <Button variant="link" disabled={busy} onClick={handleDismiss}>
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={name.trim() === '' || file === undefined || busy}
                loading={busy}
                onClick={() => {
                  void handlePublish();
                }}
              >
                {PUBLISH}
              </Button>
            </SpaceBetween>
          </Box>
        }
      >
        <SpaceBetween size="m">
          {failure !== undefined && (
            <Alert type={failure.type} header={failure.header}>
              {failure.content}
            </Alert>
          )}
          <FormField label="Layer name" description="Reuse an existing layer name to publish a new version.">
            <Input value={name} onChange={({ detail }) => setName(detail.value)} disabled={busy} />
          </FormField>
          <FormField label="ZIP file" errorText={fileError}>
            <fieldset disabled={busy} style={{ border: 0, margin: 0, padding: 0, minInlineSize: 0 }}>
              <FileUpload
                accept=".zip"
                value={files}
                onChange={({ detail }) => {
                  setFiles(detail.value.slice(-1));
                  setFileError(undefined);
                }}
                i18nStrings={{
                  uploadButtonText: () => 'Choose file',
                  dropzoneText: () => 'Drop a .zip file to choose it',
                  removeFileAriaLabel: () => 'Remove file',
                  limitShowFewer: 'Show fewer files',
                  limitShowMore: 'Show more files',
                  errorIconAriaLabel: 'Error',
                  warningIconAriaLabel: 'Warning',
                }}
              />
            </fieldset>
          </FormField>
        </SpaceBetween>
      </AreaModal>
      {asking && (
        <DiscardDialog
          visible
          onAnswer={(answer) => {
            setAsking(false);
            if (answer === 'discard') onClose();
          }}
        />
      )}
    </>
  );
}
