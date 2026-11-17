import './break-anywhere.css';

import type { ReactNode } from 'react';

/** A value the user or the emulator gives, as text that breaks anywhere inside its box (R12). */
export function BreakAnywhere({ children }: { children: ReactNode }) {
  return <span className="aws-s3-break-anywhere">{children}</span>;
}
