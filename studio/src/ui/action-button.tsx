import './button.css';
import './action-button.css';

import type { ReactNode, Ref } from 'react';

import { BusyIcon } from './icons';

interface ActionButtonProps {
  children: ReactNode;
  /** The icon before the label; replaced by the spinning arc while `busy`. */
  icon?: ReactNode;
  /** The small size of a row's actions (DESIGN.md, Buttons). */
  small?: boolean;
  /** The page's one primary action. */
  primary?: boolean;
  /** `submit` sends the form the button is in; a `button` runs `onClick`. */
  type?: 'button' | 'submit';
  /**
   * Work this button started is in progress: it stays focusable and in the Tab order, says it is busy
   * (`aria-disabled`, `aria-busy`), and a choice of it does nothing until the work ends.
   */
  busy?: boolean;
  /**
   * The action cannot be taken here: the button stays focusable and in the Tab order, so its reason is found, says it
   * is unavailable (`aria-disabled`) and does nothing. Its reason is the element `describedBy` names.
   */
  unavailable?: boolean;
  /** The id of the text that describes the button: the reason it is unavailable. */
  describedBy?: string | undefined;
  /** The accessible name, when it says more than the visible label. */
  ariaLabel?: string;
  onClick?: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/**
 * A button of Studio's that can be busy or unavailable and still be found by keyboard: a row's action ("Test"), a
 * dialog's, a form's. Drawn as Studio's button; an unavailable one has a dashed edge and its text in `text-2`.
 */
export function ActionButton(props: ActionButtonProps) {
  const { children, icon, small = false, primary = false, type = 'button', busy = false, unavailable = false } = props;
  const { describedBy, ariaLabel, onClick, ref } = props;
  const className = ['st-btn', small ? 'small' : '', primary ? 'primary' : '', unavailable ? 'unavailable' : '']
    .filter((name) => name !== '')
    .join(' ');
  const inert = busy || unavailable;
  return (
    <button
      ref={ref}
      type={type}
      className={className}
      aria-label={ariaLabel}
      aria-describedby={describedBy}
      aria-disabled={inert ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      onClick={(event) => {
        if (inert) {
          event.preventDefault();
          return;
        }
        onClick?.();
      }}
    >
      {busy ? <BusyIcon /> : icon}
      {children}
    </button>
  );
}
