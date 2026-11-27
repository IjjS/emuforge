import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import StatusIndicator from '@cloudscape-design/components/status-indicator';

import { CopyValue } from '../../../components/copy-value';
import { creationDateText } from '../../../components/format-date';
import { ValueText } from '../../../components/value-text';
import type { Alarm } from '../alarm';
import { actionsEnabledText, alarmStateText, alarmTypeText } from '../format';
import { AlarmName } from './alarm-name';

const STATE_INDICATORS = { OK: 'success', ALARM: 'error', INSUFFICIENT_DATA: 'pending' } as const;

export function AlarmSummary({ alarm: { data, type } }: { alarm: Alarm }) {
  const state = data.StateValue;
  const indicator = state === undefined ? undefined : STATE_INDICATORS[state];

  return (
    <Container header={<Header variant="h2">Summary</Header>}>
      <KeyValuePairs
        columns={2}
        items={[
          { label: 'Name', value: data.AlarmName ? <AlarmName name={data.AlarmName} copy /> : '-' },
          {
            label: 'State',
            value:
              indicator === undefined ? (
                <ValueText kind="fixed" value={alarmStateText(state)} />
              ) : (
                <StatusIndicator type={indicator}>{alarmStateText(state)}</StatusIndicator>
              ),
          },
          { label: 'ARN', value: <CopyValue label="ARN" value={data.AlarmArn} none="-" /> },
          { label: 'State reason', value: <ValueText kind="text" value={data.StateReason} none="-" /> },
          { label: 'Type', value: <ValueText kind="fixed" value={alarmTypeText(type)} /> },
          {
            label: 'State last changed',
            value: <ValueText kind="fixed" value={creationDateText(data.StateTransitionedTimestamp)} />,
          },
          { label: 'Description', value: <ValueText kind="text" value={data.AlarmDescription} none="-" /> },
          { label: 'Actions', value: <ValueText kind="fixed" value={actionsEnabledText(data.ActionsEnabled)} /> },
        ]}
      />
    </Container>
  );
}
