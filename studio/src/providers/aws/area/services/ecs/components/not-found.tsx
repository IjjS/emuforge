import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { useFollow } from '../../../components/use-follow';

// ECS's not-found state (issue 575, R4): what S3 to S6 show in the place of everything for a cluster the emulator
// answers as `MISSING` or `INACTIVE`, and the other screens for a resource it does not hold. Cloudscape's empty-state
// pattern, with a link that moves with the router.

export interface NotFoundProps {
  /** "No cluster named {cluster}". */
  heading: string;
  /** "The local emulator has no active cluster of this name." */
  statement: string;
  /** Where to go instead: "Clusters" to S1. */
  link: { text: string; href: string };
}

export function NotFound({ heading, statement, link }: NotFoundProps) {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          <Box variant="h2" color="inherit">
            {heading}
          </Box>
          <Box variant="p" color="inherit">
            {statement}
          </Box>
          <Link href={link.href} onFollow={handleFollow}>
            {link.text}
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}
