import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useRef } from 'react';

import type { AreaConnection } from '../../../../components/emulator-line';
import { Grants } from './grants';
import { KeyPolicy } from './key-policy';

export interface AccessProps {
  connection: AreaConnection;
  keyId: string;
  writesEnabled?: boolean;
}

export function Access({ connection, keyId, writesEnabled = true }: AccessProps) {
  const grants = useRef<HTMLDivElement>(null);
  return (
    <SpaceBetween key={JSON.stringify([connection.engineOrigin, keyId])} size="l">
      <Link
        href="#kms-grants"
        onFollow={(event) => {
          const section = grants.current;
          if (section === null) return;
          event.preventDefault();
          section.focus({ preventScroll: true });
          section.scrollIntoView({ block: 'start' });
        }}
      >
        Jump to grants
      </Link>
      <KeyPolicy connection={connection} keyId={keyId} writesEnabled={writesEnabled} />
      <Grants connection={connection} keyId={keyId} writesEnabled={writesEnabled} sectionRef={grants} />
    </SpaceBetween>
  );
}
