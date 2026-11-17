import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import type { ButtonProps } from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useId, useRef, useSyncExternalStore, type RefObject } from 'react';

import { EmulatorLine, type AreaConnection } from './emulator-line';
import type { PageResources } from './page-resources';

/** The notice's region name and its close control's name (requirement R5.3). */
const NOTICE_NAME = 'Local emulator notice';
const CLOSE_NAME = 'Close the local emulator notice';

/** The notice's body, one text in every state of the connection (issue 467, R3). */
const BODY = 'They are not in an AWS account. EmuForge Studio is a stand-alone local tool, not an AWS feature.';

/** "These {resources} are in your local emulator", with the page's word or "resources" (R5.1). */
function heading(resources: PageResources): string {
  return `These ${resources.word ?? 'resources'} are in your local emulator`;
}

/**
 * Whether the notice is open, for the document's life (R5.3): closing it holds on every page of the area, leaving the
 * area and coming back included, until the document is reloaded, which evaluates this module afresh. Nothing is
 * stored. It is the area's own state; Studio's frame knows nothing of it.
 */
const noticeOpen = {
  open: true,
  listeners: new Set<() => void>(),
  subscribe(listener: () => void) {
    noticeOpen.listeners.add(listener);
    return () => {
      noticeOpen.listeners.delete(listener);
    };
  },
  get() {
    return noticeOpen.open;
  },
  set(open: boolean) {
    noticeOpen.open = open;
    for (const listener of noticeOpen.listeners) {
      listener();
    }
  },
};

interface LocalNoticeProps {
  id: string;
  resources: PageResources;
  alertRef: RefObject<AlertProps.Ref | null>;
  onDismiss: () => void;
}

/**
 * The local-emulator notice (R5.1 to R5.3): an informational Cloudscape `Alert` with its close control, in a region
 * named "Local emulator notice". It is the emulator line's own explanation, so its body is the same in every state
 * of the connection and writes no endpoint: the endpoint is written once on a page, in the line (issue 467, R3).
 */
function LocalNotice({ id, resources, alertRef, onDismiss }: LocalNoticeProps) {
  return (
    <div id={id} role="region" aria-label={NOTICE_NAME}>
      <Alert
        ref={alertRef}
        type="info"
        dismissible
        i18nStrings={{ dismissAriaLabel: CLOSE_NAME }}
        header={heading(resources)}
        onDismiss={onDismiss}
      >
        {BODY}
      </Alert>
    </div>
  );
}

/** Where focus goes once the notice has opened or closed: set by the control that did it, taken by the next effect. */
type FocusAfter = 'notice' | 'control' | null;

interface LineAndNoticeProps {
  connection: AreaConnection;
  /** What the page shows of the emulator, as it named it; `null` for a page that names none. */
  resources: PageResources | null;
}

/**
 * The emulator line and, for a page that names its resources, its (i) control and the local-emulator notice under it
 * (R5); a page that names none gets the line alone. The (i) control opens a closed notice and moves focus to it
 * (Cloudscape's `Alert` focus, with Cloudscape's own focus ring), or closes an open one, keeping focus on itself; the
 * notice's X closes it and moves focus to the (i) control (R5.4).
 */
export function EmulatorLineAndNotice({ connection, resources }: LineAndNoticeProps) {
  const open = useSyncExternalStore(noticeOpen.subscribe, noticeOpen.get);
  const noticeId = useId();
  const buttonRef = useRef<ButtonProps.Ref>(null);
  const alertRef = useRef<AlertProps.Ref>(null);
  const focusAfter = useRef<FocusAfter>(null);

  useEffect(() => {
    const target = focusAfter.current;
    focusAfter.current = null;
    if (target === 'notice') {
      alertRef.current?.focus();
    } else if (target === 'control') {
      buttonRef.current?.focus();
    }
  }, [open]);

  const handleToggle = useCallback(() => {
    focusAfter.current = noticeOpen.get() ? null : 'notice';
    noticeOpen.set(!noticeOpen.get());
  }, []);
  const handleDismiss = useCallback(() => {
    focusAfter.current = 'control';
    noticeOpen.set(false);
  }, []);

  if (resources === null) {
    return <EmulatorLine connection={connection} />;
  }
  return (
    <SpaceBetween size="xs">
      <EmulatorLine connection={connection} about={{ open, noticeId, onToggle: handleToggle }} aboutRef={buttonRef} />
      {open && (
        <LocalNotice
          id={noticeId}
          resources={resources}
          alertRef={alertRef}
          onDismiss={handleDismiss}
        />
      )}
    </SpaceBetween>
  );
}
