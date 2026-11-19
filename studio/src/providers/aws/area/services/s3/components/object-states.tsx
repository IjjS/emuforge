import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { useFollow } from '../../../components/use-follow';
import { objectsPath } from '../format';
import { Quoted } from './quoted';

// The states of an object's page in place of its sections (issue 480, task 2), in EmuForge's own words
// (requirement, "EmuForge's own text").

/** "Loading object", while `HeadObject` is in flight and nothing of it is shown. */
export function ObjectLoading() {
  return (
    <Container>
      <StatusIndicator type="loading">Loading object</StatusIndicator>
    </Container>
  );
}

/** "No object `{key}`": the bucket is there, the key is not. */
export function ObjectGone({ bucket, objectKey }: { bucket: string; objectKey: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <SpaceBetween size="xxs">
        <Box variant="strong">
          <Quoted before="No object " name={objectKey} after="" />
        </Box>
        <Box variant="p">
          <Quoted before="Bucket " name={bucket} after=" in the local emulator holds no object with this key." />
        </Box>
        <Link href={objectsPath(bucket)} onFollow={handleFollow}>
          <Quoted before="Go to " name={bucket} after="" />
        </Link>
      </SpaceBetween>
    </Container>
  );
}
