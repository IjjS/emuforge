import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { useFollow } from '../../../components/use-follow';
import { BUCKETS_PATH } from '../format';
import { BreakAnywhere } from './break-anywhere';
import type { FailureView, StateLine } from './bucket-read';

// The states of a bucket's screens in place of their content (issue 256, requirement R5.5, R11.1): S1, S3 and S4
// show them as they are. EmuForge's own words, with Cloudscape's patterns: a status with a retry for a failed read.

/** A line of a state, its value as code; every value is text, and a long one breaks inside the box. */
export function StateLineText({ line }: { line: StateLine }) {
  return (
    <>
      {line.before}
      {line.code !== undefined && (
        <Box variant="code" display="inline">
          <BreakAnywhere>{line.code}</BreakAnywhere>
        </Box>
      )}
      {line.after}
    </>
  );
}

/** "Loading bucket", while the page's read is in flight and nothing of it is shown (R11.1). */
export function BucketLoading() {
  return (
    <Container>
      <StatusIndicator type="loading">Loading bucket</StatusIndicator>
    </Container>
  );
}

/** A failed read of the page (R11.1): its status and first line, the line after it, then its recovery and "Retry". */
export function BucketReadFailure({ view, onRetry }: { view: FailureView; onRetry: () => void }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <SpaceBetween size="s">
        <SpaceBetween size="xxs">
          <StatusIndicator type={view.type}>
            <StateLineText line={view.first} />
          </StatusIndicator>
          {view.detail !== undefined && (
            <Box variant="p">
              <BreakAnywhere>
                <StateLineText line={view.detail} />
              </BreakAnywhere>
            </Box>
          )}
          {view.recovery && (
            <Link href="/" onFollow={handleFollow}>
              Connection status
            </Link>
          )}
        </SpaceBetween>
        <Box>
          <Button onClick={onRetry}>Retry</Button>
        </Box>
      </SpaceBetween>
    </Container>
  );
}

/** "Bucket not found" (R5.5): the emulator holds no bucket of the name the page was opened for. */
export function BucketNotFound({ name }: { name: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <SpaceBetween size="xxs">
        <Box variant="strong">Bucket not found</Box>
        <Box variant="p">
          <BreakAnywhere>
            {`The emulator holds no bucket named “${name}”. It may have been deleted, or the emulator restarted.`}
          </BreakAnywhere>
        </Box>
        <Link href={BUCKETS_PATH} onFollow={handleFollow}>
          General purpose buckets
        </Link>
      </SpaceBetween>
    </Container>
  );
}
