import type { SecretVersionsListEntry } from '@aws-sdk/client-secrets-manager';
import Box from '@cloudscape-design/components/box';
import ButtonDropdown from '@cloudscape-design/components/button-dropdown';
import ExpandableSection from '@cloudscape-design/components/expandable-section';
import Pagination from '@cloudscape-design/components/pagination';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table from '@cloudscape-design/components/table';
import { useLayoutEffect, useRef, useState } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { creationDateText } from '../../../../components/format-date';
import { ValueText } from '../../../../components/value-text';
import { useVersionListing } from '../../queries';
import { UPDATE_SECRET_VERSION_STAGE } from '../../versions-policy-api';
import type { LifecycleAction } from '../lifecycle/use-lifecycle-action';
import { SectionReadFailure } from './section-read-failure';
import { StageDialog, type StageEdit } from './stage-dialog';

const NO_STAGES = {};

export function VersionHistory({
  action,
  connection,
  endpoint,
  name,
  stagesByVersion = NO_STAGES,
  scheduled,
  open,
  selected,
  onOpen,
  onSelect,
  onSaved,
}: {
  action: LifecycleAction;
  connection: AreaConnection;
  endpoint: string;
  name: string;
  stagesByVersion: Record<string, string[]> | undefined;
  scheduled: boolean;
  open: boolean;
  selected: string | undefined;
  onOpen: (open: boolean) => void;
  onSelect: (versionId: string | undefined) => void;
  onSaved: (origin: string, message: string) => void;
}) {
  const listing = useVersionListing(endpoint, name, open);
  const [edit, setEdit] = useState<StageEdit>();
  const paginationRoot = useRef<HTMLDivElement>(null);
  const unavailableNotice = useRef<HTMLDivElement>(null);
  const pageFocusOrigin = useRef<Element | null>(null);
  const unavailable = listing.failure?.kind === 'not-implemented';

  useLayoutEffect(() => {
    if (!open) return;
    const handleFocus = (event: FocusEvent) => {
      if (event.target !== pageFocusOrigin.current && event.target !== document.body) {
        pageFocusOrigin.current = null;
      }
    };
    document.addEventListener('focusin', handleFocus, true);
    return () => {
      document.removeEventListener('focusin', handleFocus, true);
      pageFocusOrigin.current = null;
    };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || listing.loading) return;
    const origin = pageFocusOrigin.current;
    pageFocusOrigin.current = null;
    // Disabling or replacing pagination can move focus to the body while the page is read.
    if (
      unavailable &&
      origin !== null &&
      (document.activeElement === origin || document.activeElement === document.body)
    ) {
      unavailableNotice.current?.focus();
    }
  }, [open, listing.currentPage, listing.loading, unavailable]);
  const versions = listing.items ?? [];
  const selectedVersion = versions.find(({ VersionId }) => VersionId === selected);
  const selectedStages = selectedVersion?.VersionStages ?? [];
  const movable = Object.entries(stagesByVersion).flatMap(([source, stages]) =>
    source === selected ? [] : stages.map((label) => ({ label, source })),
  );

  const pagination = (listing.openEnd || listing.pagesCount > 1) && (
    <div ref={paginationRoot}>
      <Pagination
        currentPageIndex={listing.currentPage}
        pagesCount={listing.pagesCount}
        openEnd={listing.openEnd}
        disabled={listing.loading || unavailable}
        ariaLabels={{
          nextPageLabel: 'Next version page',
          previousPageLabel: 'Previous version page',
          pageLabel: (page) => `Version page ${String(page)}`,
        }}
        onChange={({ detail }) => {
          const active = document.activeElement;
          pageFocusOrigin.current = paginationRoot.current?.contains(active) ? active : null;
          onSelect(undefined);
          listing.goToPage(detail.currentPageIndex);
        }}
      />
    </div>
  );

  return (
    <ExpandableSection
      variant="container"
      headerText="Version history"
      headingTagOverride="h2"
      expanded={open}
      onChange={({ detail }) => onOpen(detail.expanded)}
      headerActions={
        open &&
        !scheduled && (
          <ButtonDropdown
            disabled={selectedVersion === undefined || action.disabled(UPDATE_SECRET_VERSION_STAGE)}
            items={[
              { id: 'add', text: 'Add staging label' },
              { id: 'move', text: 'Move staging label here', disabled: movable.length === 0 },
              { id: 'remove', text: 'Remove staging label', disabled: selectedStages.length === 0 },
            ]}
            onItemClick={({ detail }) => {
              if (selected === undefined) return;
              action.clearFailure();
              switch (detail.id) {
                case 'add':
                  setEdit({
                    kind: 'add',
                    version: selected,
                    existing: [...selectedStages, ...movable.map(({ label }) => label)],
                  });
                  break;
                case 'move':
                  setEdit({ kind: 'move', version: selected, labels: movable });
                  break;
                case 'remove':
                  setEdit({ kind: 'remove', version: selected, labels: selectedStages });
                  break;
              }
            }}
          >
            Manage staging labels
          </ButtonDropdown>
        )
      }
      disableContentPaddings={listing.failure === undefined && versions.length > 0}
    >
      {open &&
        (listing.failure === undefined ? (
          <Table<SecretVersionsListEntry>
            variant="embedded"
            ariaLabels={{
              tableLabel: 'Version history',
              selectionGroupLabel: 'Select a version',
              itemSelectionLabel: (_, row) => `Select version ${row.VersionId ?? ''}`,
            }}
            columnDefinitions={[
              {
                id: 'version',
                header: 'Version ID',
                isRowHeader: true,
                cell: ({ VersionId }) => <ValueText kind="name" value={VersionId} none="-" />,
              },
              {
                id: 'stages',
                header: 'Staging labels',
                cell: ({ VersionStages }) => (
                  <ValueText kind="name" value={VersionStages?.join(', ')} none="No labels" />
                ),
              },
              {
                id: 'created',
                header: 'Created',
                cell: ({ CreatedDate }) => <ValueText kind="fixed" value={creationDateText(CreatedDate)} />,
              },
            ]}
            items={versions}
            trackBy="VersionId"
            selectionType="single"
            selectedItems={selectedVersion === undefined ? [] : [selectedVersion]}
            isItemDisabled={({ VersionId }) => VersionId === undefined}
            onSelectionChange={({ detail }) => onSelect(detail.selectedItems[0]?.VersionId)}
            wrapLines
            loading={listing.loading}
            loadingText="Loading versions"
            empty={
              <Box textAlign="center">
                {listing.pastEnd ? 'No versions on this page.' : 'No versions found for this secret.'}
              </Box>
            }
            pagination={pagination}
          />
        ) : (
          <SpaceBetween size="s">
            <SectionReadFailure
              failure={listing.failure}
              connection={connection}
              resource="version history"
              onRetry={listing.refresh}
              noticeRef={unavailableNotice}
            />
            {unavailable && pagination}
          </SpaceBetween>
        ))}
      {open && edit !== undefined && (
        <StageDialog
          action={action}
          connection={connection}
          edit={edit}
          name={name}
          onClose={() => setEdit(undefined)}
          onSaved={(origin, message) => {
            setEdit(undefined);
            onSaved(origin, message);
          }}
        />
      )}
    </ExpandableSection>
  );
}
