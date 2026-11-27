import type { Tag } from '@aws-sdk/client-cloudwatch';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Header from '@cloudscape-design/components/header';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import { ValueText } from '../../../components/value-text';
import type { useAlarmTags } from '../alarm-queries';

import type { TagOperation } from '../tags-api';

const columns: TableProps.ColumnDefinition<Tag>[] = [
  { id: 'key', header: 'Key', isRowHeader: true, cell: ({ Key }) => <ValueText kind="name" value={Key} none="-" /> },
  { id: 'value', header: 'Value', cell: ({ Value }) => <ValueText kind="text" value={Value} /> },
];

export function AlarmTags({
  connection,
  tags,
  manage,
}: {
  connection: AreaConnection;
  tags: ReturnType<typeof useAlarmTags>;
  manage?: { enabled: boolean; unavailable: ReadonlySet<TagOperation>; open: () => void };
}) {
  const failure = tags.failure && readFailureState(tags.failure, connection, 'tags');
  return (
    <Table
      header={
        <Header
          variant="h2"
          description={
            manage?.unavailable.size
              ? `Not implemented by the emulator (${[...manage.unavailable].join(', ')}).`
              : undefined
          }
          actions={
            manage && (
              <Button disabled={!manage.enabled} onClick={manage.open}>
                Manage tags
              </Button>
            )
          }
        >
          Tags
        </Header>
      }
      items={tags.value ?? []}
      trackBy={(tag) => tag.Key ?? ''}
      columnDefinitions={columns}
      wrapLines
      loading={tags.loading}
      loadingText="Loading tags"
      empty={
        failure ? (
          <ReadFailure state={failure} onRetry={() => void tags.refresh()} />
        ) : (
          <Box textAlign="center" color="inherit">
            No tags
          </Box>
        )
      }
    />
  );
}
