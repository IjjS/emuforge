import { createElement, Fragment, useRef, useState } from 'react';

import { reportedServiceCode } from '../../../../../lib/aws/request';
import { actionFailureItem } from '../../components/failure-states';
import { usePageFlash } from '../../components/page-flash';
import { failureOf, usePageSignal } from '../../components/use-token-listing';
import type { useAlarm } from './alarm-queries';
import { AlarmName } from './components/alarm-name';
import { actionsSwitchOperation, setAlarmActions } from './try-api';

interface ActionsSwitchOptions {
  endpoint: string | undefined;
  name: string | undefined;
  actionsEnabled: boolean | undefined;
  refreshAlarm: ReturnType<typeof useAlarm>['refresh'];
  refreshHistory: () => void;
}

export function useActionsSwitch({
  endpoint,
  name,
  actionsEnabled,
  refreshAlarm,
  refreshHistory,
}: ActionsSwitchOptions) {
  const flash = usePageFlash();
  const pageSignal = usePageSignal();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [unsupported, setUnsupported] = useState<string[]>([]);
  const enable = !actionsEnabled;
  const operation = actionsSwitchOperation(enable);
  const unavailable = unsupported.includes(operation);
  const disabledReason = unavailable ? `Not implemented by the emulator (${operation}).` : undefined;

  const toggle = async () => {
    if (endpoint === undefined || name === undefined || unavailable || inFlight.current) return;
    const signal = pageSignal();
    inFlight.current = true;
    setPending(true);
    try {
      try {
        await setAlarmActions(endpoint, name, enable, signal);
      } catch (error) {
        if (signal.aborted) return;
        const refusal = failureOf(error, operation);
        if (refusal.kind === 'not-implemented') setUnsupported((previous) => [...previous, operation]);
        const item = actionFailureItem(refusal, operation, endpoint);
        const accessDeniedCode = refusal.kind === 'access-denied' ? reportedServiceCode(refusal) : undefined;
        if (accessDeniedCode) {
          item.content = createElement(Fragment, null, item.content, ` (${accessDeniedCode})`);
        }
        if (refusal.kind === 'emulator-did-not-answer' || refusal.kind === 'engine-did-not-answer') {
          item.content = createElement(Fragment, null, `${operation} failed. `, item.content);
        }
        flash.show([item]);
        return;
      }

      if (signal.aborted) return;
      const reread = refreshAlarm();
      refreshHistory();
      const result = await reread;
      if (signal.aborted || result === undefined) return;
      if ('failure' in result) {
        flash.show([
          {
            type: 'info',
            content: 'The request was accepted. The alarm could not be read again, so the change is not confirmed.',
          },
        ]);
        return;
      }

      const confirmed = result.value?.data.ActionsEnabled;
      if (confirmed === undefined) return;
      const direction = confirmed ? 'on' : 'off';
      const changed = confirmed === enable;
      flash.show([
        {
          type: changed ? 'success' : 'warning',
          content: createElement(
            Fragment,
            null,
            'Actions of ',
            createElement(AlarmName, { name }),
            changed ? ` turned ${direction}.` : ` are still ${direction}.`,
          ),
        },
      ]);
    } finally {
      inFlight.current = false;
      if (!signal.aborted) setPending(false);
    }
  };

  return { label: enable ? 'Turn actions on' : 'Turn actions off', pending, unavailable, disabledReason, toggle };
}
