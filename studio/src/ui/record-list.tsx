import './record-list.css';

import type { ReactNode } from 'react';

/** A list of records in its panel, a hairline between them: one row per thing, such as a connection. */
export function RecordList({ children }: { children: ReactNode }) {
  return <ul className="st-records">{children}</ul>;
}

/** One record: its fields, then what belongs to it (its actions, a result). */
export function Record({ children, marked = false }: { children: ReactNode; marked?: boolean }) {
  return <li className={marked ? 'st-record marked' : 'st-record'}>{children}</li>;
}

/** A record's fields side by side, each a label over its value; stacked at 640px and below. */
export function Fields({ children }: { children: ReactNode }) {
  return <dl className="st-fields">{children}</dl>;
}

/** One field: its label (a column's name) and its value. */
export function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? 'st-field-cell wide' : 'st-field-cell'}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
