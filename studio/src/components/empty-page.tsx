import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import type { ReactNode } from 'react';

import { useFollow } from './use-follow';

interface EmptyPageProps {
  title: string;
  /** One statement of why the page is empty; rendered as text. */
  children: ReactNode;
}

/** A page with nothing to show yet: its header, one statement, and the way back to Home. */
export function EmptyPage({ title, children }: EmptyPageProps) {
  const handleFollow = useFollow();
  return (
    <ContentLayout header={<Header variant="h1">{title}</Header>}>
      <Container>
        <Box textAlign="center" padding={{ vertical: 'xxl' }} color="inherit">
          <SpaceBetween size="m">
            <Box variant="p" color="text-body-secondary">
              {children}
            </Box>
            <Button href="/" onFollow={handleFollow}>
              Go to Home
            </Button>
          </SpaceBetween>
        </Box>
      </Container>
    </ContentLayout>
  );
}
