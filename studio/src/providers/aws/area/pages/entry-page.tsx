import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs, { type KeyValuePairsProps } from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';

import type { EntryAreaPage } from '../area-page';
import { useFollow } from '../components/use-follow';
import { findResourceEntry } from '../entries';

/** The AWS area's page for a resource kind or sub-service whose path has no screen (issue 650, R5). */
export function EntryPage({ page }: { page: EntryAreaPage }) {
  const follow = useFollow();
  const { first, groups, label, match, service } = page;
  const values: KeyValuePairsProps.Pair[] = [];
  let primary: { title: string; href: string } | undefined =
    first === undefined ? undefined : { title: first.title, href: first.address };
  let statement = 'Studio has no screen for this yet.';
  let shownPlace: string | undefined;

  if ('subService' in match) {
    values.push({ label: 'Sub-service', value: match.subService.name }, { label: 'Part of', value: service.crumb });
  } else {
    const { group, resource } = match;
    const { listedBy, listedInside, shownIn } = resource;
    const parent = listedInside === undefined ? undefined : findResourceEntry(groups, listedInside);
    values.push({ label: 'Resource kind', value: label });
    if (groups.length > 1) values.push({ label: 'Part of', value: group.name });
    values.push({ label: 'Listed by', value: <Box variant="code">{listedBy}</Box> });
    if (parent !== undefined) values.push({ label: 'Listed inside', value: parent.label });

    if (shownIn !== undefined) {
      statement = `Studio has no screen that lists these across ${service.crumb} yet.`;
      shownPlace = shownIn.place;
    }
    const destination = shownIn === undefined ? parent : findResourceEntry(groups, shownIn.entry);
    if (destination !== undefined) primary = { title: destination.label, href: destination.path };
  }

  return (
    <ContentLayout header={<Header variant="h1">{label}</Header>}>
      <SpaceBetween size="m">
        <Container>
          <SpaceBetween size="m">
            <SpaceBetween size="xs">
              <Box variant="strong">{statement}</Box>
              {shownPlace !== undefined && <Box variant="p">{`It shows them in ${shownPlace}.`}</Box>}
            </SpaceBetween>
            <KeyValuePairs columns={2} items={values} />
            <Box variant="p">Opening this page changed nothing in your local emulator.</Box>
            <SpaceBetween direction="horizontal" size="xs">
              {primary !== undefined && (
                <Button variant="primary" href={primary.href} onFollow={follow}>
                  {`Go to ${primary.title}`}
                </Button>
              )}
              <Button href="/" onFollow={follow}>
                Go to Home
              </Button>
            </SpaceBetween>
          </SpaceBetween>
        </Container>
        {'subService' in match && (
          <Container header={<Header variant="h2">Resource kinds</Header>}>
            <Box tagOverride="ul">
              {match.links.map(({ href, text, info }) => (
                <Box tagOverride="li" key={href}>
                  <Link href={href} onFollow={follow}>
                    {text}
                  </Link>
                  {info !== undefined && <Box variant="small">{` — ${info}`}</Box>}
                </Box>
              ))}
            </Box>
          </Container>
        )}
      </SpaceBetween>
    </ContentLayout>
  );
}
