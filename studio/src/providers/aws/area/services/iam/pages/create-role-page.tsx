import Alert from '@cloudscape-design/components/alert';
import type { AutosuggestProps } from '@cloudscape-design/components/autosuggest';
import type { InputProps } from '@cloudscape-design/components/input';
import type { TextareaProps } from '@cloudscape-design/components/textarea';
import Wizard, { type WizardProps } from '@cloudscape-design/components/wizard';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import type { FlashItem } from '../../../components/page-flash';
import { usePageFlash } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import type { ScreenPageProps } from '../../../screens';
import type { IamFailure } from '../api';
import { CREATE_ROLE_PATH, ROLES_PATH } from '../format';
import { failureOf, useCallerAccount, useCreateRole } from '../queries';
import { INITIAL_CUSTOM_TRUST_POLICY, trustPolicyText } from '../trust-policy';
import { createdRoleResult } from '../components/created-role';
import {
  accountChoiceOf,
  firstField,
  STEPS,
  stepMessages,
  stepOf,
  tagsBroken,
  tagsOf,
  trustedEntityOf,
  type CallerAccount,
  type Field,
  type Messages,
  type TrustedEntityValues,
  type WizardStep,
  type WizardValues,
} from '../components/create-role-rules';
import { actionFailureItem } from '../components/failures';
import { PermissionsStep } from '../components/permissions-step';
import { ReviewStep } from '../components/review-step';
import { TrustedEntityStep } from '../components/trusted-entity-step';

// IAM's "Create role" (issue 82, requirement R6, R9.4, R10.3): a Cloudscape wizard of the console's three steps in
// the console's words, at `/aws/iam/roles/create`, its step `k` at `?step=<k>`. What is typed lives in this page
// alone and is gone once it is left (R6.8). The rules decide at "Next" for the step shown and at "Create role" for
// all three; nothing counts as passed by the address alone (R6.2, R6.6). Issue 467: the steps carry no description,
// the area's frame says where the role is made (requirement R3); each checked field states its rule from the start
// (R4); and "Cancel" asks before it discards what was entered on any step (R7).

/** The page's title, and its last crumb. */
export const CREATE_ROLE_TITLE = 'Create role';

const STEP_TITLES: Record<WizardStep, string> = {
  1: 'Select trusted entity',
  2: 'Add permissions',
  3: 'Name, review, and create',
};

const START: WizardValues = {
  entity: {
    type: 'aws-service',
    principal: '',
    account: 'this',
    accountId: '',
    requireExternalId: false,
    externalId: '',
    requireMfa: false,
    document: INITIAL_CUSTOM_TRUST_POLICY,
  },
  policies: [],
  name: '',
  description: '',
  tags: [],
};

/**
 * Whether anything differs from what the wizard showed when it opened (issue 467, R7), on any step: a field, a choice
 * or a row. A value typed and removed again does not differ; one kept by a type or a box no longer shown still does,
 * since choosing it again shows it.
 */
function differsFromStart(values: WizardValues): boolean {
  const entity = values.entity;
  const start = START.entity;
  return (
    entity.type !== start.type ||
    entity.principal !== start.principal ||
    entity.account !== start.account ||
    entity.accountId !== start.accountId ||
    entity.requireExternalId !== start.requireExternalId ||
    entity.externalId !== start.externalId ||
    entity.requireMfa !== start.requireMfa ||
    entity.document !== start.document ||
    values.policies.length > 0 ||
    values.name !== START.name ||
    values.description !== START.description ||
    values.tags.length > 0
  );
}

const I18N_STRINGS: WizardProps.I18nStrings = {
  stepNumberLabel: (stepNumber) => `Step ${String(stepNumber)}`,
  collapsedStepsLabel: (stepNumber, stepsCount) => `Step ${String(stepNumber)} of ${String(stepsCount)}`,
  navigationAriaLabel: 'Steps',
  cancelButton: 'Cancel',
  previousButton: 'Previous',
  nextButton: 'Next',
  submitButton: 'Create role',
  optional: 'optional',
  nextButtonLoadingAnnouncement: 'Loading next step',
  submitButtonLoadingAnnouncement: 'Creating the role',
};

/** Why "This account" could not be read, as R10.3 words a failure, for the line under the choice (R6.3). */
function callerFailureText(failure: IamFailure, engineOrigin: string | undefined): ReactNode {
  const item = actionFailureItem(failure, 'Reading this account', engineOrigin);
  if (failure.kind === 'other' || item.header === undefined) {
    return item.content;
  }
  return (
    <>
      {item.header}: {item.content}
    </>
  );
}

