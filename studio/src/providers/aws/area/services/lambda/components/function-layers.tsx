import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useEffect, useState } from 'react';

import {
  refusalMessage,
  reportedNotImplementedMessage,
  reportedServiceCode,
  type RequestFailure,
} from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import type { AreaConnection } from '../../../components/emulator-line';
import { readFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import { NOT_READY } from '../configuration-form';
import { useLayerListing, useLayerVersions, type LayerReading } from '../layer-queries';
import type { useFunctionLayersReading } from '../queries';

const ADD = 'Add layer version';
const REMOVE = 'Remove layer version';
const LOADING = 'Loading attached layers…';
const UNSUPPORTED = 'Not implemented by the emulator';

type LayerChange = { kind: 'add'; arn: string } | { kind: 'remove'; index: number };

type PickerOperation = 'listing' | 'versions';
type UnsupportedPickerRead = Extract<RequestFailure, { kind: 'not-implemented' }>;
export type LayerPickerRefusals = Partial<Record<PickerOperation, UnsupportedPickerRead>>;

export interface FunctionLayerChanges {
  scope: string;
  reading: ReturnType<typeof useFunctionLayersReading>;
  pending: boolean;
  unsupported: boolean;
  pickerRefusals: LayerPickerRefusals;
  rememberPickerRefusal: (operation: PickerOperation, failure: UnsupportedPickerRead) => void;
  submit: (kind: LayerChange['kind'], layers: readonly string[]) => Promise<void>;
}

export function LayerFailureDetail({ failure, connection }: { failure: RequestFailure; connection: AreaConnection }) {
  if (failure.kind === 'not-implemented') {
    const message = reportedNotImplementedMessage(failure);
    return (
      <>
        The emulator answered 501 Not Implemented for {failure.operation}.{message ? ` ${message}` : ''}
      </>
    );
  }
  const statusOrCode =
    failure.kind === 'other' ? (failure.code.match(/^HTTP \d{3}\b/)?.[0] ?? failure.code) : undefined;
  const code = reportedServiceCode(failure) ?? statusOrCode;
  if (code === undefined) {
    const state = readFailureState(failure, connection, 'layers');
    return (
      <SpaceBetween size="xxs">
        {state.first}
        {state.detail}
      </SpaceBetween>
    );
  }
  const message = refusalMessage(failure);
  return <ValueText kind="text" value={`${failure.operation} returned ${code}.${message ? ` ${message}` : ''}`} />;
}

function LayerReadFailure({
  failure,
  connection,
  resource,
  retry,
}: {
  failure: RequestFailure;
  connection: AreaConnection;
  resource: string;
  retry: () => void;
}) {
  const unsupported = failure.kind === 'not-implemented';
  return (
    <Alert
      type={unsupported ? 'info' : 'error'}
      header={unsupported ? UNSUPPORTED : `Could not load ${resource}.`}
      action={
        <Button disabled={unsupported} onClick={retry}>
          Retry
        </Button>
      }
    >
      <LayerFailureDetail failure={failure} connection={connection} />
    </Alert>
  );
}

function LayerSelect<T>({
  label,
  resource,
  connection,
  reading,
  selection,
  placeholder = `Choose a ${label.toLowerCase()}`,
  options,
  disabled,
  onSelect,
}: {
  label: string;
  resource: string;
  connection: AreaConnection;
  reading: LayerReading<T>;
  selection: SelectProps.Option | null;
  placeholder?: string;
  options: SelectProps.Options;
  disabled: boolean;
  onSelect: (option: SelectProps.Option) => void;
}) {
  return (
    <SpaceBetween size="xs">
      <FormField label={label}>
        <Select
          selectedOption={selection}
          options={options}
          disabled={disabled || reading.loading || reading.failure !== undefined || !options.length}
          statusType={reading.loading ? 'loading' : 'finished'}
          loadingText={`Loading ${resource}…`}
          placeholder={placeholder}
          empty={`No ${resource}`}
          onChange={({ detail }) => onSelect(detail.selectedOption)}
        />
      </FormField>
      {reading.loading && <StatusIndicator type="loading">Loading {resource}…</StatusIndicator>}
      {reading.items?.length === 0 && !reading.loading && <Box>No {resource}</Box>}
      {reading.failure && (
        <LayerReadFailure
          failure={reading.failure}
          connection={connection}
          resource={resource}
          retry={reading.refresh}
        />
      )}
      {reading.pageCount > 1 && (
        <Pagination
          currentPageIndex={reading.pageIndex}
          pagesCount={reading.pageCount}
          disabled={disabled || reading.loading || reading.failure?.kind === 'not-implemented'}
          ariaLabels={{
            paginationLabel: `${label} pages`,
            nextPageLabel: 'Next page',
            previousPageLabel: 'Previous page',
            pageLabel: (page) => `Page ${page}`,
          }}
          onChange={({ detail }) => reading.changePage(detail.currentPageIndex)}
        />
      )}
    </SpaceBetween>
  );
}

function AddLayerDialog({
  connection,
  scope,
  pickerRefusals,
  rememberPickerRefusal,
  disabled,
  pending,
  onClose,
  onAdd,
}: {
  connection: AreaConnection;
  scope: string;
  pickerRefusals: FunctionLayerChanges['pickerRefusals'];
  rememberPickerRefusal: FunctionLayerChanges['rememberPickerRefusal'];
  disabled: boolean;
  pending: boolean;
  onClose: () => void;
  onAdd: (arn: string) => Promise<void>;
}) {
  const [layer, setLayer] = useState<SelectProps.Option | null>(null);
  const [version, setVersion] = useState<SelectProps.Option | null>(null);
  const listing = useLayerListing({ endpoint: pickerRefusals.listing ? undefined : connection.engineOrigin, scope });
  const versionList = useLayerVersions(
    { endpoint: pickerRefusals.versions ? undefined : connection.engineOrigin, scope },
    layer?.value,
  );
  const { failure: listingFailure } = listing;
  const { failure: versionsFailure } = versionList;
  useEffect(() => {
    if (listingFailure?.kind === 'not-implemented') rememberPickerRefusal('listing', listingFailure);
    if (versionsFailure?.kind === 'not-implemented') rememberPickerRefusal('versions', versionsFailure);
  }, [listingFailure, versionsFailure, rememberPickerRefusal]);

  const layers = { ...listing, failure: pickerRefusals.listing ?? listingFailure };
  const versions = {
    ...versionList,
    failure: layer === null ? undefined : (pickerRefusals.versions ?? versionsFailure),
  };
  const versionArn = version?.value;
  const canAdd =
    !disabled &&
    !pending &&
    !layers.loading &&
    !versions.loading &&
    layers.failure === undefined &&
    versions.failure === undefined &&
    versionArn !== undefined;

  return (
    <AreaModal
      visible
      header={ADD}
      closeAriaLabel="Close"
      onDismiss={() => {
        if (!pending) onClose();
      }}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!canAdd}
              loading={pending}
              onClick={() => {
                if (canAdd) void onAdd(versionArn).then(onClose);
              }}
            >
              {ADD}
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        <LayerSelect
          label="Layer name"
          resource="layers"
          connection={connection}
          reading={layers}
          selection={layer}
          options={layers.items?.map(({ name }) => ({ label: name, value: name })) ?? []}
          disabled={pending}
          onSelect={(option) => {
            setLayer(option);
            setVersion(null);
          }}
        />
        <LayerSelect
          label="Version"
          resource="layer versions"
          connection={connection}
          reading={versions}
          selection={version}
          placeholder={layer === null ? 'Select a layer first' : 'Choose a version'}
          options={
            versions.items?.map(({ arn, version }) => ({ label: String(version), value: arn, description: arn })) ?? []
          }
          disabled={pending}
          onSelect={setVersion}
        />
      </SpaceBetween>
    </AreaModal>
  );
}

