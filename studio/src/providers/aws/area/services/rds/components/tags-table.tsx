import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { ValueText } from '../../../components/value-text';
import { NONE, type Tag } from '../format';

// "Tags" of a DB instance or a DB cluster (issue 573, requirement S3 and S6): a row each with its key and value, as
// text; "No tags" without one.

const COLUMNS: TableProps.ColumnDefinition<Tag>[] = [
  { id: 'key', header: 'Key', isRowHeader: true, cell: (tag) => <ValueText kind="name" value={tag.key} /> },
  { id: 'value', header: 'Value', cell: (tag) => <ValueText kind="text" value={tag.value} none={NONE} /> },
];

export function TagsTable({ tags }: { tags: readonly Tag[] }) {
  return (
    <Table<Tag>
      variant="container"
      header={<Header variant="h2">Tags</Header>}
      items={[...tags]}
      trackBy="key"
      columnDefinitions={COLUMNS}
      wrapLines
      empty={
        <Box textAlign="center" color="inherit">
          <Box variant="strong" color="inherit">
            No tags
          </Box>
        </Box>
      }
    />
  );
}
