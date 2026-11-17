import '../styles/no-screen-path.css';

import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { Fragment } from 'react';

import type { Service } from '../../services';
import { NO_SCREEN_PART_TITLE } from '../area-page';
import { EmptyPage } from '../components/empty-page';
import { useFollow } from '../components/use-follow';

/** A path below a service that has screens, which no screen matches (issue 57, requirement R4). */
export interface NoScreenPart {
  /** The requested path, exactly as the address carries it. */
  path: string;
  /** The service's first screen: its title and the address "Go to {title}" leads to; none when it has none (R4.7). */
  first: { title: string; href: string } | undefined;
}

interface NoScreenPageProps {
  service: Service;
  /** Given below a service that has screens: the page for this part of it. Absent below a service without any. */
  part?: NoScreenPart | undefined;
}

/** A character after which a browser may break a line inside a word (a hyphen, `!`), with the character after it. */
const BREAK_AFTER = /([-!].)/u;

/**
 * One segment of the path as one word: each character after which a browser would break a line inside it is joined to
 * the next one (`no-screen-path.css`), so the segment breaks only where it does not fit a line by itself (R4.6).
 */
function Segment({ text }: { text: string }) {
  return text.split(BREAK_AFTER).map((part, index) =>
    index % 2 === 1 ? (
      <span key={index} className="aws-area-no-screen-path-joined">
        {part}
      </span>
    ) : (
      part
    ),
  );
}

/**
 * The path as text, nothing decoded (R4.6), in Cloudscape's code text: a break opportunity after each `/` and none
 * inside a segment, so a line breaks after a `/` first, and a segment that does not fit a line by itself breaks
 * inside (`no-screen-path.css`).
 */
function RequestedPath({ path }: { path: string }) {
  return (
    <Box variant="code" display="block" className="aws-area-no-screen-path">
      {path.split('/').map((segment, index) => (
        <Fragment key={index}>
          {index > 0 && (
            <>
              /<wbr />
            </>
          )}
          <Segment text={segment} />
        </Fragment>
      ))}
    </Box>
  );
}

/** R4.5: the statement, the path under its label, the sentence, then "Go to {title}" and "Go to Home" (R4.7). */
function PartPage({ service, part }: { service: Service; part: NoScreenPart }) {
  const handleFollow = useFollow();
  return (
    <ContentLayout header={<Header variant="h1">{NO_SCREEN_PART_TITLE}</Header>}>
      <Container>
        <Box textAlign="center" padding={{ vertical: 'xxl' }} color="inherit">
          <SpaceBetween size="m">
            <SpaceBetween size="xs">
              <Box variant="strong">{`Studio has no screen for this part of ${service.label} yet.`}</Box>
              <Box display="inline-block" textAlign="left">
                <Box variant="awsui-key-label">Path</Box>
                <RequestedPath path={part.path} />
              </Box>
              <Box variant="p">Opening this page changed nothing in your local emulator.</Box>
            </SpaceBetween>
            <Box display="inline-block">
              <SpaceBetween direction="horizontal" size="xs">
                {part.first !== undefined && (
                  <Button variant="primary" href={part.first.href} onFollow={handleFollow}>
                    {`Go to ${part.first.title}`}
                  </Button>
                )}
                <Button href="/" onFollow={handleFollow}>
                  Go to Home
                </Button>
              </SpaceBetween>
            </Box>
          </SpaceBetween>
        </Box>
      </Container>
    </ContentLayout>
  );
}

/**
 * The area's "no screen yet" page. Calls nothing. Below a service without any screen, at `/aws/<service>` and every
 * path below it: the service's label and that Studio has no screen for it (R5). Below a service that has screens, at a
 * path no screen matches: the page for this part of the service (R4).
 */
export function NoScreenPage({ service, part }: NoScreenPageProps) {
  if (part !== undefined) {
    return <PartPage service={service} part={part} />;
  }
  return <EmptyPage title={service.label}>{`Studio has no screen for ${service.label} yet.`}</EmptyPage>;
}
