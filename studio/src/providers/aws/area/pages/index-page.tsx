import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useId } from 'react';

import { AWS_NAME, servicePath } from '../../identity';
import { type Service, SERVICES } from '../../services';
import { useFollow } from '../components/use-follow';
import { type AreaScreen, SCREENS } from '../screens';

const SERVICE_COLUMNS = 3;

/**
 * `services` in at most three columns, each a contiguous run of the label-ordered list, so the order reads top to
 * bottom, then across; no column is left empty.
 */
function serviceColumns(services: readonly Service[]): Service[][] {
  if (services.length === 0) return [];
  const perColumn = Math.ceil(services.length / SERVICE_COLUMNS);
  const columns = Math.ceil(services.length / perColumn);
  return Array.from({ length: columns }, (_, column) => services.slice(column * perColumn, (column + 1) * perColumn));
}

/** The description of "Services" for `screens` of `count` services having a Studio screen (issue 61, R4). */
function screensStatement(screens: number, count: number): string {
  if (screens === 0) return 'No service has a Studio screen yet.';
  if (screens === count) return 'Every service has a Studio screen.';
  if (screens === 1) return `1 of ${String(count)} services has a Studio screen.`;
  return `${String(screens)} of ${String(count)} services have a Studio screen.`;
}

/** `services` as links, each to its page, in columns. */
function ServiceLinks({ services }: { services: readonly Service[] }) {
  const handleFollow = useFollow();
  const columns = serviceColumns(services);
  return (
    <ColumnLayout columns={Math.max(columns.length, 1)} variant="text-grid">
      {columns.map((column, index) => (
        <SpaceBetween size="xs" key={index}>
          {column.map((service) => (
            <Link key={service.route} href={servicePath(service)} onFollow={handleFollow}>
              {service.label}
            </Link>
          ))}
        </SpaceBetween>
      ))}
    </ColumnLayout>
  );
}

/** One group of services under its own `h3`, which names the group for a screen reader (R5). */
function ServiceGroup({ label, services }: { label: string; services: readonly Service[] }) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <SpaceBetween size="s">
        <Header variant="h3">
          <span id={headingId}>{`${label} (${String(services.length)})`}</span>
        </Header>
        <ServiceLinks services={services} />
      </SpaceBetween>
    </section>
  );
}

interface IndexPageProps {
  /** The area's services, in label order; by default the build's. */
  services?: readonly Service[];
  /** The registry of screens, read for which service each screen is of; by default the build's. */
  screens?: readonly Pick<AreaScreen, 'service'>[];
}

/**
 * `/aws`, the area's index: EmuForge's description of the area, then the services, each to its page, told apart by
 * whether the registry holds a screen of them (issues 61 and 494). Calls nothing.
 */
export function IndexPage({ services = SERVICES, screens = SCREENS }: IndexPageProps) {
  const registered = new Set(screens.map(({ service }) => service));
  const withScreen = services.filter(({ route }) => registered.has(route));
  const withoutScreen = services.filter(({ route }) => !registered.has(route));
  const grouped = withScreen.length > 0 && withoutScreen.length > 0;
  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="EmuForge Studio works with a local emulator of AWS services. It is a stand-alone tool, not the AWS console and not an AWS feature."
        >
          {AWS_NAME}
        </Header>
      }
    >
      <Container
        header={
          <Header
            variant="h2"
            counter={`(${String(services.length)})`}
            description={screensStatement(withScreen.length, services.length)}
          >
            Services
          </Header>
        }
      >
        {grouped ? (
          <SpaceBetween size="l">
            <ServiceGroup label="With a Studio screen" services={withScreen} />
            <ServiceGroup label="No Studio screen yet" services={withoutScreen} />
          </SpaceBetween>
        ) : (
          <ServiceLinks services={services} />
        )}
      </Container>
    </ContentLayout>
  );
}
