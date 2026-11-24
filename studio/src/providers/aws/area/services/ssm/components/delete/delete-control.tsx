import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useId, useRef, useState } from 'react';

import type { RequestFailure } from '../../../../../../../lib/aws/request';
import { ConfirmDialog } from '../../../../components/confirm-dialog';
import type { AreaConnection } from '../../../../components/emulator-line';
import { actionFailureItem } from '../../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../../components/page-flash';
import { failureOf, usePageSignal } from '../../../../components/use-token-listing';
import { ValueText } from '../../../../components/value-text';
import { DELETE_PARAMETER, DELETE_PARAMETERS, deleteParameter, deleteParameters } from '../../api';
import { useEvictDeletedParameterResources, useRefreshParameterReads, useUnsupportedOperation } from '../../queries';

const MAX_DELETE_BATCH = 10;

interface DeleteResult {
  deleted: string[];
  rejected: string[];
  unconfirmed: string[];
  failure?: RequestFailure;
}

async function removeParameters(
  endpoint: string,
  names: string[],
  signal: AbortSignal,
  evict: (names: readonly string[]) => void,
): Promise<DeleteResult> {
  const deleted: string[] = [];
  const rejected: string[] = [];
  const unconfirmed: string[] = [];
  for (let offset = 0; offset < names.length; offset += MAX_DELETE_BATCH) {
    const batch = names.slice(offset, offset + MAX_DELETE_BATCH);
    try {
      const result = await deleteParameters(endpoint, batch, signal);
      const previousCount = deleted.length;
      for (const name of batch) {
        if (result.DeletedParameters?.includes(name)) deleted.push(name);
        else if (result.InvalidParameters?.includes(name)) rejected.push(name);
        else unconfirmed.push(name);
      }
      evict(deleted.slice(previousCount));
    } catch (error) {
      signal.throwIfAborted();
      return {
        deleted,
        rejected,
        unconfirmed: [...unconfirmed, ...names.slice(offset)],
        failure: failureOf(error, DELETE_PARAMETERS),
      };
    }
  }
  return { deleted, rejected, unconfirmed };
}

function Names({ names }: { names: readonly string[] }) {
  return (
    <Box variant="span" display="block" margin={{ top: 'xs' }} nativeAttributes={{ role: 'list' }}>
      {names.map((name) => (
        <Box variant="span" display="block" key={name} nativeAttributes={{ role: 'listitem' }}>
          <ValueText kind="name" value={name} />
        </Box>
      ))}
    </Box>
  );
}

interface DeleteControlProps {
  connection: AreaConnection;
  names: string[];
  disabled?: boolean;
  onDeleted?: (name: string, result: FlashItem) => void;
  onConfirmed?: (names: readonly string[]) => void;
  onSettled?: () => void;
}

