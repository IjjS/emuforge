import './dialog.css';

import {
  useEffect,
  useId,
  useRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { CrossIcon } from './icons';

interface DialogProps {
  /** The dialog's heading, which names it. */
  title: string;
  /** The accessible name of the close control in the corner ("Close"). */
  closeLabel: string;
  /**
   * Called by the close control, by Escape and by a press on the veil. Whoever opened the dialog puts focus back, once
   * the dialog is gone: until then the rest of the document is inert.
   */
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
 * Makes every element of the document outside `kept` inert, but `kept`'s own ancestors: the siblings of `kept` and of
 * each ancestor up to `body`. Returns what undoes it; an element already inert is left as it was.
 */
function inertAround(kept: Element): () => void {
  const made: Element[] = [];
  for (let node: Element = kept; node !== document.body && node.parentElement !== null; node = node.parentElement) {
    for (const sibling of node.parentElement.children) {
      if (sibling !== node && !sibling.hasAttribute('inert')) {
        sibling.setAttribute('inert', '');
        made.push(sibling);
      }
    }
  }
  return () => {
    for (const element of made) {
      element.removeAttribute('inert');
    }
  };
}

/**
 * A modal dialog of Studio's (DESIGN.md, Dialogs): a panel over a veil, named by its heading and described by its
 * text, holding focus while it is open, for the keyboard and the pointer alike. Everything else of the document is
 * inert meanwhile (the bar, the page under the veil), so neither a press nor Tab reaches it. Tab and Shift+Tab stay
 * inside; Escape, wherever focus is, the close control and a press on the veil close it.
 */
export function Dialog({ title, closeLabel, onClose, initialFocus, children, actions }: DialogProps) {
  const id = useId();
  const titleId = `${id}-title`;
  const bodyId = `${id}-body`;
  const veil = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const undo = veil.current === null ? () => undefined : inertAround(veil.current);
    const first = initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close.current();
      }
    };
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('keydown', handleEscape);
      undo();
    };
    // The document is made inert and focus placed once, when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** A press on the veil, outside the panel, is a "Cancel"; focus never leaves the dialog for the page under it. */
  const handleVeilPress = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      event.preventDefault();
      close.current();
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
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
    <div ref={veil} className="st-dialog-veil" onMouseDown={handleVeilPress}>
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
