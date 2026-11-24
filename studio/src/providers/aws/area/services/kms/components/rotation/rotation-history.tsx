import type { RotationsListEntry } from '@aws-sdk/client-kms';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';
import { useEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../../components/failure-states';
import { creationDateText, NO_DATE } from '../../../../components/format-date';
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
  const section = useRef<HTMLDivElement>(null);
  const [overflows, setOverflows] = useState(false);
  const hasRows = failure === undefined && (history.items?.length ?? 0) > 0;

  useEffect(() => {
    const table = section.current?.querySelector('table');
    const scrollPane = table?.parentElement;
    if (!hasRows || !table || !scrollPane) return;
    const measure = () => setOverflows(scrollPane.scrollWidth > scrollPane.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(table);
    observer.observe(scrollPane);
    return () => observer.disconnect();
  }, [hasRows]);

  return (
    <div ref={section}>
      <Table
        ariaLabels={{ tableLabel: 'Rotation history' }}
        header={
          <Header variant="h2" description={hasRows && overflows ? 'Scroll sideways to see both columns.' : undefined}>
            Rotation history
          </Header>
        }
        wrapLines
        columnDefinitions={[
          {
            id: 'date',
            header: 'Rotation date',
            cell: ({ RotationDate }) => {
              const date = creationDateText(RotationDate);
              return <ValueText kind="fixed" value={date === NO_DATE ? undefined : date} none="–" />;
            },
          },
          {
            id: 'type',
            header: 'Rotation type',
            cell: ({ RotationType }) => <ValueText kind="fixed" value={typeLabel(RotationType)} none="–" />,
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
    </div>
  );
}
