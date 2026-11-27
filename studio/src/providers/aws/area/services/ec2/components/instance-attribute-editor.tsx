import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Multiselect from '@cloudscape-design/components/multiselect';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Toggle from '@cloudscape-design/components/toggle';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  refusalMessage,
  type RequestFailure,
} from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { useChoiceField } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, ReadFailure, readFailureState } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { ValueText } from '../../../components/value-text';
import type { Instance } from '../api';
import type { GroupChoice, InstanceTypeChoice } from '../choices-api';
import { groupChoices, instanceTypeChoices, useInstanceTypeOfferings } from '../choices-queries';
import { MODIFY_INSTANCE_ATTRIBUTE, type InstanceAttributeChange } from '../instance-attribute-api';
import type { InstanceAttributeWrites } from '../instance-attribute-queries';

const LABELS = {
  type: 'Change instance type',
  groups: 'Change security groups',
  protection: 'Change termination protection',
};

const RESULTS = {
  type: 'Instance type updated.',
  groups: 'Security groups updated.',
  protection: 'Termination protection updated.',
};

const STOP_TO_CHANGE_TYPE = 'Stop the instance to change its type.';

type EditorProps = { instance: Instance; connection: AreaConnection; writes: InstanceAttributeWrites } & (
  | { kind: 'type' | 'groups' }
  | { kind: 'protection'; value: boolean | undefined; readFailure: RequestFailure | undefined }
);

interface FieldProps<T> {
  source: ChoiceSource<T>;
  connection: AreaConnection;
  pending: boolean;
  onUnsupported: (failure: RequestFailure) => void;
}

function useAttributeChoices<T>({ source, connection, onUnsupported }: FieldProps<T>, things: string) {
  const field = useChoiceField({ source, connection, things }, undefined);
  const failure = field.choices.failure;
  useEffect(() => {
    if (failure?.kind === 'not-implemented') onUnsupported(failure);
  }, [failure, onUnsupported]);
  return field;
}

function TypeFields({
  zone,
  connection,
  pending,
  onUnsupported,
  current,
  children,
}: Omit<FieldProps<InstanceTypeChoice>, 'source'> & {
  zone: string | undefined;
  current: string | undefined;
  children: (change: InstanceAttributeChange | undefined, field: ReactNode) => ReactNode;
}) {
  const [selected, setSelected] = useState<InstanceTypeChoice>();
  const offerings = useInstanceTypeOfferings(connection.engineOrigin, zone);
  const source = instanceTypeChoices(connection.engineOrigin, zone, offerings.types);
  const checking = zone !== undefined && offerings.types === undefined;
  const failure = offerings.failure && readFailureState(offerings.failure, connection, 'instance types');
  const { choices, fieldRef, items, options, props } = useAttributeChoices(
    { source, connection, pending, onUnsupported },
    'instance types',
  );
  const displayed = selected ?? items.find(({ type }) => type === current);
  const outsideZone = current !== undefined && offerings.types?.has(current) === false;
  const currentOption =
    current === undefined
      ? null
      : { value: current, label: current, ...(outsideZone ? { description: "Not in the emulator's list" } : {}) };
  const change =
    !checking &&
    !choices.loading &&
    choices.failure === undefined &&
    selected !== undefined &&
    selected.type !== current &&
    (offerings.types?.has(selected.type) ?? true)
      ? ({ kind: 'type', type: selected.type } as const)
      : undefined;
  return children(
    change,
    <FormField
      label="Instance type"
      description={
        current === undefined ? undefined : (
          <>
            Current type <ValueText kind="fixed" value={current} />
          </>
        )
      }
    >
      <div ref={fieldRef}>
        <Select
          {...props}
          empty={zone === undefined || choices.text !== '' ? props.empty : `No instance types in ${zone}`}
          placeholder="Choose an instance type"
          dropdownRole="dialog"
          disabled={pending || checking}
          options={options}
          selectedOption={displayed === undefined ? currentOption : source.optionOf(displayed)}
          triggerVariant={selected === undefined && outsideZone ? 'option' : 'label'}
          onChange={({ detail }) => {
            setSelected(items.find(({ type }) => type === detail.selectedOption.value));
          }}
        />
      </div>
      {offerings.pending && <StatusIndicator type="loading">Checking Instance type</StatusIndicator>}
      {failure !== undefined &&
        (offerings.failure?.kind === 'not-implemented' ? (
          <SpaceBetween size="xxs">
            <StatusIndicator type={failure.type}>{failure.first}</StatusIndicator>
            <Box variant="small">The emulator answered 501 Not Implemented for {offerings.failure.operation}.</Box>
          </SpaceBetween>
        ) : (
          <ReadFailure state={failure} onRetry={offerings.retry} />
        ))}
    </FormField>,
  );
}

