import type { DescribeRuleResponse, Target } from '@aws-sdk/client-eventbridge';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Header from '@cloudscape-design/components/header';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, useState } from 'react';

import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { useHandOverNote, usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf, usePageSignal } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { ScreenPageProps } from '../../../screens';
import { AddTargetDialog } from '../components/add-target-dialog';
import { DeleteRuleDialog } from '../components/delete-rule-dialog';
import { RemoveTargetDialog } from '../components/remove-target-dialog';
import { RuleDetails } from '../components/rule-details';
import { TargetsTable } from '../components/targets-table';
import { busFromParams, ruleFromParams, rulesPath, RULES_PATH } from '../format';
import { useRule, useRuleTargets } from '../queries';
import { RULE_CHANGE_OPERATIONS, setRuleEnabled } from '../rule-change-api';
import { PUT_TARGETS } from '../target-api';
import { MAX_TARGETS, TARGET_LIMIT_TEXT } from '../target-form';

type RuleDialog =
  { kind: 'add' } | { kind: 'remove'; id: string } | { kind: 'delete'; rule: DescribeRuleResponse; targets: Target[] };

function unavailableReason(operation: string) {
  return `Not implemented by the emulator (${operation}).`;
}

export function RulePage({ connection, params }: ScreenPageProps) {
  const bus = busFromParams(params);
  const name = ruleFromParams(params);
  return <RuleView key={JSON.stringify([bus, name])} connection={connection} bus={bus} name={name} />;
}

