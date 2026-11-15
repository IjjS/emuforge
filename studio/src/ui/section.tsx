import './section.css';

import { useId, type ReactNode } from 'react';

interface SectionProps {
  /** The section's `h2`, which names its region. */
  title: string;
  /** A count beside the title, as `(1)`; part of the heading. */
  counter?: string;
  /** One small line beside the heading, which describes the region ("Last checked 16:05:12."). */
  meta?: ReactNode;
  children: ReactNode;
}

/** A section of a Studio page: a region named by its `h2`, with an optional counter and meta line, then its panels. */
export function Section({ title, counter, meta, children }: SectionProps) {
  const id = useId();
  const headingId = `${id}-heading`;
  const metaId = `${id}-meta`;
  return (
    <section
      className="st-section"
      aria-labelledby={headingId}
      aria-describedby={meta === undefined ? undefined : metaId}
    >
      <div className="st-section-head">
        <h2 id={headingId}>
          {title}
          {counter !== undefined && (
            <>
              {' '}
              <span className="st-count">{counter}</span>
            </>
          )}
        </h2>
        {meta !== undefined && (
          <p id={metaId} className="st-meta">
            {meta}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}

/** A raised panel: `surface`, a hairline edge, 14px corners that clip what lies inside. */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className === undefined ? 'st-panel' : `st-panel ${className}`}>{children}</div>;
}
