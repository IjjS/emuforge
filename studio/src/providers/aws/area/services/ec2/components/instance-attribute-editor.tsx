import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import FormField from '@cloudscape-design/components/form-field';
import Multiselect from '@cloudscape-design/components/multiselect';
import Select from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import Toggle from '@cloudscape-design/components/toggle';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

import {
  reportedNotImplementedMessage,
  reportedServiceCode,
  refusalMessage,
  requestFailure,
  type RequestFailure,
} from '../../../../../../lib/aws/request';
import { AreaModal } from '../../../components/area-modal';
import { useChoiceField } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { actionFailureItem, readFailureState } from '../../../components/failure-states';
import { usePageFlash } from '../../../components/page-flash';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { ValueText } from '../../../components/value-text';
import type { Instance } from '../api';
import type { GroupChoice, InstanceTypeChoice } from '../choices-api';
import { groupChoices, instanceTypeChoices } from '../choices-queries';
import { MODIFY_INSTANCE_ATTRIBUTE, type InstanceAttributeChange } from '../instance-attribute-api';
import { useInstanceAttributeChange } from '../instance-attribute-queries';

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

type EditorProps = { instance: Instance; connection: AreaConnection } & (
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
  source,
  connection,
  pending,
  onUnsupported,
  current,
  children,
}: FieldProps<InstanceTypeChoice> & {
  current: string | undefined;
  children: (change: InstanceAttributeChange | undefined, field: ReactNode) => ReactNode;
}) {
  const [selected, setSelected] = useState<InstanceTypeChoice>();
  const { choices, items, options, props } = useAttributeChoices(
    { source, connection, pending, onUnsupported },
    'instance types',
  );
  const change =
    !choices.loading && choices.failure === undefined && selected !== undefined && selected.type !== current
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
      <Select
        {...props}
        placeholder="Choose an instance type"
        dropdownRole="dialog"
        disabled={pending}
        options={options}
        selectedOption={selected === undefined ? null : source.optionOf(selected)}
        onChange={({ detail }) => {
          setSelected(items.find(({ type }) => type === detail.selectedOption.value));
        }}
      />
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
  const { choices, items, options, props } = useAttributeChoices(
    { source, connection, pending, onUnsupported },
    'security groups',
  );
  const ids = selected.map(({ id }) => id);
  const changed = ids.length !== current.length || current.some(({ id }) => !ids.includes(id));
  const change =
    !choices.loading && choices.failure === undefined && choices.choices !== undefined && ids.length > 0 && changed
      ? ({ kind: 'groups', groupIds: ids } as const)
      : undefined;
  return children(
    change,
    <FormField label="Security groups" constraintText="Select at least one security group.">
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
  const { kind, instance, connection } = editor;
  const endpoint = connection.engineOrigin;
  const flash = usePageFlash();
  const save = useInstanceAttributeChange(endpoint, instance.id);
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  const [pending, setPending] = useState(false);

  const handleClose = () => {
    if (active.current === undefined) onClose();
  };

  const handleSave = async (change: InstanceAttributeChange) => {
    if (active.current !== undefined || endpoint === undefined) return;
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    try {
      await save(change, controller.signal);
      if (controller.signal.aborted) return;
      flash.show([{ type: 'success', content: RESULTS[kind] }]);
      onClose();
    } catch (error) {
      if (controller.signal.aborted) return;
      const failure = requestFailure(MODIFY_INSTANCE_ATTRIBUTE, error);
      flash.show([refusalItem(failure, LABELS[kind], endpoint)]);
      if (failure.kind === 'not-implemented') onUnsupported(failure);
      else onClose();
    } finally {
      if (!controller.signal.aborted) {
        active.current = undefined;
        setPending(false);
      }
    }
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
              disabled={change === undefined || endpoint === undefined}
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
      {field}
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
      <TypeFields {...fields} current={instance.type} source={instanceTypeChoices(endpoint)}>
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
      return editor.instance.state === 'stopped' ? undefined : 'Stop the instance to change its type.';
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
  const [unsupported, setUnsupported] = useState<RequestFailure>();
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
        disabled={reason !== undefined || unavailable !== undefined}
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
            setUnsupported(failure);
            setOpen(false);
          }}
        />
      )}
    </SpaceBetween>
  );
}
