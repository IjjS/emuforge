import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import Table, { type TableProps } from '@cloudscape-design/components/table';
import type { Ref } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ManagedDocumentRead, PolicyDetail, PolicyEntity, PolicyPart, PolicyVersion } from '../api';
import { descriptionText, NO_VALUE, rolePath, utcDateText } from '../format';
import type { DocumentQuery } from '../queries';
import { readFailureState } from './failures';
import { NAME_COLUMN_MIN_WIDTH } from './page-parts';
import { PolicyDocument } from './policy-document';
import { ReadFailure } from './states';

// The four sections of a policy's page (issue 535, S5): "Policy details", "Policy document", "Versions" and
// "Attached to", in the service's words; their empty and failure texts in EmuForge's own. Every value from the
// emulator is rendered as text, each as the kind of value it is, and the ARN with its copy control.

/** The reason on every change of an AWS managed policy, its default version's included. */
export const AWS_MANAGED_REASON = 'An AWS managed policy cannot be changed.';

/** The reason on "Delete" of the default version. */
export const DEFAULT_VERSION_REASON = 'The default version cannot be deleted.';

/** An entity's kind, as the page names it. */
const ENTITY_KIND_TEXT: Readonly<Record<PolicyEntity['kind'], string>> = {
  role: 'Role',
  user: 'User',
  group: 'Group',
};

const SELECT_VERSION_FIRST = 'Select a version first';
const ALREADY_DEFAULT = 'This version is the default.';

/** The narrowest column of "Policy details", as the role's "Summary" has it. */
const DETAILS_COLUMN_MIN_WIDTH = 240;

/** "Policy details". */
export function DetailsSection({ policy }: { policy: PolicyDetail }) {
  return (
    <Container header={<Header variant="h2">Policy details</Header>}>
      <KeyValuePairs
        columns={3}
        minColumnWidth={DETAILS_COLUMN_MIN_WIDTH}
        items={[
          { label: 'ARN', value: <CopyValue label="ARN" value={policy.arn} none={NO_VALUE} /> },
          { label: 'Type', value: <ValueText kind="fixed" value={policy.type} /> },
          { label: 'Description', value: <ValueText kind="text" value={descriptionText(policy.description)} /> },
          { label: 'Created', value: <ValueText kind="fixed" value={utcDateText(policy.createDate)} /> },
          { label: 'Last changed', value: <ValueText kind="fixed" value={utcDateText(policy.updateDate)} /> },
          {
            label: 'Default version',
            value: <ValueText kind="fixed" value={policy.defaultVersionId} none={NO_VALUE} />,
          },
        ]}
      />
    </Container>
  );
}

/** "Version v2, the default." or "Version v1.". */
function shownVersionText(versionId: string, isDefault: boolean): string {
  return isDefault ? `Version ${versionId}, the default.` : `Version ${versionId}.`;
}

export interface DocumentSectionProps {
  arn: string;
  /** The version shown and whether it is the default; `undefined` while the policy names none. */
  version: { id: string; isDefault: boolean } | undefined;
  query: DocumentQuery<ManagedDocumentRead>;
  connection: AreaConnection;
  /** `undefined` when "Edit" is available, else why not. */
  editDisabledReason: string | undefined;
  onEdit: () => void;
  editRef: Ref<ButtonProps.Ref>;
}

/** "Policy document": one version's document as the emulator returns it, and "Edit". */
export function DocumentSection({
  arn,
  version,
  query,
  connection,
  editDisabledReason,
  onEdit,
  editRef,
}: DocumentSectionProps) {
  return (
    <Container
      header={
        <Header
          variant="h2"
          description={version === undefined ? undefined : shownVersionText(version.id, version.isDefault)}
          actions={
            <Button
              ref={editRef}
              disabled={editDisabledReason !== undefined}
              {...(editDisabledReason === undefined ? {} : { disabledReason: editDisabledReason })}
              onClick={onEdit}
            >
              Edit
            </Button>
          }
        >
          Policy document
        </Header>
      }
    >
      {version === undefined ? (
        <Box variant="p">{NO_VALUE}</Box>
      ) : (
        <PolicyDocument source={{ kind: 'query', query }} arn={arn} connection={connection} />
      )}
    </Container>
  );
}

const VERSION_COLUMNS: TableProps.ColumnDefinition<PolicyVersion>[] = [
  {
    id: 'version',
    header: 'Version',
    isRowHeader: true,
    cell: (version) => <ValueText kind="fixed" value={version.id} />,
  },
  { id: 'default', header: 'Default', cell: (version) => (version.isDefault ? 'Yes' : NO_VALUE) },
  {
    id: 'created',
    header: 'Created',
    cell: (version) => <ValueText kind="fixed" value={utcDateText(version.createDate)} />,
  },
];

export interface VersionsSectionProps {
  versions: PolicyPart<PolicyVersion>;
  /** An AWS managed policy: "Set as default" and "Delete" are unavailable for every version. */
  awsManaged: boolean;
  selectedId: string | undefined;
  onSelect: (versionId: string | undefined) => void;
  onShow: (version: PolicyVersion) => void;
  onSetDefault: (version: PolicyVersion) => void;
  onDelete: (version: PolicyVersion) => void;
  /** "Set as default" is in flight. */
  settingDefault: boolean;
  connection: AreaConnection;
  onRetry: () => void;
}

