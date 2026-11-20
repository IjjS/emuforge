import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Table, { type TableProps } from '@cloudscape-design/components/table';

import { ValueText } from '../../../components/value-text';
import type { Tag } from '../../../lib/ec2-client';
import { NONE } from '../format';

// "Tags" of a VPC, a subnet or a route table (S3, S6, S9): each key and value in the answer's order. A key is a name
// and a value free text (`aws-area.md`, entry 4), both rendered as text.

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
