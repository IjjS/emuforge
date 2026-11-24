import type { RotationsListEntry } from '@aws-sdk/client-kms';
import Box from '@cloudscape-design/components/box';
import Header from '@cloudscape-design/components/header';
import Pagination from '@cloudscape-design/components/pagination';
import Table from '@cloudscape-design/components/table';
import { useEffect, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import type { AreaConnection } from '../../../../components/emulator-line';
import { ReadFailure } from '../../../../components/failure-states';
import { creationDateText, NO_DATE } from '../../../../components/format-date';
import type { TokenListing } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { readFailureState } from '../../queries';
import { useRotationRetryFocus } from './use-rotation-retry-focus';

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
  const { heading, retryRegion } = useRotationRetryFocus();
  const [overflows, setOverflows] = useState(false);
  const hasRows = failure === undefined && (history.items?.length ?? 0) > 0;
  const recovery =
    failure === undefined
      ? undefined
      : readFailureState(failure, connection, `rotation history (${failure.operation})`);

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
      <div className="aws-area-announcer" role="status" aria-label="Rotation history read status" aria-atomic="true">
        {recovery === undefined ? '' : `${recovery.firstText}.`}
      </div>
      <Table
        ariaLabels={{ tableLabel: 'Rotation history' }}
        header={
          <Header variant="h2" description={hasRows && overflows ? 'Scroll sideways to see both columns.' : undefined}>
            <span ref={heading} tabIndex={-1}>
              Rotation history
            </span>
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
          recovery === undefined ? (
            <Box textAlign="center">{history.pastEnd ? 'No more rotations' : 'No completed rotations'}</Box>
          ) : (
            <div ref={retryRegion}>
              <ReadFailure state={recovery} onRetry={onRetry} />
            </div>
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
