import type { RotationsListEntry } from '@aws-sdk/client-kms';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../../components/failure-states';
import { creationDateText } from '../../../../components/format-date';
import type { TokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';

function typeLabel(rotationType: RotationsListEntry['RotationType']) {
  switch (rotationType) {
    case 'AUTOMATIC':
      return 'Automatic';
    case 'ON_DEMAND':
      return 'On-demand';
    default:
      return rotationType;
  }
}

interface RotationHistoryProps {
  connection: AreaConnection;
  history: TokenListing<RotationsListEntry>;
  failure: RequestFailure | undefined;
  onRetry: () => void;
}

export function RotationHistory({ connection, history, failure, onRetry }: RotationHistoryProps) {
  return (
    <Table
      ariaLabels={{ tableLabel: 'Rotation history' }}
      header={<Header variant="h2">Rotation history</Header>}
      columnDefinitions={[
        {
          id: 'date',
          header: 'Rotation date',
          cell: (rotation) => <ValueText kind="fixed" value={creationDateText(rotation.RotationDate)} />,
        },
        {
          id: 'type',
          header: 'Rotation type',
          cell: ({ RotationType }) => <ValueText kind="fixed" value={typeLabel(RotationType)} none="-" />,
        },
      ]}
      items={failure === undefined ? (history.items ?? []) : []}
      loading={failure === undefined && history.loading}
      loadingText="Loading rotation history…"
      empty={
        failure === undefined ? (
          <Box textAlign="center">{history.pastEnd ? 'No more rotations' : 'No completed rotations'}</Box>
        ) : (
          <ReadFailure state={readFailureState(failure, connection, 'rotation history')} onRetry={onRetry} />
        )
      }
      pagination={
        (history.pagesCount > 1 || history.openEnd) && (
          <Pagination
            currentPageIndex={history.currentPage}
            pagesCount={history.pagesCount}
            openEnd={history.openEnd}
            onChange={({ detail }) => history.goToPage(detail.currentPageIndex)}
            ariaLabels={{
              nextPageLabel: 'Next page',
              previousPageLabel: 'Previous page',
              pageLabel: (page) => `Page ${page}`,
            }}
          />
        )
      }
    />
  );
}
