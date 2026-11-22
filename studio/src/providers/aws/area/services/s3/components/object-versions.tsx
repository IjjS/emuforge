import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useRef, useState } from 'react';

import { requestFailure } from '../../../../../../lib/aws/request';
import { usePageFlash } from '../../../components/page-flash';
import { usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { NO_SUCH_BUCKET, OPERATIONS, type ObjectBody, type ObjectVersion } from '../api';
import { keyName, NO_VALUE } from '../format';
import { useChangeObjectVersion, useDownloadObject, useObjectHistory } from '../queries';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';
import { ObjectVersionsDialog, REMOVE_MARKER, RESTORE_VERSION, type VersionTarget } from './object-versions-dialog';
import { versionFailure } from './object-versions-failure';
import { ObjectsBucketGone } from './objects-states';

const columns: TableProps.ColumnDefinition<ObjectVersion>[] = [
  {
    id: 'key',
    header: 'Key',
    isRowHeader: true,
    minWidth: NAME_COLUMN_MIN_WIDTH,
    cell: (row) => <ValueText kind="name" value={row.key} />,
  },
  {
    id: 'version-id',
    header: 'Version ID',
    cell: (row) => <ValueText kind="name" value={row.versionId ?? NO_VALUE} />,
  },
  { id: 'type', header: 'Type', cell: (row) => (row.kind === 'version' ? 'Version' : 'Delete marker') },
  { id: 'latest', header: 'Latest', cell: (row) => (row.latest ? 'Yes' : 'No') },
];

function rowId(row: ObjectVersion): string {
  return JSON.stringify([row.key, row.versionId, row.kind]);
}

function saveVersion({ bytes, contentType }: ObjectBody, key: string) {
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], contentType === undefined ? {} : { type: contentType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = keyName(key);
  anchor.rel = 'noopener';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

interface ObjectVersionsProps {
  name: string;
  prefix: string;
  endpoint: string | undefined;
  onChanged: () => void;
}

export function ObjectVersions({ name, prefix, endpoint, onChanged }: ObjectVersionsProps) {
  const listing = useObjectHistory(endpoint, name, prefix);
  const download = useDownloadObject(endpoint, name);
  const change = useChangeObjectVersion(endpoint, name);
  const flash = usePageFlash();
  const getSignal = usePageSignal();
  const [selection, setSelection] = useState<{ view: string; id: string }>();
  const [changing, setChanging] = useState<VersionTarget>();
  const [pending, setPending] = useState<string>();
  const active = useRef(false);
  const [unsupported, setUnsupported] = useState<ReadonlySet<string>>(() => new Set());

  const page = listing.answer;
  const items = page === NO_SUCH_BUCKET || listing.failure !== undefined ? [] : (page?.items ?? []);
  const selected = selection?.view === listing.view ? items.find((row) => rowId(row) === selection.id) : undefined;
  const target: VersionTarget | undefined =
    selected?.versionId === undefined ? undefined : { ...selected, versionId: selected.versionId };

  async function run(operation: string, label: string, action: (signal: AbortSignal) => Promise<void>) {
    if (active.current) return;
    const signal = getSignal();
    active.current = true;
    setPending(operation);
    try {
      await action(signal);
    } catch (error) {
      if (signal.aborted) return;
      const failure = requestFailure(operation, error);
      if (failure.kind === 'not-implemented') {
        setUnsupported((current) => new Set([...current, operation]));
      }
      const view = versionFailure(failure, label, endpoint);
      flash.show([{ type: view.type, header: view.header, content: view.detail }]);
    } finally {
      if (!signal.aborted) {
        active.current = false;
        setPending(undefined);
        setChanging(undefined);
      }
    }
  }

  function handleDownload() {
    if (target?.kind !== 'version') return;
    void run(OPERATIONS.getObject, 'Download', async (signal) => {
      const body = await download(target.key, signal, target.versionId);
      if (!signal.aborted) saveVersion(body, target.key);
    });
  }

  function handleConfirm() {
    if (changing === undefined) return;
    const restores = changing.kind === 'version';
    const operation = restores ? OPERATIONS.copyObject : OPERATIONS.deleteObject;
    void run(operation, restores ? RESTORE_VERSION : REMOVE_MARKER, async (signal) => {
      await change(changing.kind, changing.key, changing.versionId, signal);
      if (signal.aborted) return;
      listing.refresh();
      onChanged();
      flash.show([{ type: 'success', content: restores ? 'Version restored.' : 'Delete marker removed.' }]);
    });
  }

  if (page === NO_SUCH_BUCKET) return <ObjectsBucketGone name={name} />;

  const failure =
    listing.failure === undefined ? undefined : versionFailure(listing.failure, 'Reading versions', endpoint);
  const disabledReason = (operation: string, allowed: boolean) =>
    unsupported.has(operation)
      ? 'Not implemented by the emulator'
      : allowed
        ? undefined
        : 'Select a matching version first';

  return (
    <>
      <Table<ObjectVersion>
        items={items}
        trackBy={rowId}
        columnDefinitions={columns}
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          const row = detail.selectedItems[0];
          setSelection(row === undefined ? undefined : { view: listing.view, id: rowId(row) });
        }}
        ariaLabels={{
          selectionGroupLabel: 'Version selection',
          itemSelectionLabel: (_, row) => `Select ${row.key} version ${row.versionId ?? NO_VALUE}`,
        }}
        wrapLines
        loading={listing.loading}
        loadingText="Loading versions"
        empty={
          <Box textAlign="center" color="inherit">
            {failure === undefined ? (
              <Box variant="strong">No versions found</Box>
            ) : (
              <SpaceBetween size="xs">
                <StatusIndicator type={failure.type}>{failure.header}</StatusIndicator>
                {failure.detail}
                <Button onClick={() => listing.goToPage(listing.currentPage)}>Retry</Button>
              </SpaceBetween>
            )}
          </Box>
        }
        header={
          <Header
            variant="h2"
            actions={
              <SpaceBetween direction="horizontal" size="xs" alignItems="center">
                <Button iconName="refresh" disabled={pending !== undefined} onClick={listing.refresh}>
                  Refresh
                </Button>
                {selected?.kind === 'delete-marker' ? (
                  <Button
                    disabled={target === undefined || pending !== undefined || unsupported.has(OPERATIONS.deleteObject)}
                    disabledReason={disabledReason(OPERATIONS.deleteObject, target !== undefined)}
                    onClick={() => setChanging(target)}
                  >
                    {REMOVE_MARKER}
                  </Button>
                ) : (
                  <>
                    <Button
                      iconName="download"
                      loading={pending === OPERATIONS.getObject}
                      disabled={target === undefined || pending !== undefined || unsupported.has(OPERATIONS.getObject)}
                      disabledReason={disabledReason(OPERATIONS.getObject, target !== undefined)}
                      onClick={handleDownload}
                    >
                      Download
                    </Button>
                    <Button
                      disabled={
                        target === undefined ||
                        selected?.latest !== false ||
                        pending !== undefined ||
                        unsupported.has(OPERATIONS.copyObject)
                      }
                      disabledReason={disabledReason(
                        OPERATIONS.copyObject,
                        target !== undefined && selected?.latest === false,
                      )}
                      onClick={() => setChanging(target)}
                    >
                      {RESTORE_VERSION}
                    </Button>
                  </>
                )}
              </SpaceBetween>
            }
          >
            Object versions
          </Header>
        }
        pagination={
          <Pagination
            currentPageIndex={listing.currentPage}
            pagesCount={listing.pagesCount}
            openEnd={listing.openEnd}
            disabled={listing.loading || pending !== undefined}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (number) => `Page ${String(number)}`,
            }}
            onChange={({ detail }) => listing.goToPage(detail.currentPageIndex)}
          />
        }
      />
      {changing !== undefined && (
        <ObjectVersionsDialog
          endpoint={endpoint}
          bucket={name}
          target={changing}
          pending={pending !== undefined}
          onCancel={() => {
            if (!active.current) setChanging(undefined);
          }}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