/** Why an action of the chosen version is unavailable; `undefined` when it is available. */
function versionReason(
  version: PolicyVersion | undefined,
  awsManaged: boolean,
  defaultReason: string,
): string | undefined {
  if (version === undefined) {
    return SELECT_VERSION_FIRST;
  }
  if (awsManaged) {
    return AWS_MANAGED_REASON;
  }
  return version.isDefault ? defaultReason : undefined;
}

function disabledProps(reason: string | undefined): { disabled: boolean; disabledReason?: string } {
  return reason === undefined ? { disabled: false } : { disabled: true, disabledReason: reason };
}

/** "Versions": each version, one chosen at a time, with "Show document", "Set as default" and "Delete". */
export function VersionsSection({
  versions,
  awsManaged,
  selectedId,
  onSelect,
  onShow,
  onSetDefault,
  onDelete,
  settingDefault,
  connection,
  onRetry,
}: VersionsSectionProps) {
  const items = versions.kind === 'read' ? versions.items : [];
  const selected = items.find((version) => version.id === selectedId);
  return (
    <Table<PolicyVersion>
      variant="container"
      items={items}
      trackBy="id"
      columnDefinitions={VERSION_COLUMNS}
      selectionType="single"
      selectedItems={selected === undefined ? [] : [selected]}
      onSelectionChange={({ detail }) => {
        onSelect(detail.selectedItems[0]?.id);
      }}
      ariaLabels={{
        tableLabel: 'Versions',
        selectionGroupLabel: 'Version selection',
        itemSelectionLabel: (_, version) => version.id,
      }}
      wrapLines
      header={
        <Header
          variant="h2"
          description="The emulator keeps up to 5 versions of a policy."
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button
                {...disabledProps(selected === undefined ? SELECT_VERSION_FIRST : undefined)}
                onClick={() => {
                  if (selected !== undefined) onShow(selected);
                }}
              >
                Show document
              </Button>
              <Button
                {...disabledProps(versionReason(selected, awsManaged, ALREADY_DEFAULT))}
                loading={settingDefault}
                onClick={() => {
                  if (selected !== undefined) onSetDefault(selected);
                }}
              >
                Set as default
              </Button>
              <Button
                {...disabledProps(versionReason(selected, awsManaged, DEFAULT_VERSION_REASON))}
                onClick={() => {
                  if (selected !== undefined) onDelete(selected);
                }}
              >
                Delete
              </Button>
            </SpaceBetween>
          }
        >
          Versions
        </Header>
      }
      empty={
        versions.kind === 'failed' ? (
          <ReadFailure state={readFailureState(versions.failure, connection, 'policy versions')} onRetry={onRetry} />
        ) : (
          <Box textAlign="center" color="inherit">
            <Box variant="strong" color="inherit">
              No versions
            </Box>
          </Box>
        )
      }
    />
  );
}

function EntityName({ entity }: { entity: PolicyEntity }) {
  const handleFollow = useFollow();
  if (entity.kind !== 'role') {
    // Users and groups have no screen yet.
    return <ValueText kind="name" value={entity.name} />;
  }
  return (
    <Link href={rolePath(entity.name)} onFollow={handleFollow}>
      <ValueText kind="name" value={entity.name} />
    </Link>
  );
}

const ENTITY_COLUMNS: TableProps.ColumnDefinition<PolicyEntity>[] = [
  {
    id: 'name',
    header: 'Name',
    isRowHeader: true,
    minWidth: NAME_COLUMN_MIN_WIDTH,
    cell: (entity) => <EntityName entity={entity} />,
  },
  { id: 'kind', header: 'Kind', cell: (entity) => ENTITY_KIND_TEXT[entity.kind] },
];

/** "Attached to": the roles, users and groups the policy is attached to; a role's name leads to its page. */
export function AttachedSection({
  entities,
  connection,
  onRetry,
}: {
  entities: PolicyPart<PolicyEntity>;
  connection: AreaConnection;
  onRetry: () => void;
}) {
  return (
    <Table<PolicyEntity>
      variant="container"
      items={entities.kind === 'read' ? entities.items : []}
      trackBy={(entity) => `${entity.kind}:${entity.name}`}
      columnDefinitions={ENTITY_COLUMNS}
      ariaLabels={{ tableLabel: 'Attached to' }}
      wrapLines
      header={<Header variant="h2">Attached to</Header>}
      empty={
        entities.kind === 'failed' ? (
          <ReadFailure state={readFailureState(entities.failure, connection, 'policy attachments')} onRetry={onRetry} />
        ) : (
          <Box textAlign="center" color="inherit">
            <SpaceBetween size="xxs">
              <Box variant="strong" color="inherit">
                Not attached
              </Box>
              <Box variant="p" color="inherit">
                No role, user or group has this policy.
              </Box>
            </SpaceBetween>
          </Box>
        )
      }
    />
  );
}
