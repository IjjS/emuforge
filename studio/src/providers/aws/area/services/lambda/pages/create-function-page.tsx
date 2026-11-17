import Alert from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import ContentLayout from '@cloudscape-design/components/content-layout';
import Form from '@cloudscape-design/components/form';
import FormField from '@cloudscape-design/components/form-field';
import Header from '@cloudscape-design/components/header';
import Input, { type InputProps } from '@cloudscape-design/components/input';
import RadioGroup from '@cloudscape-design/components/radio-group';
import Select, { type SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import type { ScreenPageProps } from '../../../screens';
import type { CreateFunctionRequest, LambdaFailure } from '../api';
import { actionFailureItem, useAnnouncer } from '../components/failure-states';
import { RoleSelect } from '../components/role-select';
import { FUNCTIONS_PATH, functionPath } from '../format';
import { useCreateFunction } from '../queries';
import { RUNTIMES } from '../starter-code';

// "Create Event Function" (issue 84, requirement R6, R9.4, R10.3): the console's form "Author from scratch" in the
// console's words (`studio/references/console/lambda/create-function.yaml`), its description, help, field messages
// and failures in EmuForge's own. Nothing typed is kept anywhere: the form lives as long as the page is open. The
// section "Advanced settings" is not built (R13 item 9).

export const CREATE_FUNCTION_TITLE = 'Create Event Function';
const DESCRIPTION =
  'The function is created in your local emulator, not in an AWS account, with starter code that returns a greeting.';

const FUNCTION_NAME = 'Function name';
const RUNTIME = 'Runtime';
const RUNTIME_DESCRIPTION = 'Studio has starter code for these runtimes.';
const ARCHITECTURE = 'Architecture';
const EXECUTION_ROLE = 'Execution role';
const CREATE_DEFAULT_ROLE = 'Create default role';
const CREATE_DEFAULT_ROLE_DESCRIPTION = "Creates a role in the emulator's IAM for this function.";
const USE_ANOTHER_ROLE = 'Use another role';

const ARCHITECTURES = ['x86_64', 'arm64'] as const;
type Architecture = (typeof ARCHITECTURES)[number];
type RoleChoice = 'default' | 'existing';

/** The field messages of R6.4. */
export const ENTER_NAME = 'Enter a function name.';
export const NAME_TOO_LONG = 'The name can have up to 64 characters.';
export const NAME_ALPHABET = 'Use only letters, digits, hyphens (-) and underscores (_).';
export const CHOOSE_ROLE = 'Choose a role.';

const NAME_MAX = 64;
const NAME_ALPHABET_PATTERN = /^[A-Za-z0-9_-]+$/;

/** The message under "Function name" for `name` (R6.4), or `undefined` when the form lets it through. */
function nameMessage(name: string): string | undefined {
  if (name === '') {
    return ENTER_NAME;
  }
  if (name.length > NAME_MAX) {
    return NAME_TOO_LONG;
  }
  return NAME_ALPHABET_PATTERN.test(name) ? undefined : NAME_ALPHABET;
}

const RUNTIME_OPTIONS: SelectProps.Option[] = RUNTIMES.map(({ label, value }) => ({ label, value }));
const FIRST_RUNTIME = RUNTIME_OPTIONS[0] as SelectProps.Option;

/** The failure above the buttons as its first line says it, announced once (R10.3). */
function failureHeadline(failure: LambdaFailure, what: string, engineOrigin: string | undefined): string {
  switch (failure.kind) {
    case 'not-implemented':
      return 'Not implemented by the emulator';
    case 'access-denied':
      return 'Access denied';
    case 'emulator-did-not-answer':
      return 'The emulator did not answer';
    case 'engine-did-not-answer':
      return `The EmuForge engine at ${engineOrigin ?? ''} did not answer`;
    case 'other':
      return `${what} failed`;
  }
}

/** The sentence that follows a failure when "Create default role" made a role before it (R6.5). */
function roleStillThere(roleName: string): string {
  return `The role “${roleName}” was created in the local emulator and is still there.`;
}

/**
 * `/aws/lambda/functions/create`: the form, opened with "Use another role" chosen when the address says
 * `?role=existing` (R6.3). "Create Event Function" checks the fields (R6.4), then sends the requests of R6.5 in order;
 * once `CreateFunction` answers, the function's page opens with the result in the area's flash.
 */
export function CreateFunctionPage({ connection }: ScreenPageProps) {
  useShowsResources('functions');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const { search } = useLocation();
  const endpoint = connection.engineOrigin;

  const [name, setName] = useState('');
  const [runtime, setRuntime] = useState<SelectProps.Option>(FIRST_RUNTIME);
  const [architecture, setArchitecture] = useState<Architecture>('x86_64');
  const [roleChoice, setRoleChoice] = useState<RoleChoice>(() =>
    new URLSearchParams(search).get('role') === 'existing' ? 'existing' : 'default',
  );
  const [existingRole, setExistingRole] = useState<SelectProps.Option | null>(null);
  /** The fields are checked from the first press of "Create Event Function" on, and again as they change. */
  const [checked, setChecked] = useState(false);

  const nameRef = useRef<InputProps.Ref>(null);
  const roleRef = useRef<SelectProps.Ref>(null);

  const { create, pending, created, failure } = useCreateFunction(endpoint);
  const [announcement, announce] = useAnnouncer();

  // A press while the requests of an earlier one are in flight sends nothing, also before the page has rendered
  // that they are (a double click). Cleared once that press is answered: a new failure, or its absence while the next
  // press is in flight, is a render after the mutation started.
  const busy = useRef(false);
  const shownFailure = failure?.failure;
  useEffect(() => {
    busy.current = false;
  }, [shownFailure]);

  // A failure is announced once, with its first line (R10.3).
  const [seenFailure, setSeenFailure] = useState<LambdaFailure | undefined>(undefined);
  if (shownFailure !== seenFailure) {
    setSeenFailure(shownFailure);
    if (failure !== undefined) {
      announce(failureHeadline(failure.failure, failure.step, endpoint));
    }
  }

  // `CreateFunction` answered: the function's page, with the result handed to it (R6.5).
  useEffect(() => {
    if (created === undefined) {
      return;
    }
    const content =
      created.roleName === undefined
        ? `Function “${created.name}” is being created in the local emulator.`
        : `Function “${created.name}” is being created in the local emulator, with the execution role “${created.roleName}”.`;
    flash.handOver(functionPath(created.name), [{ type: 'success', content }]);
  }, [created, flash]);

  const nameError = checked ? nameMessage(name) : undefined;
  const roleError = checked && roleChoice === 'existing' && existingRole === null ? CHOOSE_ROLE : undefined;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || pending) {
      return;
    }
    setChecked(true);
    const nameProblem = nameMessage(name);
    const roleProblem = roleChoice === 'existing' && existingRole === null;
    if (nameProblem !== undefined) {
      nameRef.current?.focus();
      return;
    }
    if (roleProblem) {
      roleRef.current?.focus();
      return;
    }
    const request: CreateFunctionRequest = {
      name,
      runtime: runtime.value ?? '',
      architecture,
      role:
        roleChoice === 'existing' && existingRole !== null
          ? { kind: 'existing', arn: existingRole.value ?? '' }
          : { kind: 'default' },
    };
    busy.current = true;
    create(request);
  };

  const handleCancel = () => {
    void navigate(FUNCTIONS_PATH);
  };

  const handleRoleChange = useCallback((option: SelectProps.Option) => {
    setExistingRole(option);
  }, []);

  const failureItem = failure === undefined ? undefined : actionFailureItem(failure.failure, failure.step, endpoint);

  return (
    <>
      <ContentLayout
        header={
          <Header variant="h1" description={DESCRIPTION}>
            {CREATE_FUNCTION_TITLE}
          </Header>
        }
      >
        <form onSubmit={handleSubmit} noValidate>
          <Form
            actions={
              <SpaceBetween direction="horizontal" size="xs">
                <Button variant="link" formAction="none" onClick={handleCancel}>
                  Cancel
                </Button>
                <Button variant="primary" loading={pending} loadingText="Creating the function">
                  {CREATE_FUNCTION_TITLE}
                </Button>
              </SpaceBetween>
            }
          >
            <SpaceBetween size="l">
              <Container header={<Header variant="h2">Basic information</Header>}>
                <SpaceBetween size="l">
                  <FormField label={FUNCTION_NAME} errorText={nameError}>
                    <Input
                      ref={nameRef}
                      value={name}
                      onChange={({ detail }) => {
                        setName(detail.value);
                      }}
                      invalid={nameError !== undefined}
                      autoComplete={false}
                      spellcheck={false}
                    />
                  </FormField>
                  <FormField label={RUNTIME} description={RUNTIME_DESCRIPTION}>
                    <Select
                      selectedOption={runtime}
                      onChange={({ detail }) => {
                        setRuntime(detail.selectedOption);
                      }}
                      options={RUNTIME_OPTIONS}
                    />
                  </FormField>
                  <FormField label={ARCHITECTURE}>
                    <RadioGroup
                      value={architecture}
                      onChange={({ detail }) => {
                        setArchitecture(detail.value as Architecture);
                      }}
                      items={ARCHITECTURES.map((value) => ({ value, label: value }))}
                    />
                  </FormField>
                </SpaceBetween>
              </Container>
              <Container header={<Header variant="h2">Permissions</Header>}>
                <SpaceBetween size="l">
                  <FormField label={EXECUTION_ROLE}>
                    <RadioGroup
                      value={roleChoice}
                      onChange={({ detail }) => {
                        setRoleChoice(detail.value as RoleChoice);
                      }}
                      items={[
                        { value: 'default', label: CREATE_DEFAULT_ROLE, description: CREATE_DEFAULT_ROLE_DESCRIPTION },
                        { value: 'existing', label: USE_ANOTHER_ROLE },
                      ]}
                    />
                  </FormField>
                  {roleChoice === 'existing' && (
                    <RoleSelect
                      ref={roleRef}
                      endpoint={endpoint}
                      chosen={existingRole}
                      onChange={handleRoleChange}
                      errorText={roleError}
                    />
                  )}
                </SpaceBetween>
              </Container>
              {failure !== undefined && failureItem !== undefined && (
                <Alert type={failureItem.type} header={failureItem.header}>
                  <SpaceBetween size="xxs">
                    <Box variant="span" color="inherit">
                      {failureItem.content}
                    </Box>
                    {failure.createdRole !== undefined && (
                      <Box variant="p" color="inherit">
                        {roleStillThere(failure.createdRole.name)}
                      </Box>
                    )}
                  </SpaceBetween>
                </Alert>
              )}
            </SpaceBetween>
          </Form>
        </form>
      </ContentLayout>
      {announcement}
    </>
  );
}
