import type { DescribeRuleResponse } from '@aws-sdk/client-eventbridge';
import Box from '@cloudscape-design/components/box';
import Container from '@cloudscape-design/components/container';
import Header from '@cloudscape-design/components/header';
import KeyValuePairs from '@cloudscape-design/components/key-value-pairs';
import Link from '@cloudscape-design/components/link';
import SpaceBetween from '@cloudscape-design/components/space-between';

import { CopyValue } from '../../../components/copy-value';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import { busPath, ruleStateText } from '../format';

export function RuleDetails({ rule, bus }: { rule: DescribeRuleResponse; bus: string }) {
  const handleFollow = useFollow();
  const busName = rule.EventBusName ?? bus;
  return (
    <Container header={<Header variant="h2">Details</Header>}>
      <SpaceBetween size="m">
        <KeyValuePairs
          items={[
            { label: 'ARN', value: <CopyValue label="ARN" value={rule.Arn} none="-" /> },
            ...(rule.RoleArn
              ? [{ label: 'Role ARN', value: <CopyValue label="Role ARN" value={rule.RoleArn} /> }]
              : []),
          ]}
        />
        <KeyValuePairs
          columns={2}
          items={[
            {
              label: 'Event bus',
              value: (
                <Link href={busPath(busName)} onFollow={handleFollow}>
                  <ValueText kind="name" value={busName} />
                </Link>
              ),
            },
            { label: 'State', value: <ValueText kind="fixed" value={ruleStateText(rule.State)} /> },
            { label: 'Description', value: <ValueText kind="text" value={rule.Description} none="-" /> },
            ...(rule.ScheduleExpression === undefined
              ? []
              : [
                  {
                    label: 'Schedule expression',
                    value: <ValueText kind="text" value={rule.ScheduleExpression} />,
                  },
                ]),
          ]}
        />
        {rule.EventPattern !== undefined && (
          <KeyValuePairs
            items={[
              {
                label: 'Event pattern',
                value: (
                  <Box
                    variant="pre"
                    margin={{ top: 'n', bottom: 'n' }}
                    nativeAttributes={{ style: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' } }}
                  >
                    {rule.EventPattern}
                  </Box>
                ),
              },
            ]}
          />
        )}
      </SpaceBetween>
    </Container>
  );
}
