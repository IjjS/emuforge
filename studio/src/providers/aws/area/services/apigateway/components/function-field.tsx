import Checkbox from '@cloudscape-design/components/checkbox';
import FormField from '@cloudscape-design/components/form-field';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useState, type Ref } from 'react';

import { CopyValue } from '../../../components/copy-value';
import type { AreaConnection } from '../../../components/emulator-line';
import type { ChoiceSource } from '../../../components/use-paged-choices';
import { LIST_FUNCTIONS, readFunctions, type LambdaFunction } from '../lambda-api';
import { PagedChoice } from './paged-choice';

interface FunctionFieldProps {
  connection: AreaConnection;
  value: LambdaFunction | undefined;
  onChange: (value: LambdaFunction | undefined) => void;
  allow?: boolean;
  onAllowChange: (allow: boolean) => void;
  errorText?: string | undefined;
  selectRef?: Ref<SelectProps.Ref> | undefined;
}

export function FunctionField({
  connection,
  value,
  onChange,
  allow = true,
  onAllowChange,
  errorText,
  selectRef,
}: FunctionFieldProps) {
  const endpoint = connection.engineOrigin;
  const [emptyAt, setEmptyAt] = useState<string>();
  const source: ChoiceSource<LambdaFunction> = {
    key: ['apigateway', 'lambda-functions'],
    endpoint,
    operation: LIST_FUNCTIONS,
    readAgainOnOpen: true,
    read: async (origin, _text, marker, signal) => {
      if (marker === undefined) setEmptyAt(undefined);
      const page = await readFunctions(origin, marker, signal);
      if (marker === undefined && !signal.aborted) {
        setEmptyAt(page.items.length === 0 ? origin : undefined);
      }
      return page;
    },
    optionOf: ({ name, arn }) => ({ value: arn, label: name, description: arn }),
  };

  return (
    <SpaceBetween size="m">
      <FormField
        label="Lambda function"
        errorText={errorText}
        constraintText={
          emptyAt !== undefined && emptyAt === endpoint ? 'The emulator holds no Lambda function.' : undefined
        }
      >
        <PagedChoice
          ariaLabel="Lambda function"
          source={source}
          connection={connection}
          things="Lambda functions"
          placeholder="Choose a Lambda function"
          value={value}
          onChange={onChange}
          selectRef={selectRef}
          invalid={errorText !== undefined}
        />
      </FormField>
      {value && <CopyValue label="function ARN" value={value.arn} />}
      <Checkbox
        checked={allow}
        description="Adds a permission to the function's resource policy for this API. Without it the emulator answers 500."
        onChange={({ detail }) => onAllowChange(detail.checked)}
      >
        Allow API Gateway to invoke this function
      </Checkbox>
    </SpaceBetween>
  );
}
