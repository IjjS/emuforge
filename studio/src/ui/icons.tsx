// Studio's icons (DESIGN.md, Shapes): 24-unit line icons, a 1.8 stroke with round caps and joins, `currentColor`,
// hidden from screen readers. The word next to an icon carries its meaning.

import type { ReactNode } from 'react';

interface IconProps {
  size: number;
  className?: string;
  children: ReactNode;
}

function Icon({ size, className, children }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <Icon size={16}>
      <path d="M20 11a8 8 0 0 0-14.3-4.9L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.3 4.9L20 16" />
      <path d="M20 20v-4h-4" />
    </Icon>
  );
}

/** The busy arc; it spins, and stops under `prefers-reduced-motion`. */
export function BusyIcon() {
  return (
    <Icon size={16} className="st-spin">
      <path d="M12 3a9 9 0 1 0 9 9" />
    </Icon>
  );
}

export function ConnectedIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="9" fill="currentColor" stroke="none" />
      <path d="m8 12.5 2.7 2.7L16.2 9.5" stroke="var(--st-surface)" strokeWidth="2.2" />
    </Icon>
  );
}

export function FailedIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6M15 9l-6 6" />
    </Icon>
  );
}

export function IdleIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="8.5" />
    </Icon>
  );
}

export function ClockIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function CheckIcon() {
  return (
    <Icon size={15}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  );
}

export function CrossIcon() {
  return (
    <Icon size={15}>
      <path d="m7 7 10 10M17 7 7 17" />
    </Icon>
  );
}

export function InfoIcon() {
  return (
    <Icon size={20}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5" />
      <path d="M12 7.5h.01" strokeWidth="2.6" />
    </Icon>
  );
}

export function WarningIcon() {
  return (
    <Icon size={20}>
      <path d="M12 3.5 21.5 20h-19z" />
      <path d="M12 10v4.5" />
      <path d="M12 17.2h.01" strokeWidth="2.6" />
    </Icon>
  );
}

export function CopyIcon() {
  return (
    <Icon size={15}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
    </Icon>
  );
}

export function ChevronIcon() {
  return (
    <Icon size={16}>
      <path d="m9 6 6 6-6 6" />
    </Icon>
  );
}

export function ArrowIcon() {
  return (
    <Icon size={18}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  );
}

/** The language control's globe (DESIGN.md, The frame): the control's only mark at 480 wide and below. */
export function GlobeIcon() {
  return (
    <Icon size={18}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </Icon>
  );
}

/** The sign that a control opens a menu below it; it turns while the menu is open. */
export function ExpandIcon({ className }: { className: string }) {
  return (
    <Icon size={14} className={className}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}
