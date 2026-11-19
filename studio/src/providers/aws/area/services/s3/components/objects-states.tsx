import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import type { ReactNode } from 'react';

import { useFollow } from '../../../components/use-follow';
import { BUCKETS_PATH } from '../format';
import type { FailureView } from './bucket-read';
import { StateLineText } from './bucket-read-state';
import { Quoted } from './quoted';

// The states of the tab "Objects" (issue 480, task 1), in EmuForge's own words (requirement, "EmuForge's own text"):
// in the table's body, with Cloudscape's empty-table pattern, and the bucket gone in place of the table.

/** What the table's body shows, the rows aside. */
export type ObjectsBody =
  | { kind: 'loading' }
  | { kind: 'rows' }
  | { kind: 'empty'; prefix: string }
  | { kind: 'no-match'; prefix: string; text: string }
  | { kind: 'failure'; view: FailureView };

function Message({ title, children }: { title: string; children: ReactNode }) {
  return (
    <SpaceBetween size="xxs">
      <Box variant="strong" color="inherit">
        {title}
      </Box>
      <Box variant="p" color="inherit">
        {children}
      </Box>
    </SpaceBetween>
  );
}

/** The table's empty slot: empty at the root or under a prefix, no match, or a failed read with "Retry". */
export function ObjectsTableBody({
  state,
  onClearFilter,
  onRetry,
}: {
  state: ObjectsBody;
  onClearFilter: () => void;
  onRetry: () => void;
}) {
  const handleFollow = useFollow();
  switch (state.kind) {
    case 'loading':
    case 'rows':
      return null;
    case 'empty':
      return (
        <Box textAlign="center" color="inherit">
          <Message title="No objects">
            {state.prefix === '' ? (
              'This bucket holds no objects yet. Upload a file, or write one from your app or the AWS CLI.'
            ) : (
              <Quoted before="Nothing is stored under " name={state.prefix} after="." />
            )}
          </Message>
        </Box>
      );
    case 'no-match':
      return (
        <Box textAlign="center" color="inherit">
          <Message title="No matches">
            {state.prefix === '' ? (
              <Quoted before="No key starts with " name={state.text} after="." />
            ) : (
              <>
                <Quoted before="No key under " name={state.prefix} after="" />
                <Quoted before=" starts with " name={state.text} after="." />
              </>
            )}
          </Message>
          <Box margin={{ top: 's' }}>
            <Button onClick={onClearFilter}>Clear filter</Button>
          </Box>
        </Box>
      );
    case 'failure':
      return (
        <Box textAlign="center" color="inherit">
          <SpaceBetween size="xxs">
            <StatusIndicator type={state.view.type}>
              <StateLineText line={state.view.first} />
            </StatusIndicator>
            {state.view.detail !== undefined && (
              <Box variant="p" color="inherit">
                <StateLineText line={state.view.detail} />
              </Box>
            )}
            {state.view.recovery && (
              <Link href="/" onFollow={handleFollow}>
                Connection status
              </Link>
            )}
          </SpaceBetween>
          <Box margin={{ top: 's' }}>
            <Button onClick={onRetry}>Retry</Button>
          </Box>
        </Box>
      );
  }
}

/** "No bucket `{name}`": the emulator holds no bucket of the name the tab was opened for. */
export function ObjectsBucketGone({ name }: { name: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <SpaceBetween size="xxs">
        <Box variant="strong">
          <Quoted before="No bucket " name={name} after="" />
        </Box>
        <Box variant="p">The local emulator holds no bucket of this name.</Box>
        <Link href={BUCKETS_PATH} onFollow={handleFollow}>
          Go to Buckets
        </Link>
      </SpaceBetween>
    </Container>
  );
}