export function DeleteControl({ connection, names, disabled, onDeleted, onConfirmed, onSettled }: DeleteControlProps) {
  const endpoint = connection.engineOrigin;
  const flash = usePageFlash();
  const evict = useEvictDeletedParameterResources(connection);
  const refresh = useRefreshParameterReads(connection);
  const single = useUnsupportedOperation(connection, DELETE_PARAMETER);
  const bulk = useUnsupportedOperation(connection, DELETE_PARAMETERS);
  const unavailableId = useId();
  const getSignal = usePageSignal();
  const [targets, setTargets] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<FlashItem>();
  const submitting = useRef(false);
  const name = targets.length === 1 ? targets[0] : undefined;

  function reconcileDeleted(names: readonly string[]) {
    if (names.length === 0) return;
    evict(names);
    onConfirmed?.(names);
  }

  const handleOpen = () => {
    setError(undefined);
    setTargets(names);
  };

  const handleConfirm = async () => {
    if (endpoint === undefined || submitting.current || targets.length === 0) return;
    submitting.current = true;
    setPending(true);
    setError(undefined);
    const signal = getSignal();
    try {
      if (name !== undefined) {
        await deleteParameter(endpoint, name, signal);
        signal.throwIfAborted();
        reconcileDeleted([name]);
        const result: FlashItem = {
          type: 'success',
          content: (
            <>
              Parameter <ValueText kind="name" value={name} /> deleted.
            </>
          ),
        };
        if (onDeleted === undefined) flash.show([result]);
        else onDeleted(name, result);
      } else {
        const { deleted, rejected, unconfirmed, failure } = await removeParameters(
          endpoint,
          targets,
          signal,
          reconcileDeleted,
        );
        signal.throwIfAborted();
        const items: FlashItem[] = [];
        if (deleted.length)
          items.push({ type: 'success', header: 'Deleted parameters', content: <Names names={deleted} /> });
        if (rejected.length)
          items.push({ type: 'error', header: 'Rejected parameters', content: <Names names={rejected} /> });
        if (unconfirmed.length) {
          items.push({ type: 'warning', header: 'Deletion not confirmed', content: <Names names={unconfirmed} /> });
        }
        if (failure !== undefined) {
          if (failure.kind === 'not-implemented') bulk.markUnsupported(failure);
          items.push(actionFailureItem(failure, 'Deleting parameters', endpoint));
        }
        const [first, ...rest] = items;
        if (first !== undefined) flash.show([first, ...rest]);
        if (failure !== undefined && failure.kind !== 'not-implemented' && unconfirmed.length === targets.length) {
          setError(actionFailureItem(failure, 'Deleting parameters', endpoint));
          refresh(targets);
          return;
        }
      }
      refresh(targets);
      setTargets([]);
      onSettled?.();
    } catch (cause) {
      if (signal.aborted) return;
      const failure = failureOf(cause, DELETE_PARAMETER);
      const item = actionFailureItem(failure, 'Deleting the parameter', endpoint);
      if (failure.kind === 'not-implemented') {
        single.markUnsupported(failure);
        flash.show([item]);
        setTargets([]);
      } else {
        flash.show([{ ...item, announcedInDialog: true }]);
        setError(item);
        refresh(targets);
      }
    } finally {
      if (!signal.aborted) {
        submitting.current = false;
        setPending(false);
      }
    }
  };

  const unsupported = names.length > 1 ? bulk.failure : single.failure;
  const unavailable =
    names.length > 0 && unsupported !== undefined
      ? actionFailureItem(unsupported, names.length === 1 ? 'Deleting the parameter' : 'Deleting parameters', endpoint)
      : undefined;
  return (
    <>
      <SpaceBetween size="xxs">
        <Button
          disabled={disabled || names.length === 0 || endpoint === undefined || unavailable !== undefined}
          {...(unavailable !== undefined && { ariaDescribedby: unavailableId })}
          onClick={handleOpen}
        >
          Delete
        </Button>
        {unavailable !== undefined && (
          <div id={unavailableId}>
            <StatusIndicator type="info">{unavailable.header}</StatusIndicator>
            <Box variant="div" fontSize="body-s">
              {unavailable.content}
            </Box>
          </div>
        )}
      </SpaceBetween>
      <ConfirmDialog
        visible={targets.length > 0}
        header={name === undefined ? 'Delete parameters' : 'Delete parameter'}
        word={name ?? 'delete'}
        body={
          <>
            {name === undefined ? (
              <>
                This removes the selected parameters and their versions from your local emulator. Type delete to
                confirm.
                <Names names={targets} />
              </>
            ) : (
              <>
                Deleting <ValueText kind="name" value={name} /> removes this parameter and its versions from your local
                emulator. Type <ValueText kind="name" value={name} /> to confirm.
              </>
            )}
            {error !== undefined && (
              <Box variant="span" display="block" margin={{ top: 'xs' }} nativeAttributes={{ role: 'alert' }}>
                <StatusIndicator type="error">{error.header}</StatusIndicator>
                <Box variant="span" display="block">
                  {error.content}
                </Box>
              </Box>
            )}
          </>
        }
        action="Delete"
        pending={pending}
        onConfirm={() => void handleConfirm()}
        onDismiss={() => setTargets([])}
      />
    </>
  );
}
