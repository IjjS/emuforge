import { useEffect, useRef, useState, type ReactNode } from 'react';

import { useLanguage } from '../../i18n/language-context';
import { Button } from '../../ui/button';
import { Command } from '../../ui/command';
import { CheckIcon, CopyIcon, CrossIcon } from '../../ui/icons';
import { COPY_SAID, useAnnounceCopy, type CopyOutcome } from './copy-context';
import { COPY_SAID_MS } from './copy-region';

interface CommandBlockProps {
  /** What the command does, shown above it. */
  label: ReactNode;
  /** A short name for the command in the copy button's and the group's accessible names, in the current language. */
  name: string;
  /** The command exactly as shown and copied. */
  command: string;
}

/** Writes `text` to the clipboard; `false` when the browser has no clipboard or refuses the write. */
async function copyText(text: string): Promise<boolean> {
  // A browser may offer no clipboard at all (an insecure origin, an old engine).
  const clipboard = (navigator as Partial<Navigator>).clipboard;
  if (clipboard === undefined) {
    return false;
  }
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * One command to copy: its label and a "Copy" button on one line, the command under it. The outcome shows on the
 * button for a short while and is announced by the section's copy region; the button's label stays "Copy".
 */
export function CommandBlock({ label, name, command }: CommandBlockProps) {
  const { t } = useLanguage();
  const announce = useAnnounceCopy();
  const [outcome, setOutcome] = useState<CopyOutcome>();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(
    () => () => {
      clearTimeout(timer.current);
    },
    [],
  );
  const handleCopy = () => {
    void copyText(command).then((copied) => {
      const now: CopyOutcome = copied ? 'done' : 'failed';
      clearTimeout(timer.current);
      setOutcome(now);
      announce(now);
      timer.current = setTimeout(() => {
        setOutcome(undefined);
      }, COPY_SAID_MS);
    });
  };
  const icon = outcome === 'done' ? <CheckIcon /> : outcome === 'failed' ? <CrossIcon /> : <CopyIcon />;
  return (
    <Command
      label={label}
      name={name}
      command={command}
      control={
        <span className="st-copy">
          {outcome !== undefined && (
            <span className={outcome === 'failed' ? 'st-copy-said failed' : 'st-copy-said'} aria-hidden="true">
              {t(COPY_SAID[outcome])}
            </span>
          )}
          <Button small icon={icon} tone={outcome} ariaLabel={t('copy.name', { name })} onClick={handleCopy}>
            {t('copy.label')}
          </Button>
        </span>
      }
    />
  );
}
