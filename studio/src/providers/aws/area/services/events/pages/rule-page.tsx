import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect } from 'react';

import { readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { RuleDetails } from '../components/rule-details';
import { TargetsTable } from '../components/targets-table';
import { busFromParams, ruleFromParams, RULES_PATH } from '../format';
import { useRule, useRuleTargets } from '../queries';

export function RulePage({ connection, params }: ScreenPageProps) {
  useShowsResources('targets');
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const bus = busFromParams(params);
  const name = ruleFromParams(params);
  const read = useRule(connection.engineOrigin, bus, name);
  const rule = read.value?.kind === 'found' ? read.value.rule : undefined;
  const targets = useRuleTargets(connection.engineOrigin, bus, name, rule !== undefined);
  const failure = read.failure && readFailureState(read.failure, connection, 'rule');
  const missing = read.value?.kind === 'not-found' ? read.value : undefined;
  const message = failure?.firstText ?? (missing ? 'Rule not found' : '');

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  return (
    <ContentLayout
      header={
        <Header variant="h1">
          <ValueText kind="name" value={name} />
        </Header>
      }
    >
      {rule === undefined ? (
        <Container>
          {failure ? (
            <ReadFailure state={failure} onRetry={read.refresh} />
          ) : (
            <Box textAlign="center" color="inherit">
              {missing ? (
                <SpaceBetween size="xs">
                  <Box variant="strong">Rule not found</Box>
                  {missing.message && (
                    <Box variant="p">
                      <ValueText kind="text" value={missing.message} />
                    </Box>
                  )}
                  <Button href={RULES_PATH} onFollow={handleFollow}>
                    Go to Rules
                  </Button>
                </SpaceBetween>
              ) : (
                <StatusIndicator type="loading">Loading rule</StatusIndicator>
              )}
            </Box>
          )}
        </Container>
      ) : (
        <SpaceBetween size="l">
          <RuleDetails rule={rule} bus={bus} />
          <TargetsTable connection={connection} targets={targets} />
        </SpaceBetween>
      )}
      {announcement}
    </ContentLayout>
  );
}
