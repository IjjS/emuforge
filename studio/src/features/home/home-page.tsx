import Button from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { SERVICES } from '../../app/services';
import { useFollow } from '../../components/use-follow';

const SERVICE_COLUMNS = 3;
const SERVICES_PER_COLUMN = Math.ceil(SERVICES.length / SERVICE_COLUMNS);

/** Each column a contiguous run of the label-ordered list, so the order reads top to bottom, then across. */
const serviceColumns = Array.from({ length: SERVICE_COLUMNS }, (_, column) =>
  SERVICES.slice(column * SERVICES_PER_COLUMN, (column + 1) * SERVICES_PER_COLUMN),
);

function ServicesContainer() {
  const handleFollow = useFollow();
  return (
    <Container
      header={
        <Header variant="h2" counter={`(${String(SERVICES.length)})`} description="No service has a Studio screen yet.">
          Services
        </Header>
      }
    >
      <ColumnLayout columns={SERVICE_COLUMNS} variant="text-grid">
        {serviceColumns.map((column, index) => (
          <SpaceBetween size="xs" key={index}>
            {column.map(({ label, route }) => (
              <Link key={route} href={route} onFollow={handleFollow}>
                {label}
              </Link>
            ))}
          </SpaceBetween>
        ))}
      </ColumnLayout>
    </Container>
  );
}

/** Home (requirement 2.1): what Studio is, and the services it will cover. */
export function HomePage() {
  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="A local console for your AWS emulator, through the EmuForge engine."
          actions={<Button iconName="refresh">Refresh</Button>}
        >
          Home
        </Header>
      }
    >
      <SpaceBetween size="l">
        <ServicesContainer />
      </SpaceBetween>
    </ContentLayout>
  );
}