export function FunctionLayers({
  connection,
  ready,
  changes,
}: {
  connection: AreaConnection;
  ready: boolean;
  changes?: FunctionLayerChanges | undefined;
}) {
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<{ arn: string; index: number }>();
  const { layers, loading, failure, refresh } = changes?.reading ?? {};
  const pending = changes?.pending === true;
  const disabled = !ready || layers === undefined || changes?.unsupported === true;
  const disabledReason = changes?.unsupported ? UNSUPPORTED : !ready ? NOT_READY : undefined;
  const items = layers?.map((arn, index) => ({ arn, index })) ?? [];
  const removalMatches = removing !== undefined && layers?.[removing.index] === removing.arn;

  async function submit(change: LayerChange) {
    if (changes === undefined || layers === undefined || disabled || pending) return;
    const next = change.kind === 'add' ? [...layers, change.arn] : layers.filter((_, index) => index !== change.index);
    await changes.submit(change.kind, next);
  }

  return (
    <>
      <Table
        header={
          <Header
            variant="h2"
            actions={
              <Button disabled={disabled || pending} disabledReason={disabledReason} onClick={() => setAdding(true)}>
                {ADD}
              </Button>
            }
          >
            Layers
          </Header>
        }
        variant="container"
        ariaLabels={{ tableLabel: 'Layers' }}
        items={items}
        loading={loading === true}
        loadingText={LOADING}
        trackBy={({ index }) => String(index)}
        columnDefinitions={[
          {
            id: 'arn',
            header: 'Version ARN',
            isRowHeader: true,
            cell: ({ arn }) => <ValueText kind="address" value={arn} />,
          },
          {
            id: 'remove',
            header: 'Actions',
            minWidth: '9rem',
            cell: ({ arn, index }) => (
              <Button
                ariaLabel={`${REMOVE} ${arn}`}
                wrapText={false}
                disabled={disabled || pending}
                disabledReason={disabledReason}
                onClick={() => setRemoving({ arn, index })}
              >
                Remove
              </Button>
            ),
          },
        ]}
        empty={
          failure && refresh ? (
            <LayerReadFailure failure={failure} connection={connection} resource="attached layers" retry={refresh} />
          ) : layers === undefined ? (
            <Box textAlign="center">
              <StatusIndicator type="loading">{LOADING}</StatusIndicator>
            </Box>
          ) : (
            <Box textAlign="center" variant="strong">
              No layers attached
            </Box>
          )
        }
      />
      {adding && changes && (
        <AddLayerDialog
          connection={connection}
          scope={changes.scope}
          pickerRefusals={changes.pickerRefusals}
          rememberPickerRefusal={changes.rememberPickerRefusal}
          disabled={disabled}
          pending={pending}
          onClose={() => setAdding(false)}
          onAdd={(arn) => submit({ kind: 'add', arn })}
        />
      )}
      {removing && (
        <AreaModal
          visible
          header={REMOVE}
          closeAriaLabel="Close"
          onDismiss={() => {
            if (!pending) setRemoving(undefined);
          }}
          footer={
            <Box float="right">
              <SpaceBetween direction="horizontal" size="xs">
                <Button disabled={pending} onClick={() => setRemoving(undefined)}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  disabled={disabled || pending || !removalMatches}
                  loading={pending}
                  onClick={() => {
                    if (removalMatches)
                      void submit({ kind: 'remove', index: removing.index }).then(() => setRemoving(undefined));
                  }}
                >
                  {REMOVE}
                </Button>
              </SpaceBetween>
            </Box>
          }
        >
          <SpaceBetween size="xs">
            <Box variant="p">Remove this version from the function?</Box>
            <ValueText kind="address" value={removing.arn} />
          </SpaceBetween>
        </AreaModal>
      )}
    </>
  );
}
