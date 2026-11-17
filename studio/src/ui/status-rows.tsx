import './status-rows.css';

import type { ReactNode } from 'react';

import { useLanguage } from '../i18n/language-context';
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
  /** The address the row is about, in the code font; `undefined` shows "-", read as "Not known" (its message). */
  address: string | undefined;
}

/** A port at the end of an address (`:65535`), split from the host before it. */
const PORT_AT_END = /^(.+)(:\d+)$/;

/**
 * An address as the row draws it, as code (literal text, in the code face): the host, a break point and the port, so a
 * line that cannot hold it all breaks before the port's ":" (DESIGN.md, Status rows). The `<wbr>` adds no text, so what
 * is read and copied is the address as it is; an address without a port at its end is drawn as it is.
 */
function Address({ address }: { address: string }) {
  const parts = PORT_AT_END.exec(address);
  if (parts === null) {
    return <code className="st-addr">{address}</code>;
  }
  const [, host, port] = parts;
  return (
    <code className="st-addr">
      {host}
      <wbr />
      {port}
    </code>
  );
}

/** One row: its label, the status's icon and word beside it, and the address under them. */
export function StatusRow({ label, kind, status, address }: StatusRowProps) {
  const { t } = useLanguage();
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
            <span className="st-sr">{t('status.notKnown')}</span>
          </span>
        ) : (
          <Address address={address} />
        )}
      </dd>
    </div>
  );
}

/** Rows side by side in their panel, a hairline between them; stacked, each in two lines, at 640px and below. */
export function StatusRows({ children }: { children: ReactNode }) {
  return <dl className="st-rows">{children}</dl>;
}
