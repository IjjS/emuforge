import './button.css';

import type { ReactNode, Ref } from 'react';

import { BusyIcon } from './icons';

interface ButtonProps {
  children: ReactNode;
  /** The icon before the label; replaced by the spinning arc while `busy`. */
  icon?: ReactNode;
  /** The small size of copy buttons and a notice's action (DESIGN.md, Buttons). */
  small?: boolean;
  /**
   * Work this button started is in progress: the button stays focusable and in the Tab order, says it is busy
   * (`aria-disabled`, `aria-busy`), and a choice of it does nothing until the work ends.
   */
  busy?: boolean;
  /** The outcome of the button's last action, drawn on its text and edge: `done` in `ok`, `failed` in `err`. */
  tone?: 'done' | 'failed' | undefined;
  /** The accessible name, when it says more than the visible label (which it then begins with). */
  ariaLabel?: string;
  onClick: () => void;
  ref?: Ref<HTMLButtonElement>;
}

/** Studio's button: a sunk fill and a 3:1 edge, so it reads as a control next to text. */
export function Button({ children, icon, small = false, busy = false, tone, ariaLabel, onClick, ref }: ButtonProps) {
  const className = ['st-btn', small ? 'small' : '', tone ?? ''].filter((name) => name !== '').join(' ');
  const handleClick = () => {
    if (!busy) {
      onClick();
    }
  };
  return (
    <button
      ref={ref}
      type="button"
      className={className}
      aria-label={ariaLabel}
      aria-disabled={busy ? 'true' : undefined}
      aria-busy={busy ? 'true' : undefined}
      onClick={handleClick}
    >
      {busy ? <BusyIcon /> : icon}
      {children}
    </button>
  );
}
