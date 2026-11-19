import '../styles/emulator-line.css';

import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator, { type StatusIndicatorProps } from '@cloudscape-design/components/status-indicator';
import { use, useId, useState, type Ref } from 'react';

import { targetOf, type CheckResult } from '../../../../lib/engine/engine-client';
import { TargetChangeFlashContext } from './target-change-flash';
import { useFollow } from './use-follow';

/** The connection Studio hands the area (Studio's `ProviderConnection`; the area imports nothing of Studio's own). */
export interface AreaConnection {
  /** The answer to the latest completed check; `undefined` before the first answer. */
  result: CheckResult | undefined;
  /** The engine's address the page is configured with; `undefined` until known. */
  engineOrigin: string | undefined;
}

/**
 * The (i) control at the line's end, on a page that carries the local-emulator notice (requirement R5.4): whether
 * the notice is open, the notice's id for `aria-controls` while it is on the page, and what the control does.
 */
export interface AboutControl {
  open: boolean;
  noticeId: string;
  onToggle: () => void;
}

/** The (i) control's accessible name (R5.4). */
export const ABOUT_NAME = 'About the local emulator';

/** The word before the target's name, the line's part of its own after the status (issue 486, R2). */
export const TARGET_WORD = 'Target';

/** The line's constant label, the same in every state (requirement R4.2). */
export const LINE_LABEL = 'Local emulator, not AWS';

/** The status of one state: its words around one value the engine reported, which is shown as code. */
interface LineStatus {
  type: StatusIndicatorProps.Type;
  before: string;
  value?: string;
  after?: string;
  /** The line ends with "Connection status" (R4.3). */
  recovery: boolean;
}

const CHECKING: LineStatus = { type: 'loading', before: 'Checking', recovery: false };

/** The status of requirement R4.2 for the latest answer: every value from the answer or the page's configuration. */
function lineStatus({ result, engineOrigin }: AreaConnection): LineStatus {
  switch (result?.kind) {
    case undefined:
      return CHECKING;
    case 'connected':
      return { type: 'success', before: 'Connected at ', value: result.emulator.endpoint, recovery: false };
    case 'emulator-unreachable':
      return result.reason === 'not_started'
        ? { type: 'stopped', before: 'Not started on port ', value: String(result.emulator.port), recovery: true }
        : { type: 'error', before: 'Not answering at ', value: result.emulator.endpoint, recovery: true };
    case 'engine-unreachable':
      // An answer comes only from a client of a known engine, so its origin is known by then.
      return engineOrigin === undefined
        ? CHECKING
        : {
            type: 'error',
            before: 'The EmuForge engine at ',
            value: engineOrigin,
            after: ' is not answering',
            recovery: true,
          };
    case 'engine-error':
      return result.code === undefined
        ? {
            type: 'error',
            before: 'The EmuForge engine answered with HTTP status ',
            value: String(result.status),
            recovery: true,
          }
        : { type: 'error', before: 'The EmuForge engine answered with an error: ', value: result.code, recovery: true };
  }
}

function statusText(status: LineStatus): string {
  return `${status.before}${status.value ?? ''}${status.after ?? ''}`;
}

/** What the line shows and says of one answer: its status and, from an answer of the emulator, the target it named. */
interface LineState {
  status: LineStatus;
  target: string | undefined;
}

/**
 * The whole line as it is read: the status, then, as a sentence of its own, "Target" and the name when the answer
 * named one.
 */
function lineText({ status, target }: LineState): string {
  const text = statusText(status);
  return target === undefined ? text : `${text}. ${TARGET_WORD} ${target}`;
}

/**
 * Whether `next` differs from `seen` by a change of target that keeps the kind of status (issue 486, R2): the area's
 * flash announces that change once, so the line says nothing of it, though the endpoint or port in its status follow
 * the new target. A change of the kind of status (connected, not started, not answering) is announced as before.
 */
function isTargetChangeAlone(seen: LineState, next: LineState): boolean {
  return (
    seen.target !== undefined &&
    next.target !== undefined &&
    seen.target !== next.target &&
    seen.status.type === next.status.type
  );
}