function GroupFields({
  source,
  connection,
  pending,
  onUnsupported,
  current,
  children,
}: FieldProps<GroupChoice> & {
  current: GroupChoice[];
  children: (change: InstanceAttributeChange | undefined, field: ReactNode) => ReactNode;
}) {
  const [selected, setSelected] = useState(current);
  const { choices, fieldRef, items, options, props } = useAttributeChoices(
    { source, connection, pending, onUnsupported },
    'security groups',
  );
  const ids = selected.map(({ id }) => id);
  const changed = ids.length !== current.length || current.some(({ id }) => !ids.includes(id));
  const change =
    !choices.loading && choices.failure === undefined && ids.length > 0 && changed
      ? ({ kind: 'groups', groupIds: ids } as const)
      : undefined;
  return children(
    change,
    <FormField label="Security groups" constraintText="Select at least one security group.">
      <div ref={fieldRef}>
        <Multiselect
          {...props}
          placeholder="Choose security groups"
          disabled={pending}
          options={options}
          selectedOptions={selected.map(source.optionOf)}
          deselectAriaLabel={(option) => `Remove ${option.label ?? option.value ?? ''}`}
          onChange={({ detail }) => {
            const known = new Map([...selected, ...items].map((group) => [group.id, group]));
            setSelected(
              detail.selectedOptions.flatMap(({ value }) => {
                const group = value === undefined ? undefined : known.get(value);
                return group === undefined ? [] : [group];
              }),
            );
          }}
        />
      </div>
    </FormField>,
  );
}

function ProtectionFields({
  current,
  pending,
  children,
}: {
  current: boolean | undefined;
  pending: boolean;
  children: (change: InstanceAttributeChange | undefined, field: ReactNode) => ReactNode;
}) {
  const [enabled, setEnabled] = useState(current === true);
  const change = current !== undefined && current !== enabled ? ({ kind: 'protection', enabled } as const) : undefined;
  return children(
    change,
    <Toggle
      checked={enabled}
      disabled={pending || current === undefined}
      onChange={({ detail }) => setEnabled(detail.checked)}
    >
      Enable termination protection
    </Toggle>,
  );
}

function refusalItem(failure: RequestFailure, label: string, endpoint: string | undefined) {
  const item = actionFailureItem(failure, label, endpoint);
  const code = reportedServiceCode(failure) ?? (failure.kind === 'other' ? failure.code : undefined);
  const message = refusalMessage(failure);
  if (failure.kind === 'other' || failure.kind === 'access-denied') {
    return {
      ...item,
      content: (
        <>
          {failure.kind === 'access-denied' && (
            <>
              {label}. {failure.operation} was refused.{' '}
            </>
          )}
          {code !== undefined && (
            <Box variant="code" display="inline">
              <ValueText kind="name" value={code} />
            </Box>
          )}
          {message !== undefined && (
            <>
              {code === undefined ? '' : ': '}
              <ValueText kind="text" value={message} />
            </>
          )}
        </>
      ),
    };
  }
  if (failure.kind === 'not-implemented') {
    const detail = reportedNotImplementedMessage(failure);
    return {
      ...item,
      content: (
        <>
          {label}. {item.content}
          {detail !== undefined && (
            <>
              {' '}
              <ValueText kind="text" value={detail} />
            </>
          )}
        </>
      ),
    };
  }
  return item;
}

