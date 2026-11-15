import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import ColumnLayout from '@cloudscape-design/components/column-layout';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { useCallback, useRef } from 'react';
import { SERVICES } from '../../providers/aws/services';
import { useFollow } from '../../providers/aws/area/components/use-follow';
import { ConnectionStatus } from './connection-status';
import { useConnectionCheck } from './use-connection-check';

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

/** The port this page was served from: Studio's port, which the engine must be started for. */
function studioPort(): number {
  const { port, protocol } = window.location;
  return port !== '' ? Number(port) : protocol === 'https:' ? 443 : 80;
}

/** Home (requirement 2.1): what Studio is, whether it reaches the engine and the emulator, and the services. */
export function HomePage() {
  const connection = useConnectionCheck();
  const refreshButton = useRef<ButtonProps.Ref>(null);
  const handleFocusLost = useCallback(() => {
    refreshButton.current?.focus();
  }, []);
  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          description="A local console for your AWS emulator, through the EmuForge engine."
          actions={
            <Button ref={refreshButton} iconName="refresh" loading={connection.checking} onClick={connection.refresh}>
              Refresh
            </Button>
          }
        >
          Home
        </Header>
      }
    >
      <SpaceBetween size="l">
        <ConnectionStatus
          result={connection.result}
          engineOrigin={connection.engineOrigin}
          enginePort={connection.enginePort}
          studioPort={studioPort()}
          refreshing={connection.checking}
          onRefresh={connection.refresh}
          onFocusLost={handleFocusLost}
        />
        <ServicesContainer />
      </SpaceBetween>
    </ContentLayout>
  );
}
