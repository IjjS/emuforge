import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { ValueText } from '../../../components/value-text';
import type { Alarm } from '../alarm';
import { alarmStateText } from '../format';

export function AlarmActions({ alarm: { data } }: { alarm: Alarm }) {
  const actions = [
    { label: alarmStateText('ALARM'), arns: data.AlarmActions },
    { label: alarmStateText('OK'), arns: data.OKActions },
    { label: alarmStateText('INSUFFICIENT_DATA'), arns: data.InsufficientDataActions },
  ];

  return (
    <Container header={<Header variant="h2">Actions</Header>}>
      <KeyValuePairs
        columns={3}
        items={actions.map(({ label, arns }) => ({
          label,
          value: arns?.length ? (
            <SpaceBetween size="xxs">
              {arns.map((arn, index) => (
                <ValueText key={index} kind="address" value={arn} />
              ))}
            </SpaceBetween>
          ) : (
            'No actions'
          ),
        }))}
      />
    </Container>
  );
}