/** A field to move focus to once its step is shown. */
interface FocusRequest {
  step: WizardStep;
  field: Field;
}

/**
 * `/aws/iam/roles/create`: "Create role". "Create role" checks the three steps, then sends one `CreateRole` and, after
 * its answer, one `AttachRolePolicy` per chosen policy (R6.7); while they are in flight the button shows progress and
 * a second press sends nothing. Once the role exists the list opens with the result; a refused `CreateRole` keeps the
 * wizard and every value, with the failure above the buttons.
 */
export function CreateRolePage({ connection }: ScreenPageProps) {
  useShowsResources('roles');
  const navigate = useNavigate();
  const flash = usePageFlash();
  const [searchParams] = useSearchParams();
  const step = stepOf(searchParams.get('step'));
  const engineOrigin = connection.engineOrigin;

  const [values, setValues] = useState<WizardValues>(START);
  // The steps whose rules were checked: their messages are shown, and follow what is typed from then on.
  const [checked, setChecked] = useState<ReadonlySet<WizardStep>>(new Set());
  const [failure, setFailure] = useState<FlashItem>();
  const create = useCreateRole(engineOrigin);
  const pending = create.isPending;
  // Set at the press, before `isPending` re-renders (TanStack notifies on a later task): a second press in between
  // sends no second `CreateRole`. Cleared when the create fails; a created role leaves the page.
  const submitting = useRef(false);

  const callerQuery = useCallerAccount({ endpoint: engineOrigin, enabled: values.entity.type === 'aws-account' });
  const caller: CallerAccount = {
    account: callerQuery.account,
    loading: callerQuery.loading,
    unavailable:
      callerQuery.failure !== undefined ||
      (values.entity.type === 'aws-account' && !callerQuery.loading && callerQuery.account === undefined),
  };

  const principalRef = useRef<AutosuggestProps.Ref>(null);
  const accountIdRef = useRef<InputProps.Ref>(null);
  const externalIdRef = useRef<InputProps.Ref>(null);
  const documentRef = useRef<TextareaProps.Ref>(null);
  const nameRef = useRef<InputProps.Ref>(null);
  const descriptionRef = useRef<TextareaProps.Ref>(null);
  const tagsRef = useRef<HTMLDivElement>(null);

  // Focus moves to the first field with a message once its step is shown, after the wizard has put it on the
  // step's heading.
  const focusRequest = useRef<FocusRequest>(undefined);
  useEffect(() => {
    const request = focusRequest.current;
    if (request === undefined || request.step !== step) {
      return;
    }
    focusRequest.current = undefined;
    const fields: Record<Exclude<Field, 'tags' | 'policies'>, { focus: () => void } | null> = {
      principal: principalRef.current,
      accountId: accountIdRef.current,
      externalId: externalIdRef.current,
      document: documentRef.current,
      name: nameRef.current,
      description: descriptionRef.current,
    };
    if (request.field === 'tags') {
      focusBrokenTag(tagsRef.current, values.tags);
    } else if (request.field !== 'policies') {
      fields[request.field]?.focus();
    }
  });

  const shown = (k: WizardStep): Messages => (checked.has(k) ? stepMessages(k, values, caller) : {});
  const stepOnePasses = () =>
    firstField(1, stepMessages(1, values, caller)) === undefined && trustedEntityOf(values, caller) !== undefined;
  const brokenStep = (k: WizardStep): boolean =>
    k === 1 ? !stepOnePasses() : firstField(k, stepMessages(k, values, caller)) !== undefined;

  const goTo = (k: WizardStep) => {
    void navigate(`${CREATE_ROLE_PATH}?step=${String(k)}`);
  };

  /** Shows the messages of `broken`, on its step, with focus on its first field with a message. */
  const stopAt = (broken: WizardStep, alsoChecked: readonly WizardStep[] = []) => {
    setChecked((current) => new Set([...current, broken, ...alsoChecked]));
    const field = firstField(broken, stepMessages(broken, values, caller));
    focusRequest.current = field === undefined ? undefined : { step: broken, field };
    if (broken !== step) {
      goTo(broken);
    }
  };

  const handleNavigate = ({ detail }: { detail: WizardProps.NavigateDetail }) => {
    if (pending) {
      return;
    }
    const target = (detail.requestedStepIndex + 1) as WizardStep;
    if (target < step) {
      goTo(target);
      return;
    }
    // "Next" checks the step shown; a later step's entry, every step before it (R6.2, R6.6).
    const before = detail.reason === 'next' ? [step] : STEPS.filter((k) => k < target);
    const broken = before.find(brokenStep);
    if (broken !== undefined) {
      stopAt(broken);
      return;
    }
    goTo(target);
  };

  const handleSubmit = () => {
    if (pending || submitting.current) {
      return;
    }
    const broken = STEPS.find(brokenStep);
    if (broken !== undefined) {
      stopAt(broken, STEPS);
      return;
    }
    const entity = trustedEntityOf(values, caller);
    if (entity === undefined) {
      return;
    }
    setChecked(new Set(STEPS));
    setFailure(undefined);
    submitting.current = true;
    create.mutate(
      {
        name: values.name,
        trustPolicy: trustPolicyText(entity),
        ...(values.description !== '' && { description: values.description }),
        ...(values.tags.length > 0 && { tags: tagsOf(values.tags) }),
        policies: values.policies.map(({ name, arn }) => ({ name, arn })),
      },
      {
        onSuccess: (created) => {
          flash.handOver(ROLES_PATH, createdRoleResult(created, engineOrigin));
        },
        onError: (error) => {
          submitting.current = false;
          setFailure(actionFailureItem(failureOf(error), 'Creating the role', engineOrigin));
        },
      },
    );
  };

  const changeEntity = (change: Partial<TrustedEntityValues>) => {
    setValues((current) => ({ ...current, entity: { ...current.entity, ...change } }));
  };

  const entity = trustedEntityOf(values, caller);
  const trustPolicy = entity === undefined ? undefined : trustPolicyText(entity);

  const steps: WizardProps.Step[] = [
    {
      title: STEP_TITLES[1],
      content: (
        <TrustedEntityStep
          values={values.entity}
          onChange={changeEntity}
          accountChoice={accountChoiceOf(values.entity, caller)}
          thisAccountDisabled={caller.unavailable}
          thisAccountFailure={
            callerQuery.failure === undefined ? undefined : callerFailureText(callerQuery.failure, engineOrigin)
          }
          messages={shown(1)}
          principalRef={principalRef}
          accountIdRef={accountIdRef}
          externalIdRef={externalIdRef}
          documentRef={documentRef}
        />
      ),
    },
    {
      title: STEP_TITLES[2],
      content: (
        <PermissionsStep
          connection={connection}
          chosen={values.policies}
          onChoose={(policies) => {
            setValues((current) => ({ ...current, policies }));
          }}
          message={shown(2).policies}
        />
      ),
    },
    {
      title: STEP_TITLES[3],
      content: (
        <ReviewStep
          name={values.name}
          description={values.description}
          tags={values.tags}
          onChange={(change) => {
            setValues((current) => ({ ...current, ...change }));
          }}
          trustPolicy={trustPolicy}
          policies={values.policies}
          onEdit={goTo}
          messages={shown(3)}
          nameRef={nameRef}
          descriptionRef={descriptionRef}
          tagsRef={tagsRef}
          failure={
            failure !== undefined && (
              <Alert type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )
          }
        />
      ),
    },
  ];

  const waitingForAccount = step === 1 && values.entity.type === 'aws-account' && caller.loading;

  // "Cancel" leaves at once while nothing differs from what the wizard showed when it opened; otherwise it asks (R7).
  const [asking, setAsking] = useState(false);
  const handleCancel = () => {
    if (differsFromStart(values)) {
      setAsking(true);
      return;
    }
    void navigate(ROLES_PATH);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(ROLES_PATH);
      }
    },
    [navigate],
  );

  return (
    <>
      <Wizard
        steps={steps}
        activeStepIndex={step - 1}
        i18nStrings={I18N_STRINGS}
        isLoadingNextStep={pending || waitingForAccount}
        onNavigate={handleNavigate}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
      <DiscardDialog visible={asking} onAnswer={handleDiscardAnswer} />
    </>
  );
}

/**
 * Moves focus to the key of the first tag that breaks the editor's rules, through the field and out of it, so the
 * editor shows its own message for an empty key it has not seen typed in, then back to it.
 */
function focusBrokenTag(holder: HTMLDivElement | null, tags: WizardValues['tags']): void {
  if (holder === null || !tagsBroken(tags)) {
    return;
  }
  const keys = tags.map((tag) => tag.key);
  const row = keys.findIndex((key, index) => key === '' || keys.indexOf(key) !== index);
  const input = holder.querySelectorAll('input')[row * 2];
  if (input === undefined) {
    return;
  }
  input.focus();
  input.blur();
  input.focus();
}
