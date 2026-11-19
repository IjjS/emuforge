import './status-rows.css';
import './status-line.css';

import type { ReactNode } from 'react';

import { ClockIcon, ConnectedIcon, FailedIcon, IdleIcon } from './icons';
import type { StatusKind } from './status-rows';

const ICONS: Record<StatusKind, () => ReactNode> = {
  ok: ConnectedIcon,
  err: FailedIcon,
  idle: IdleIcon,
  wait: ClockIcon,
};

interface StatusLineProps {
  kind: StatusKind;
  /** The status word ("Connected"). */
  status: string;
  /** What the status is about, under the word in `text-2` (the engine's message, as text). */
  children?: ReactNode;
  /** The small size of a list of checks. */
  small?: boolean;
}

/** A status on its own, as the status rows draw it (its icon and word in its hue), with a message under it. */
export function StatusLine({ kind, status, children, small = false }: StatusLineProps) {
  const Icon = ICONS[kind];
  return (
    <div className={small ? 'st-status-line small' : 'st-status-line'}>
      <span className={`st-status ${kind}`}>
        <Icon />
        {status}
      </span>
      {children !== undefined && <div className="st-status-message">{children}</div>}
    </div>
  );
}
