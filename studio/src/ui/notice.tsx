import './notice.css';

import type { ReactNode } from 'react';

import { InfoIcon, WarningIcon } from './icons';

interface NoticeProps {
  /** Error (`err-wash`, a triangle) or information (`info-wash`, a circled i). */
  kind: 'err' | 'info';
  /** The notice's heading, an `h3`. */
  title: string;
  /** One small button at the heading's end. */
  action?: ReactNode;
  children: ReactNode;
}

/**
 * A band across its panel, under what it is about: an icon column, the heading with its optional action, then the
 * body. It is neither a live region nor a group labelled by its own heading, so its title is read once; whatever
 * announces the change that brought it says so in its own words.
 */
export function Notice({ kind, title, action, children }: NoticeProps) {
  const Icon = kind === 'err' ? WarningIcon : InfoIcon;
  return (
    <div className={`st-notice ${kind}`}>
      <Icon />
      <div className="st-notice-body">
        <div className="st-notice-head">
          <h3>
            <Icon />
            {title}
          </h3>
          {action}
        </div>
        {children}
      </div>
    </div>
  );
}
