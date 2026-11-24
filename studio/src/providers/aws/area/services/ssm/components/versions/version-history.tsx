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
import {
  GET_PARAMETER_HISTORY,
  LABEL_PARAMETER_VERSION,
  UNLABEL_PARAMETER_VERSION,
  type HistoryVersion,
} from '../../version-api';
import { LabelDialog } from './label-dialog';
import { ValueReveal } from './value-reveal';

interface HistoryProps {
  connection: AreaConnection;
  name: string;
  secure: boolean;
}

type LabelMode = 'add' | 'remove';

interface ConfirmedPage {
  read: HistoryVersion[];
  items: HistoryVersion[];
  currentPage: number;
  pagesCount: number;
  openEnd: boolean;
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
      <HistoryTable {...props} expanded={expanded} />
    </ExpandableSection>
  );
}

function HistoryTable({ connection, name, secure, expanded }: HistoryProps & { expanded: boolean }) {
  const { failure: refusalFailure, markUnsupported } = useUnsupportedOperation(connection, GET_PARAMETER_HISTORY);
  // Keep observing an in-flight read when the section closes.
  const listing = useParameterHistory(connection, name, expanded && refusalFailure === undefined);
  const failure = refusalFailure ?? listing.failure;
  useEffect(() => {
    if (failure?.kind === 'not-implemented') markUnsupported(failure);
  }, [failure, markUnsupported]);
  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [confirmedPage, setConfirmedPage] = useState<ConfirmedPage>();
  // A new read replaces the snapshot. Acknowledged writes revise its rows until that read arrives.
  if (listing.items !== undefined && listing.items !== confirmedPage?.read) {
    setConfirmedPage({
      read: listing.items,
      items: listing.items,
      currentPage: listing.currentPage,
      pagesCount: listing.pagesCount,
      openEnd: listing.openEnd,
    });
    if (confirmedPage !== undefined && confirmedPage.currentPage !== listing.currentPage) {
      setSelectedVersion(undefined);
    }
  }
  if (!expanded) return null;

  const unavailable = failure?.kind === 'not-implemented';
  const page = unavailable && confirmedPage !== undefined ? confirmedPage : listing;
  const items = page.items ?? [];
  const version = items.find(({ Version }) => Version === selectedVersion);
  const feedback = unavailable && actionFailureItem(failure, 'Loading version history', connection.engineOrigin);
  const refusal = feedback && (
    <SpaceBetween size="xs">
      <StatusIndicator type="info">{feedback.header}</StatusIndicator>
      <Box variant="p">{feedback.content}</Box>
      <Button disabled>Retry</Button>
    </SpaceBetween>
  );

  function handleLabelsApplied(version: number, mode: LabelMode, applied: string[]) {
    setConfirmedPage((page) => {
      if (page === undefined) return page;
      return {
        ...page,
        items: page.items.map((item) => {
          if (item.Version !== version) return item;
          const labels = item.Labels ?? [];
          const Labels =
            mode === 'add' ? [...new Set([...labels, ...applied])] : labels.filter((label) => !applied.includes(label));
          return { ...item, Labels };
        }),
      };
    });
  }

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
          (page.openEnd || page.pagesCount > 1) && (
            <Pagination
              currentPageIndex={page.currentPage}
              pagesCount={page.pagesCount}
              openEnd={page.openEnd}
              disabled={unavailable || listing.loading}
              ariaLabels={{
                previousPageLabel: 'Previous page',
                nextPageLabel: 'Next page',
                pageLabel: (page) => `Page ${String(page)}`,
              }}
              onChange={({ detail }) => {
                if (unavailable || listing.loading) return;
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
            <Box textAlign="center">{page.openEnd ? 'No versions on this page' : 'No versions'}</Box>
          ))
        }
      />
      {version && (
        <VersionActions
          key={version.Version}
          connection={connection}
          name={name}
          version={version}
          secure={secure}
          onLabelsApplied={handleLabelsApplied}
        />
      )}
    </SpaceBetween>
  );
}

function VersionActions({
  connection,
  name,
  version,
  secure,
  onLabelsApplied,
}: HistoryProps & {
  version: HistoryVersion;
  onLabelsApplied: (version: number, mode: LabelMode, labels: string[]) => void;
}) {
  const [mode, setMode] = useState<LabelMode>();
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
          onApplied={(version, labels) => onLabelsApplied(version, mode, labels)}
          onClose={() => setMode(undefined)}
        />
      )}
    </section>
  );
}