function AttributeDialog({
  editor,
  onClose,
  onUnsupported,
}: {
  editor: EditorProps;
  onClose: () => void;
  onUnsupported: (failure: RequestFailure) => void;
}) {
  const { kind, instance, connection, writes } = editor;
  const endpoint = connection.engineOrigin;
  const flash = usePageFlash();
  const mounted = useRef(false);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const pending = writes.pending.has(kind);
  const requiresStop = kind === 'type' && instance.state !== 'stopped';
  const [refusal, setRefusal] = useState<FlashItem>();

  const handleClose = () => {
    if (!pending) onClose();
  };

  const handleSave = (change: InstanceAttributeChange) => {
    if (pending || requiresStop || endpoint === undefined) return;
    setRefusal(undefined);
    void writes.submit(change, (failure) => {
      if (failure === undefined) {
        flash.show([{ type: 'success', content: RESULTS[kind] }]);
        if (mounted.current) onClose();
        return;
      }
      const item = refusalItem(failure, LABELS[kind], endpoint);
      if (failure.kind !== 'not-implemented' && mounted.current) {
        setRefusal(item);
        flash.show([{ ...item, announcedInDialog: true }]);
      } else {
        flash.show([item]);
        if (mounted.current) onClose();
      }
    });
  };

  const renderDialog = (change: InstanceAttributeChange | undefined, field: ReactNode) => (
    <AreaModal
      visible
      header={LABELS[kind]}
      closeAriaLabel="Close"
      onDismiss={handleClose}
      footer={
        <Box float="right">
          <SpaceBetween direction="horizontal" size="xs">
            <Button variant="link" disabled={pending} onClick={handleClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              disabled={change === undefined || endpoint === undefined || requiresStop}
              onClick={() => {
                if (change !== undefined) void handleSave(change);
              }}
            >
              Save changes
            </Button>
          </SpaceBetween>
        </Box>
      }
    >
      <SpaceBetween size="m">
        {refusal !== undefined && (
          <div role="alert">
            <Alert type="error" header={refusal.header} statusIconAriaLabel="Error">
              {refusal.content}
            </Alert>
          </div>
        )}
        {requiresStop && <Alert type="info">{STOP_TO_CHANGE_TYPE}</Alert>}
        {field}
      </SpaceBetween>
    </AreaModal>
  );

  if (editor.kind === 'protection') {
    return (
      <ProtectionFields current={editor.value} pending={pending}>
        {renderDialog}
      </ProtectionFields>
    );
  }
  const fields = { connection, pending, onUnsupported };
  if (editor.kind === 'type') {
    return (
      <TypeFields {...fields} current={instance.type} zone={instance.zone}>
        {renderDialog}
      </TypeFields>
    );
  }
  return (
    <GroupFields
      {...fields}
      current={instance.groups}
      source={groupChoices(endpoint, instance.vpcId, Boolean(instance.vpcId))}
    >
      {renderDialog}
    </GroupFields>
  );
}

function unavailableReason(editor: EditorProps): string | undefined {
  switch (editor.kind) {
    case 'type':
      return editor.instance.state === 'stopped' ? undefined : STOP_TO_CHANGE_TYPE;
    case 'groups':
      return editor.instance.vpcId ? undefined : "The instance's VPC is unavailable.";
    case 'protection':
      if (editor.readFailure?.kind === 'not-implemented') {
        return `Not implemented by the emulator (${editor.readFailure.operation}).`;
      }
      return editor.value === undefined ? 'Read the current termination protection before changing it.' : undefined;
  }
}

/** One detail-page action and its draft, mounted only while its dialog is open. */
export function InstanceAttributeEditor(editor: EditorProps) {
  const [open, setOpen] = useState(false);
  const [readUnsupported, setReadUnsupported] = useState<RequestFailure>();
  const unsupported = editor.writes.unsupported[editor.kind] ?? readUnsupported;
  const pending = editor.writes.pending.has(editor.kind);
  const reasonId = useId();
  const reason = unavailableReason(editor);
  const unavailable =
    unsupported === undefined ? undefined : `Not implemented by the emulator (${unsupported.operation}).`;
  const showStopReason = reason !== undefined && editor.kind === 'type' && unavailable === undefined;
  const readUnavailable =
    unsupported !== undefined && unsupported.operation !== MODIFY_INSTANCE_ATTRIBUTE
      ? readFailureState(
          unsupported,
          editor.connection,
          { type: 'instance types', groups: 'security groups', protection: 'termination protection' }[editor.kind],
        )
      : undefined;
  const detail = unsupported === undefined ? undefined : reportedNotImplementedMessage(unsupported);

  return (
    <SpaceBetween size="xxs" data-testid="instance-attribute-action">
      <Button
        variant={editor.kind === 'groups' ? 'normal' : 'inline-link'}
        disabled={reason !== undefined || unavailable !== undefined || pending}
        disabledReason={showStopReason ? undefined : (unavailable ?? reason)}
        {...(showStopReason ? { ariaDescribedby: reasonId } : {})}
        onClick={() => setOpen(true)}
      >
        {LABELS[editor.kind]}
      </Button>
      {showStopReason && (
        <Box variant="small" nativeAttributes={{ id: reasonId }}>
          {reason}
        </Box>
      )}
      {readUnavailable !== undefined && (
        <>
          <StatusIndicator type={readUnavailable.type}>{readUnavailable.first}</StatusIndicator>
          <Box variant="small">{readUnavailable.detail}</Box>
          {detail !== undefined && <ValueText kind="text" value={detail} />}
        </>
      )}
      {open && (
        <AttributeDialog
          editor={editor}
          onClose={() => setOpen(false)}
          onUnsupported={(failure) => {
            setReadUnsupported(failure);
            setOpen(false);
          }}
        />
      )}
    </SpaceBetween>
  );
}
