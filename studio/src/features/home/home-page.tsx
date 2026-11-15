import { useCallback, useRef } from 'react';

import { PROVIDERS } from '../../app/provider-list';
import { useLanguage } from '../../i18n/language-context';
import { Button } from '../../ui/button';
import { RefreshIcon } from '../../ui/icons';
import { PageHead } from '../../ui/page-head';
import { ConnectionStatus } from './connection-status';
import { ProvidersSection } from './providers-section';
import { useConnectionCheck } from './use-connection-check';

/** The port this page was served from: Studio's port, which the engine must be started for. */
function studioPort(): number {
  const { port, protocol } = window.location;
  return port !== '' ? Number(port) : protocol === 'https:' ? 443 : 80;
}

/**
 * Home (requirement R4.6): what Studio is and its "Refresh", whether it reaches the engine and the emulator, and the
 * providers Studio has, from the providers list.
 */
export function HomePage() {
  const { t } = useLanguage();
  const connection = useConnectionCheck();
  const refreshButton = useRef<HTMLButtonElement>(null);
  const handleFocusLost = useCallback(() => {
    refreshButton.current?.focus();
  }, []);
  return (
    <>
      <PageHead
        title={t('home.title')}
        description={t('home.description')}
        actions={
          <Button ref={refreshButton} icon={<RefreshIcon />} busy={connection.checking} onClick={connection.refresh}>
            {t('home.refresh')}
          </Button>
        }
      />
      <ConnectionStatus
        result={connection.result}
        engineOrigin={connection.engineOrigin}
        enginePort={connection.enginePort}
        studioPort={studioPort()}
        refreshing={connection.checking}
        onRefresh={connection.refresh}
        onFocusLost={handleFocusLost}
      />
      <ProvidersSection providers={PROVIDERS} />
    </>
  );
}