/**
 * What the live region says (R4.5): the label and the whole line of a change of state, kept from the previous render
 * as React's own pattern for it. The state the line opened with says nothing; a later state that differs says itself,
 * except a first answer that is connected after "Checking" and, on a page whose flash announces it, a change of target
 * alone (`isTargetChangeAlone`); the same state again says nothing new.
 */
function useAnnouncement(state: LineState, flashCarriesTarget: boolean): string {
  const text = lineText(state);
  const [seen, setSeen] = useState({ state, text, announcement: '' });
  if (seen.text === text) {
    return seen.announcement;
  }
  const quiet =
    (statusText(seen.state.status) === statusText(CHECKING) && state.status.type === 'success') ||
    (flashCarriesTarget && isTargetChangeAlone(seen.state, state));
  const next = { state, text, announcement: quiet ? seen.announcement : text };
  setSeen(next);
  return next.announcement;
}

interface EmulatorLineProps {
  connection: AreaConnection;
  /** The (i) control, on a page that carries the notice; none on a page that shows no resources. */
  about?: AboutControl | undefined;
  /** The (i) control's button, for the notice to move focus to it. */
  aboutRef?: Ref<ButtonProps.Ref> | undefined;
}

/**
 * The emulator line (requirement R4): on every page of the area, inside the content target before the page's `h1`,
 * the constant label "Local emulator, not AWS" and the connection's state as Studio last read it, then, in a state that
 * comes from the emulator's answer, "Target" and the target's name as a part of its own (issue 486, R2), and in a
 * state that needs it the link "Connection status" to Home. It has no control that closes or hides it. The group is named by
 * its visible label; a change of state is announced once in a polite, atomic live region beside it that holds the
 * label, the status and the target, never the link. Every value is rendered as text. On a page that carries the notice the line
 * ends with the (i) control, kept a wider gap apart from "Connection status" so it does not read as help for the link.
 */
export function EmulatorLine({ connection, about, aboutRef }: EmulatorLineProps) {
  const handleFollow = useFollow();
  const labelId = useId();
  const status = lineStatus(connection);
  // Only a state that comes from the emulator's answer names the target; an engine state names none.
  const target = connection.result === undefined || status === CHECKING ? undefined : targetOf(connection.result);
  const announcement = useAnnouncement({ status, target }, use(TargetChangeFlashContext));
  const state = (
    <SpaceBetween direction="horizontal" size="xs" alignItems="center">
      <span id={labelId}>
        <Box variant="strong">{LINE_LABEL}</Box>
      </span>
      <StatusIndicator type={status.type}>
        {status.before}
        {status.value !== undefined && (
          <Box variant="code" display="inline">
            {status.value}
          </Box>
        )}
        {status.after}
      </StatusIndicator>
      {target !== undefined && (
        <Box variant="span" className="aws-area-emulator-target">
          {TARGET_WORD}{' '}
          <Box variant="code" display="inline">
            {target}
          </Box>
        </Box>
      )}
      {status.recovery && (
        <Link href="/" onFollow={handleFollow}>
          Connection status
        </Link>
      )}
    </SpaceBetween>
  );
  return (
    <div className="aws-area-emulator-line">
      <div role="group" aria-labelledby={labelId}>
        {about === undefined ? (
          state
        ) : (
          <SpaceBetween direction="horizontal" size="m" alignItems="center">
            {state}
            <Button
              ref={aboutRef}
              variant="icon"
              iconName="status-info"
              ariaLabel={ABOUT_NAME}
              ariaExpanded={about.open}
              {...(about.open && { ariaControls: about.noticeId })}
              onClick={about.onToggle}
            />
          </SpaceBetween>
        )}
      </div>
      <div className="aws-area-announcer" aria-live="polite" aria-atomic="true">
        {announcement !== '' && (
          <>
            <span>{LINE_LABEL}</span> <span>{announcement}</span>
          </>
        )}
      </div>
    </div>
  );
}
