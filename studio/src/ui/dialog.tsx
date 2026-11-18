import './dialog.css';

import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { CrossIcon } from './icons';

interface DialogProps {
  /** The dialog's heading, which names it. */
  title: string;
  /** The accessible name of the close control in the corner ("Close"). */
  closeLabel: string;
  /** Called by the close control and by Escape. Whoever opened the dialog puts focus back. */
  onClose: () => void;
  /** The element focused when the dialog opens; the first focusable one inside it by default. */
  initialFocus?: RefObject<HTMLElement | null>;
  /** The dialog's text. */
  children: ReactNode;
  /** Its buttons, at the end. */
  actions: ReactNode;
}

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * A modal dialog of Studio's (DESIGN.md, Dialogs): a panel over a veil, named by its heading and described by its
 * text, holding focus while it is open. Tab and Shift+Tab stay inside it; Escape and the close control close it.
 */
export function Dialog({ title, closeLabel, onClose, initialFocus, children, actions }: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const first = initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    // Focus is placed once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab' || box.current === null) {
      return;
    }
    const focusable = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (first === undefined || last === undefined) {
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="st-dialog-veil">
      <div
        ref={box}
        className="st-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={handleKeyDown}
      >
        <div className="st-dialog-head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="st-dialog-close" aria-label={closeLabel} onClick={onClose}>
            <CrossIcon />
          </button>
        </div>
        <div id={bodyId} className="st-dialog-body">
          {children}
        </div>
        <div className="st-dialog-actions">{actions}</div>
      </div>
    </div>
  );
}
