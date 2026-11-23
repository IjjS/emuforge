import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { requestFailure } from '../../../../../../lib/aws/request';
import { usePageFlash } from '../../../components/page-flash';
import { usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import { OPERATIONS, type ObjectBody, type ObjectVersion } from '../api';
import { keyName, NO_VALUE } from '../format';
import { useChangeObjectVersion, useDownloadObject, useObjectHistory } from '../queries';
import { NAME_COLUMN_MIN_WIDTH } from './name-column';
import { ObjectVersionsDialog, REMOVE_MARKER, RESTORE_VERSION, type VersionTarget } from './object-versions-dialog';
import { versionFailure } from './object-versions-failure';

const NARROW_HISTORY = '(max-width: 688px)';

function subscribeToLayout(onChange: () => void) {
  const query = window.matchMedia(NARROW_HISTORY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

function isNarrowHistory() {
  return window.matchMedia(NARROW_HISTORY).matches;
}

function versionType(row: ObjectVersion) {
  return row.kind === 'version' ? 'Version' : 'Delete marker';
}

function latestValue(row: ObjectVersion) {
  return row.latest ? 'Yes' : 'No';
}

function HistoryKey({ value }: { value: string }) {
  const controls = Array.from(value).flatMap((character, index) => {
    if (character !== '\r' && character !== '\n') return [];
    const position = `at character ${String(index + 1)}`;
    return [
      {
        cue: `${character === '\r' ? 'CR' : 'LF'} ${position}`,
        meaning: `${character === '\r' ? 'Carriage return' : 'Line feed'} ${position}`,
      },
    ];
  });

  return (
    <>
      <span style={{ whiteSpace: 'break-spaces' }}>
        <ValueText kind="name" value={value} />
      </span>
      {controls.length > 0 && (
        <Box
          variant="small"
          display="block"
          color="text-body-secondary"
          nativeAttributes={{
            role: 'note',
            'aria-label': controls.map(({ meaning }) => meaning).join(', '),
            style: { userSelect: 'none' },
          }}
        >
          {controls.map(({ cue }) => cue).join(' · ')}
        </Box>
      )}
    </>
  );
}

function describeHistoryKey(key: string) {
  return key
    .replaceAll('\\', ' \\\\ (literal backslash) ')
    .replaceAll('\r', ' \\r (carriage return) ')
    .replaceAll('\n', ' \\n (line feed) ');
}

function isNullBody(row: ObjectVersion) {
  return row.kind === 'version' && row.versionId === 'null';
}

function nullBodyETag(row: ObjectVersion) {
  return isNullBody(row) ? row.etag : undefined;
}

function VersionIdentifier({ row, showLabel = false }: { row: ObjectVersion; showLabel?: boolean }) {
  const etag = nullBodyETag(row);
  return (
    <>
      {showLabel && 'Version ID: '}
      <ValueText kind="name" value={row.versionId ?? NO_VALUE} />
      {etag !== undefined && (
        <Box variant="small" display="block" color="text-body-secondary">
          ETag: <ValueText kind="name" value={etag} />
        </Box>
      )}
    </>
  );
}

const columns: TableProps.ColumnDefinition<ObjectVersion>[] = [
  {
    id: 'key',
    header: 'Key',
    isRowHeader: true,
    minWidth: NAME_COLUMN_MIN_WIDTH,
    cell: (row) => <HistoryKey value={row.key} />,
  },
  {
    id: 'version-id',
    header: 'Version ID',
    cell: (row) => <VersionIdentifier row={row} />,
  },
  { id: 'type', header: 'Type', cell: versionType },
  { id: 'latest', header: 'Latest', cell: latestValue },
];

const narrowColumns: TableProps.ColumnDefinition<ObjectVersion>[] = [
  {
    id: 'key',
    header: 'Key',
    isRowHeader: true,
    cell: (row) => (
      <SpaceBetween size="xxs">
        <HistoryKey value={row.key} />
        <Box variant="small">
          Type: {versionType(row)} · Latest: {latestValue(row)}
        </Box>
        <Box variant="small">
          <VersionIdentifier row={row} showLabel />
        </Box>
      </SpaceBetween>
    ),
  },
];

function rowId(row: ObjectVersion): string {
  return JSON.stringify([row.key, row.versionId, row.kind, nullBodyETag(row)]);
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
  const narrow = useSyncExternalStore(subscribeToLayout, isNarrowHistory);
  const listing = useObjectHistory(endpoint, name, prefix);
  const download = useDownloadObject(endpoint, name);
  const change = useChangeObjectVersion(endpoint, name);
  const flash = usePageFlash();
  const getSignal = usePageSignal();
  const [selection, setSelection] = useState<{ view: string; id: string }>();
  const [unavailable, setUnavailable] = useState<{ view: string; ids: ReadonlySet<string> }>();
  const [changing, setChanging] = useState<VersionTarget>();
  const [pending, setPending] = useState<string>();
  const active = useRef(false);
  const [unsupported, setUnsupported] = useState<ReadonlySet<string>>(() => new Set());
  const refreshButton = useRef<ButtonProps.Ref>(null);
  const restoreButton = useRef<ButtonProps.Ref>(null);
  const removeButton = useRef<ButtonProps.Ref>(null);
  const closingAction = useRef<ObjectVersion['kind'] | undefined>(undefined);

  useEffect(() => {
    if (changing !== undefined || closingAction.current === undefined) return;
    const opener = closingAction.current === 'version' ? restoreButton : removeButton;
    closingAction.current = undefined;
    // The modal releases focus on close. A history refresh may also have removed the opener.
    const frame = requestAnimationFrame(() => (opener.current ?? refreshButton.current)?.focus());
    return () => cancelAnimationFrame(frame);
  }, [changing]);

  const page = listing.answer;
  const items = listing.failure !== undefined ? [] : (page?.items ?? []);
  const selected = selection?.view === listing.view ? items.find((row) => rowId(row) === selection.id) : undefined;
  const target: VersionTarget | undefined =
    selected?.versionId === undefined ? undefined : { ...selected, versionId: selected.versionId };
  const bodyUnavailable =
    target !== undefined && unavailable?.view === listing.view && unavailable.ids.has(rowId(target));
  const unavailableReason = bodyUnavailable
    ? 'The emulator could not address this body. Refresh the version history and reselect the version.'
    : undefined;

  function closeDialog() {
    closingAction.current = changing?.kind;
    setChanging(undefined);
  }

  async function run(
    operation: string,
    label: string,
    requested: VersionTarget,
    action: (signal: AbortSignal) => Promise<void>,
  ) {
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
      const changedBody = isNullBody(requested) && failure.kind === 'other' && failure.code === 'PreconditionFailed';
      if (changedBody) {
        const listingView = listing.view;
        setUnavailable((current) => ({
          view: listingView,
          ids: new Set([...(current?.view === listingView ? current.ids : []), rowId(requested)]),
        }));
      }
      const refreshNeeded = changedBody || (failure.kind === 'other' && failure.code === 'UnverifiedVersionBody');
      flash.show([
        {
          type: view.type,
          header: view.header,
          content: (
            <>
              {view.detail}
              {refreshNeeded && (
                <Box variant="p">
                  {changedBody && 'The null version points to a different body than the one you selected. '}
                  Refresh the version history and reselect the version.
                </Box>
              )}
            </>
          ),
        },
      ]);
    } finally {
      if (!signal.aborted) {
        active.current = false;
        setPending(undefined);
        closeDialog();
      }
    }
  }

  function handleDownload() {
    if (target?.kind !== 'version' || bodyUnavailable) return;
    void run(OPERATIONS.getObject, 'Download', target, async (signal) => {
      const body = await download(target.key, signal, target.versionId, target.etag);
      if (!signal.aborted) saveVersion(body, target.key);
    });
  }

  function handleConfirm() {
    if (changing === undefined) return;
    const restores = changing.kind === 'version';
    const operation = restores ? OPERATIONS.copyObject : OPERATIONS.deleteObject;
    void run(operation, restores ? RESTORE_VERSION : REMOVE_MARKER, changing, async (signal) => {
      await change(changing, signal);
      if (signal.aborted) return;
      listing.refresh();
      onChanged();
      flash.show([{ type: 'success', content: restores ? 'Version restored.' : 'Delete marker removed.' }]);
    });
  }

  const failure =
    listing.failure === undefined ? undefined : versionFailure(listing.failure, 'Reading versions', endpoint);
  const disabledReason = (operation: string, allowed: boolean, hint = 'Select a matching version first') =>
    unsupported.has(operation) ? 'Not implemented by the emulator' : allowed ? undefined : hint;

  return (
    <>
      <Table<ObjectVersion>
        items={items}
        trackBy={rowId}
        columnDefinitions={narrow ? narrowColumns : columns}
        selectionType="single"
        selectedItems={selected === undefined ? [] : [selected]}
        onSelectionChange={({ detail }) => {
          const row = detail.selectedItems[0];
          setSelection(row === undefined ? undefined : { view: listing.view, id: rowId(row) });
        }}
        ariaLabels={{
          selectionGroupLabel: 'Version selection',
          itemSelectionLabel: (_, row) => {
            const etag = nullBodyETag(row);
            return (
              `Select ${describeHistoryKey(row.key)} version ${row.versionId ?? NO_VALUE}, Type: ${versionType(row)}, Latest: ${latestValue(row)}` +
              (etag === undefined ? '' : `, ETag: ${etag}`)
            );
          },
        }}
        wrapLines
        loading={listing.loading}
        loadingText="Loading versions"
        empty={
          <Box textAlign="center" color="inherit">
            {failure === undefined ? (
              <SpaceBetween size="xxs">
                <Box variant="strong">No versions found</Box>
                <Box variant="p" color="inherit">
                  {prefix === '' ? (
                    'This listing covers all keys'
                  ) : (
                    <>
                      This listing covers keys that start with <ValueText kind="name" value={prefix} />
                    </>
                  )}{' '}
                  in bucket <ValueText kind="name" value={name} />.
                </Box>
              </SpaceBetween>
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
                <Button
                  ref={refreshButton}
                  iconName="refresh"
                  disabled={pending !== undefined}
                  onClick={listing.refresh}
                >
                  Refresh
                </Button>
                {selected?.kind === 'delete-marker' ? (
                  <Button
                    ref={removeButton}
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
                      disabled={
                        target === undefined ||
                        bodyUnavailable ||
                        pending !== undefined ||
                        unsupported.has(OPERATIONS.getObject)
                      }
                      disabledReason={unavailableReason ?? disabledReason(OPERATIONS.getObject, target !== undefined)}
                      onClick={handleDownload}
                    >
                      Download
                    </Button>
                    <Button
                      ref={restoreButton}
                      disabled={
                        target === undefined ||
                        bodyUnavailable ||
                        selected?.latest !== false ||
                        pending !== undefined ||
                        unsupported.has(OPERATIONS.copyObject)
                      }
                      disabledReason={
                        unavailableReason ??
                        disabledReason(
                          OPERATIONS.copyObject,
                          target !== undefined && selected?.latest === false,
                          'Select an earlier object version to restore.',
                        )
                      }
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
            if (!active.current) closeDialog();
          }}
          onConfirm={handleConfirm}
        />
      )}
    </>
  );
}