function RuleView({ connection, bus, name }: { connection: ScreenPageProps['connection']; bus: string; name: string }) {
  useShowsResources('targets');
  const handleFollow = useFollow();
  const [announcement, announce] = useAnnouncer();
  const { engineOrigin } = connection;
  const flash = usePageFlash();
  const note = useHandOverNote();
  const pageSignal = usePageSignal();
  const [dialog, setDialog] = useState<RuleDialog>();
  const [leaving, setLeaving] = useState(false);
  const [unavailable, setUnavailable] = useState<ReadonlySet<string>>(
    () => new Set(note?.notImplemented === PUT_TARGETS && note.bus === bus && note.rule === name ? [PUT_TARGETS] : []),
  );
  const [switchPending, setSwitchPending] = useState(false);
  const switchBusy = useRef(false);

  const read = useRule(engineOrigin, bus, name, !leaving);
  const currentRule = read.value?.kind === 'found' ? read.value.rule : undefined;
  const [lastRule, setLastRule] = useState<DescribeRuleResponse>();
  if (currentRule !== undefined && currentRule !== lastRule) setLastRule(currentRule);
  const deleteDialog = dialog?.kind === 'delete' ? dialog : undefined;

  // Keep the dialog and the rule it names mounted through any outstanding read and the hand-over.
  const rule = deleteDialog?.rule ?? currentRule ?? (read.loading ? lastRule : undefined);
  const targets = useRuleTargets(engineOrigin, bus, name, rule !== undefined && !leaving);
  const shownTargets =
    deleteDialog && (targets.failure || leaving)
      ? { ...targets, value: deleteDialog.targets, failure: undefined, loading: false }
      : targets;
  const failure = read.failure && readFailureState(read.failure, connection, 'rule');
  const missing = read.value?.kind === 'not-found' ? read.value : undefined;
  const message = deleteDialog ? '' : (failure?.firstText ?? (missing ? 'Rule not found' : ''));

  useEffect(() => {
    announce(message);
  }, [announce, message]);

  const markUnavailable = (operation: string) => setUnavailable((current) => new Set([...current, operation]));
  const dismiss = () => setDialog(undefined);
  const enabling = rule?.State === 'DISABLED';
  const switchOperation = enabling ? RULE_CHANGE_OPERATIONS.enable : RULE_CHANGE_OPERATIONS.disable;
  const switchUnavailable = unavailable.has(switchOperation);
  const addUnavailable = unavailable.has(PUT_TARGETS);
  const targetLimitReached = (targets.value?.length ?? 0) >= MAX_TARGETS;
  const removeUnavailable = unavailable.has(RULE_CHANGE_OPERATIONS.removeTargets);
  const deleteUnavailable = unavailable.has(RULE_CHANGE_OPERATIONS.delete)
    ? RULE_CHANGE_OPERATIONS.delete
    : removeUnavailable
      ? RULE_CHANGE_OPERATIONS.removeTargets
      : undefined;
  const anotherAction = dialog !== undefined || leaving || engineOrigin === undefined;
  const actionBlocked = anotherAction || switchPending;
  const removeDisabledReason = removeUnavailable
    ? unavailableReason(RULE_CHANGE_OPERATIONS.removeTargets)
    : actionBlocked
      ? 'Another action is in progress.'
      : undefined;

  async function handleSwitch() {
    if (
      engineOrigin === undefined ||
      currentRule === undefined ||
      switchBusy.current ||
      actionBlocked ||
      switchUnavailable
    )
      return;
    const signal = pageSignal();
    switchBusy.current = true;
    setSwitchPending(true);
    try {
      await setRuleEnabled(engineOrigin, bus, name, enabling, signal);
      if (signal.aborted) return;
      flash.show([
        {
          type: 'success',
          content: (
            <>
              Rule <ValueText kind="name" value={name} /> {enabling ? 'enabled' : 'disabled'}.
            </>
          ),
        },
      ]);
      read.refresh();
    } catch (error) {
      if (signal.aborted) return;
      const refusal = failureOf(error, switchOperation);
      if (refusal.kind === 'not-implemented') markUnavailable(switchOperation);
      const item = actionFailureItem(refusal, switchOperation, engineOrigin);
      flash.show([
        refusal.kind === 'engine-did-not-answer' || refusal.kind === 'emulator-did-not-answer'
          ? {
              ...item,
              content: (
                <>
                  {switchOperation} failed. {item.content}
                </>
              ),
            }
          : item,
      ]);
    } finally {
      switchBusy.current = false;
      if (!signal.aborted) setSwitchPending(false);
    }
  }

  return (
    <ContentLayout
      header={
        <Header
          variant="h1"
          actions={
            rule && (
              <SpaceBetween direction="horizontal" size="xs">
                <Button
                  disabled={anotherAction || switchUnavailable}
                  disabledReason={switchUnavailable ? unavailableReason(switchOperation) : undefined}
                  loading={switchPending || read.loading}
                  loadingText={read.loading ? 'Reading rule state' : enabling ? 'Enabling rule' : 'Disabling rule'}
                  onClick={() => void handleSwitch()}
                >
                  {enabling ? 'Enable' : 'Disable'}
                </Button>
                <Button
                  disabled={
                    (actionBlocked && dialog?.kind !== 'add') ||
                    targets.value === undefined ||
                    targetLimitReached ||
                    addUnavailable
                  }
                  disabledReason={
                    addUnavailable ? unavailableReason(PUT_TARGETS) : targetLimitReached ? TARGET_LIMIT_TEXT : undefined
                  }
                  onClick={() => setDialog({ kind: 'add' })}
                >
                  Add target
                </Button>
                <Button
                  disabled={
                    actionBlocked ||
                    currentRule === undefined ||
                    targets.value === undefined ||
                    deleteUnavailable !== undefined
                  }
                  disabledReason={deleteUnavailable ? unavailableReason(deleteUnavailable) : undefined}
                  onClick={() => {
                    if (currentRule && targets.value)
                      setDialog({ kind: 'delete', rule: currentRule, targets: targets.value });
                  }}
                >
                  Delete rule
                </Button>
              </SpaceBetween>
            )
          }
        >
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
          <TargetsTable
            connection={connection}
            targets={shownTargets}
            removeDisabledReason={removeDisabledReason}
            onRemove={(id) => setDialog({ kind: 'remove', id })}
          />
        </SpaceBetween>
      )}
      {engineOrigin !== undefined && dialog?.kind === 'add' && (
        <AddTargetDialog
          connection={{ ...connection, engineOrigin }}
          bus={bus}
          name={name}
          onDismiss={dismiss}
          onUnavailable={() => markUnavailable(PUT_TARGETS)}
          onAdded={(id) => {
            dismiss();
            flash.show([
              {
                type: 'success',
                content: (
                  <>
                    Target <ValueText kind="name" value={id} /> added to <ValueText kind="name" value={name} />.
                  </>
                ),
              },
            ]);
            targets.refresh();
          }}
        />
      )}
      {engineOrigin !== undefined && dialog?.kind === 'remove' && (
        <RemoveTargetDialog
          endpoint={engineOrigin}
          bus={bus}
          name={name}
          id={dialog.id}
          onDismiss={dismiss}
          onUnavailable={() => markUnavailable(RULE_CHANGE_OPERATIONS.removeTargets)}
          onRemoved={() => {
            flash.show([
              {
                type: 'success',
                content: (
                  <>
                    Target <ValueText kind="name" value={dialog.id} /> removed from{' '}
                    <ValueText kind="name" value={name} />.
                  </>
                ),
              },
            ]);
            dismiss();
            targets.refresh();
          }}
        />
      )}
      {engineOrigin !== undefined && deleteDialog && (
        <DeleteRuleDialog
          endpoint={engineOrigin}
          bus={bus}
          name={name}
          targetCount={deleteDialog.targets.length}
          onDismiss={dismiss}
          onUnavailable={markUnavailable}
          onTargetsChanged={targets.refresh}
          onDeleted={() => {
            setLeaving(true);
            flash.handOver(rulesPath(bus), [
              {
                type: 'success',
                content: (
                  <>
                    Rule <ValueText kind="name" value={name} /> deleted.
                  </>
                ),
              },
            ]);
          }}
        />
      )}
      {announcement}
    </ContentLayout>
  );
}
