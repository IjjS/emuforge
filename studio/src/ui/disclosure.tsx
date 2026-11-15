import './disclosure.css';

import { useId, useState, type ReactNode } from 'react';

import { ChevronIcon } from './icons';

interface DisclosureProps {
  /** The toggle's text. */
  summary: string;
  /** Shown only while open; not in the page while closed. */
  children: ReactNode;
}

/** A toggle that shows or hides what lies under it, collapsed at first; its chevron turns when open. */
export function Disclosure({ summary, children }: DisclosureProps) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const handleToggle = () => {
    setOpen((was) => !was);
  };
  return (
    <div className={open ? 'st-disclosure open' : 'st-disclosure'}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={handleToggle}>
        <ChevronIcon />
        {summary}
      </button>
      <div id={id} hidden={!open}>
        {open && children}
      </div>
    </div>
  );
}
