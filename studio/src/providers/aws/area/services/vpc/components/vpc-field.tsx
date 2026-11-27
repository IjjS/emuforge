import Box from '@cloudscape-design/components/box';
import FormField from '@cloudscape-design/components/form-field';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useEffect, useRef, type Ref } from 'react';

import { ChoiceSelect } from '../../../components/choice-select';
import type { AreaConnection } from '../../../components/emulator-line';
import { ReadFailure, readFailureState } from '../../../components/failure-states';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { nameOf } from '../../../lib/ec2-client';
import type { VpcChoice } from '../../../lib/ec2-network-choices';
import type { Vpc } from '../api';
import { vpcChoices } from '../choices';
import { useVpc } from '../queries';
import type { useFreeVpcs } from '../use-free-vpcs';

// The "VPC" field of S5, S8 and S14 (issue 574, requirement "A choice of a VPC" and "The VPC of `?vpc=`"): the area's
// choice field over VPC's own source, read on every opening. Given the id of `?vpc=`, that VPC is read on its
// own by the filter `vpc-id`, whatever page of the choices it would be on, and the field cannot be changed until the
// read answers: the VPC is chosen; an empty answer leaves the field unchosen and says the emulator holds no such VPC;
// a failed read leaves it unchosen without that sentence. The form is never failed by this read.

/** The error a form gives the field when no VPC is chosen. */
export const CHOOSE_A_VPC = 'Choose a VPC.';

export interface VpcFieldProps {
  connection: AreaConnection;
  /** The VPC chosen; none for none. */
  value: VpcChoice | undefined;
  onChange: (vpc: VpcChoice | undefined) => void;
  /** The VPC of `?vpc=`, chosen at start when the emulator holds it. */
  preset?: string | undefined;
  /** The read of `preset` answered or failed: the VPC chosen by it, or none. */
  onPresetSettled?: ((vpc: VpcChoice | undefined) => void) | undefined;
  /** The form's message for the field ("Choose a VPC."). */
  errorText?: string | undefined;
  selectRef?: Ref<SelectProps.Ref> | undefined;
  /** A tag added to the option of each VPC it names, by the VPC's ID. */
  marks?: ReadonlyMap<string, string> | undefined;
  /** When attaching a gateway, only VPCs confirmed to be free can be chosen. */
  availability?: ReturnType<typeof useFreeVpcs> | undefined;
}

/** A VPC as a choice of the field. */
function choiceOf(vpc: Vpc): VpcChoice {
  const name = nameOf(vpc.tags);
  return {
    id: vpc.id,
    isDefault: vpc.isDefault,
    ...(name === undefined ? {} : { name }),
    ...(vpc.cidr === undefined ? {} : { cidr: vpc.cidr }),
  };
}

function marked(
  source: ChoiceSource<VpcChoice>,
  marks: VpcFieldProps['marks'],
  occupied: ReadonlyMap<string, string> | undefined,
  failed: boolean,
): ChoiceSource<VpcChoice> {
  return {
    ...source,
    optionOf: (vpc: VpcChoice) => {
      const option = source.optionOf(vpc);
      const gatewayId = occupied?.get(vpc.id);
      const mark = gatewayId === undefined ? marks?.get(vpc.id) : `Has ${gatewayId}`;
      return {
        ...option,
        ...(mark === undefined ? {} : { tags: [...(option.tags ?? []), mark] }),
        ...(failed || gatewayId !== undefined ? { disabled: true } : {}),
      };
    },
  };
}

type PresetState = 'reading' | 'chosen' | 'missing' | 'failed';

export function VpcField({
  connection,
  value,
  onChange,
  preset,
  onPresetSettled,
  errorText,
  selectRef,
  marks,
  availability,
}: VpcFieldProps) {
  const held = availability?.checking ? 'Checking which VPCs have an internet gateway' : undefined;
  const failure = availability?.failure;
  const read = useVpc(connection.engineOrigin, preset ?? '', preset !== undefined);
  const told = useRef(false);

  let state: PresetState | undefined;
  if (preset !== undefined) {
    if (read.failure !== undefined) {
      state = 'failed';
    } else if (read.value === undefined) {
      state = 'reading';
    } else {
      state = read.value.found ? 'chosen' : 'missing';
    }
  }
  const found = read.value?.found === true ? read.value.value : undefined;

  // Tell the form about the preset once its read settles and any attachment check succeeds.
  useEffect(() => {
    if (told.current || state === undefined || state === 'reading' || held !== undefined || failure !== undefined) {
      return;
    }
    told.current = true;
    const chosen = found === undefined ? undefined : choiceOf(found);
    if (chosen !== undefined) {
      onChange(chosen);
    }
    onPresetSettled?.(chosen);
  }, [state, found, onChange, onPresetSettled, held, failure]);

  const failureState = failure === undefined ? undefined : readFailureState(failure, connection, 'gateway attachments');
  const reading = state === 'reading';
  const missing = state === 'missing' && value === undefined && preset !== undefined;

  return (
    <FormField
      label="VPC"
      {...(errorText === undefined ? {} : { errorText })}
      {...(missing && errorText === undefined
        ? { warningText: `The emulator holds no VPC ${preset}. Choose another.` }
        : {})}
    >
      {reading ? (
        // Until the VPC of `?vpc=` is read the field cannot be changed.
        <Select
          ref={selectRef}
          disabled
          selectedOption={null}
          options={[]}
          placeholder="Choose a VPC"
          ariaLabel="VPC"
          statusType="loading"
          loadingText="Loading VPCs"
        />
      ) : (
        <ChoiceSelect<VpcChoice>
          source={marked(vpcChoices(connection.engineOrigin), marks, availability?.attachments, failure !== undefined)}
          held={held}
          onOpen={availability?.refresh}
          connection={connection}
          things="VPCs"
          placeholder="Choose a VPC"
          ariaLabel="VPC"
          invalid={errorText !== undefined}
          value={value}
          onChange={onChange}
          selectRef={selectRef}
          triggerVariant="option"
        />
      )}
      {reading && held !== undefined && (
        <Box color="text-status-inactive" padding={{ top: 'xxs' }} nativeAttributes={{ role: 'status' }}>
          {held}
        </Box>
      )}
      {failureState !== undefined &&
        (failure?.kind === 'not-implemented' || availability === undefined ? (
          <SpaceBetween size="xxs">
            <StatusIndicator type={failureState.type}>{failureState.first}</StatusIndicator>
            <Box variant="p">{failureState.detail}</Box>
          </SpaceBetween>
        ) : (
          <ReadFailure state={failureState} onRetry={availability.refresh} />
        ))}
    </FormField>
  );
}
