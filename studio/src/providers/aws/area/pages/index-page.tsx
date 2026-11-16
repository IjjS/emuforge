import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { AWS_NAME, servicePath } from '../../identity';
import { SERVICES } from '../../services';
import { useFollow } from '../components/use-follow';

const SERVICE_COLUMNS = 3;
const SERVICES_PER_COLUMN = Math.ceil(SERVICES.length / SERVICE_COLUMNS);

/** Each column a contiguous run of the label-ordered list, so the order reads top to bottom, then across. */
const serviceColumns = Array.from({ length: SERVICE_COLUMNS }, (_, column) =>
  SERVICES.slice(column * SERVICES_PER_COLUMN, (column + 1) * SERVICES_PER_COLUMN),
);

/** `/aws`, the area's index: EmuForge's description of the area, then the services, each to its page. Calls nothing. */
export function IndexPage() {
  const handleFollow = useFollow();
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
            counter={`(${String(SERVICES.length)})`}
            description="No service has a Studio screen yet."
          >
            Services
          </Header>
        }
      >
        <ColumnLayout columns={SERVICE_COLUMNS} variant="text-grid">
          {serviceColumns.map((column, index) => (
            <SpaceBetween size="xs" key={index}>
              {column.map((service) => (
                <Link key={service.route} href={servicePath(service)} onFollow={handleFollow}>
                  {service.label}
                </Link>
              ))}
            </SpaceBetween>
          ))}
        </ColumnLayout>
      </Container>
    </ContentLayout>
  );
}
