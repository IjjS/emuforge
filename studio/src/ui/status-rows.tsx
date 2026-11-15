import './status-rows.css';

import type { ReactNode } from 'react';

import { ClockIcon, ConnectedIcon, FailedIcon, IdleIcon } from './icons';

/** A status's hue and icon (DESIGN.md, Status rows): ok, failed, idle (not started, unknown) or waiting (checking). */
export type StatusKind = 'ok' | 'err' | 'idle' | 'wait';

const ICONS: Record<StatusKind, () => ReactNode> = {
  ok: ConnectedIcon,
  err: FailedIcon,
  idle: IdleIcon,
  wait: ClockIcon,
};

interface StatusRowProps {
  label: string;
  kind: StatusKind;
  /** The status word ("Connected"). */
  status: string;
  /** The address the row is about, in the code font; `undefined` shows "-", read as "Not known". */
  address: string | undefined;
}

/** One row: its label, the status's icon and word, and the address under them. */
export function StatusRow({ label, kind, status, address }: StatusRowProps) {
  const Icon = ICONS[kind];
  return (
    <div className="st-row">
      <dt>{label}</dt>
      <dd>
        <span className={`st-status ${kind}`}>
          <Icon />
          {status}
        </span>
        {address === undefined ? (
          <span className="st-addr none">
            <span aria-hidden="true">-</span>
            <span className="st-sr">Not known</span>
          </span>
        ) : (
          <span className="st-addr">{address}</span>
        )}
      </dd>
    </div>
  );
}

/** Rows side by side in their panel, a hairline between them; stacked and compact below 640px. */
export function StatusRows({ children }: { children: ReactNode }) {
  return <dl className="st-rows">{children}</dl>;
}
