import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Table from '@cloudscape-design/components/table';
import { useEffect, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../../components/failure-states';
import { creationDateText } from '../../../../components/format-date';
import { ValueText } from '../../../../components/value-text';
import { useParameterHistory, useUnsupportedOperation } from '../../queries';
import { LABEL_PARAMETER_VERSION, UNLABEL_PARAMETER_VERSION, type HistoryVersion } from '../../version-api';
import { LabelDialog } from './label-dialog';
import { ValueReveal } from './value-reveal';

interface HistoryProps {
  connection: AreaConnection;
  name: string;
  secure: boolean;
}

export function VersionHistory(props: HistoryProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <ExpandableSection
      variant="container"
      headerText="Version history"
      expanded={expanded}
      onChange={({ detail }) => setExpanded(detail.expanded)}
    >
      {expanded && <HistoryTable {...props} />}
    </ExpandableSection>
  );
}

function HistoryTable({ connection, name, secure }: HistoryProps) {
  const listing = useParameterHistory(connection, name);
  const { failure, rememberFailure } = listing;
  useEffect(() => {
    if (failure?.kind === 'not-implemented') rememberFailure(failure);
  }, [failure, rememberFailure]);
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [confirmedItems, setConfirmedItems] = useState<HistoryVersion[]>();
  // The detail keys this table's lifetime to the parameter and connection.
  if (listing.items !== undefined && listing.items !== confirmedItems) {
    setConfirmedItems(listing.items);
  }
  const unavailable = failure?.kind === 'not-implemented';
  const items = (unavailable ? confirmedItems : listing.items) ?? [];
  const version = items.find(({ Version }) => Version === selectedVersion);
  const feedback = unavailable && actionFailureItem(failure, 'Loading version history', connection.engineOrigin);
  const refusal = feedback && (
    <SpaceBetween size="xs">
      <StatusIndicator type="info">{feedback.header}</StatusIndicator>
      <Box variant="p">{feedback.content}</Box>
      <Button disabled>Retry</Button>
    </SpaceBetween>
  );

  return (
    <SpaceBetween size="m">
      {items.length > 0 && refusal}
      <Table<HistoryVersion>
        ariaLabels={{
          tableLabel: 'Parameter versions',
          selectionGroupLabel: 'Version selection',
          itemSelectionLabel: (_, item) => `Version ${item.Version}`,
        }}
        columnDefinitions={[
          { id: 'version', header: 'Version', cell: (item) => item.Version, isRowHeader: true },
          {
            id: 'modified',
            header: 'Last modified',
            cell: (item) => <ValueText kind="fixed" value={creationDateText(item.LastModifiedDate)} />,
          },
          {
            id: 'labels',
            header: 'Labels',
            cell: (item) => <ValueText kind="text" value={item.Labels?.join(', ')} none="-" />,
          },
        ]}
        trackBy={(item) => String(item.Version)}
        items={items}
        selectionType="single"
        selectedItems={version ? [version] : []}
        onSelectionChange={({ detail }) => setSelectedVersion(detail.selectedItems[0]?.Version)}
        loading={!failure && listing.loading}
        loadingText="Loading version history…"
        pagination={
          (listing.openEnd || listing.pagesCount > 1) && (
            <Pagination
              currentPageIndex={listing.currentPage}
              pagesCount={listing.pagesCount}
              openEnd={listing.openEnd}
              disabled={unavailable || listing.loading}
              ariaLabels={{
                previousPageLabel: 'Previous page',
                nextPageLabel: 'Next page',
                pageLabel: (page) => `Page ${String(page)}`,
              }}
              onChange={({ detail }) => {
                if (unavailable || listing.loading) return;
                setSelectedVersion(undefined);
                setConfirmedItems(undefined);
                listing.goToPage(detail.currentPageIndex);
              }}
            />
          )
        }
        empty={
          refusal ||
          (failure ? (
            <ReadFailure state={readFailureState(failure, connection, 'version history')} onRetry={listing.refresh} />
          ) : (
            <Box textAlign="center">{listing.openEnd ? 'No versions on this page' : 'No versions'}</Box>
          ))
        }
      />
      {version && (
        <VersionActions key={version.Version} connection={connection} name={name} version={version} secure={secure} />
      )}
    </SpaceBetween>
  );
}

function VersionActions({ connection, name, version, secure }: HistoryProps & { version: HistoryVersion }) {
  const [mode, setMode] = useState<'add' | 'remove'>();
  const add = useUnsupportedOperation(connection, LABEL_PARAMETER_VERSION);
  const remove = useUnsupportedOperation(connection, UNLABEL_PARAMETER_VERSION);

  return (
    <section aria-label={`Version ${version.Version} actions`}>
      <SpaceBetween size="xs">
        <Box variant="h3">Version {version.Version}</Box>
        <ValueReveal
          connection={connection}
          name={`${name}:${version.Version}`}
          secure={version.Type === undefined ? secure : version.Type === 'SecureString'}
        />
        <SpaceBetween direction="horizontal" size="xs">
          <Button disabled={add.failure !== undefined} onClick={() => setMode('add')}>
            Add labels
          </Button>
          <Button disabled={remove.failure !== undefined || !version.Labels?.length} onClick={() => setMode('remove')}>
            Remove labels
          </Button>
        </SpaceBetween>
        {[add.failure, remove.failure].map((failure) => {
          if (!failure) return null;
          const feedback = actionFailureItem(failure, 'Managing labels', connection.engineOrigin);
          return (
            <div key={failure.operation} role="status">
              <StatusIndicator type="info">{feedback.header}</StatusIndicator>
              <Box variant="p">{feedback.content}</Box>
            </div>
          );
        })}
      </SpaceBetween>
      {mode && (
        <LabelDialog
          connection={connection}
          name={name}
          version={version}
          mode={mode}
          onClose={() => setMode(undefined)}
        />
      )}
    </section>
  );
}
