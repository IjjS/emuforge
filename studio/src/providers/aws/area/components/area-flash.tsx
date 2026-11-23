import Flashbar, { type FlashbarProps } from '@cloudscape-design/components/flashbar';
import { useLayoutEffect, useRef } from 'react';

import type { FlashType } from './page-flash';
import type { HeldResult } from './use-area-flash';

/** The name of an item's dismiss control (issue 386, R5.4). */
const DISMISS_NAME = 'Dismiss';

/** The flash's own text for Cloudscape: the list's name and each type's icon. */
const FLASHBAR_STRINGS: FlashbarProps.I18nStrings = {
  ariaLabel: 'Notifications',
  successIconAriaLabel: 'Success',
  errorIconAriaLabel: 'Error',
  infoIconAriaLabel: 'Info',
  warningIconAriaLabel: 'Warning',
};

const TYPE_NAMES: Record<FlashType, string> = {
  success: 'Success',
  error: 'Error',
  info: 'Info',
  warning: 'Warning',
};

interface AreaFlashProps {
  result: HeldResult;
  onDismiss: (key: string) => void;
  /** Called once per result with what the status announcer says of its items that are not errors. */
  onAnnounce: (id: number, text: string) => void;
}

/**
 * The area's flash region (R5.1, R5.4): a Cloudscape `Flashbar` of the result's items in the order given, each with
 * its control "Dismiss" that removes it alone. An `error` item is an alert (Cloudscape's `ariaRole`) unless the
 * open dialog announces it. Every other
 * item is announced once by the area's status announcer (`FlashAnnouncer`), not by Cloudscape's own live region,
 * which Cloudscape appends to the document's `body`, outside the area's root. Header and content are rendered as the
 * page gave them, so text is text.
 */
export function AreaFlash({ result, onDismiss, onAnnounce }: AreaFlashProps) {
  const region = useRef<HTMLDivElement>(null);
  const { id } = result;
  // Once, when the result is first shown: each item that is not an error, as it was rendered (R5.4).
  useLayoutEffect(() => {
    const said = result.items
      .filter(({ item }) => item.type !== 'error')
      .map(({ key, item }) => {
        const element = region.current?.querySelector(`[data-itemid="${key}"]`);
        const parts = [...(element?.querySelectorAll('[data-flash-text]') ?? [])].map((part) =>
          part.textContent.trim(),
        );
        return [TYPE_NAMES[item.type], ...parts].filter((text) => text !== '').join(' ');
      });
    onAnnounce(id, said.join(' '));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announced once per result, not again on a dismissal
  }, [id]);

  const items = result.items.map(({ key, item }): FlashbarProps.MessageDefinition => ({
    id: key,
    type: item.type,
    statusIconAriaLabel: TYPE_NAMES[item.type],
    ...(item.header !== undefined && { header: <span data-flash-text="">{item.header}</span> }),
    content: <span data-flash-text="">{item.content}</span>,
    ...(item.type === 'error' && !item.announcedInDialog && { ariaRole: 'alert' as const }),
    dismissible: true,
    dismissLabel: DISMISS_NAME,
    onDismiss: () => {
      onDismiss(key);
    },
  }));
  return (
    <div ref={region}>
      <Flashbar items={items} i18nStrings={FLASHBAR_STRINGS} />
    </div>
  );
}

/**
 * The area's status announcer for the flash: a polite, atomic live region of the area's own, there on every page so
 * that what is put into it is heard (a live region added with its text is not reliably read). It is visually hidden,
 * holds no control and no landmark, and says each result's items that are not errors once, when the result appears;
 * it is empty while no result is shown.
 */
export function FlashAnnouncer({ announcement }: { announcement: { id: number; text: string } }) {
  return (
    <div className="aws-area-flash-announcer" role="status" aria-atomic="true">
      {announcement.text !== '' && <span key={announcement.id}>{announcement.text}</span>}
    </div>
  );
}
