import Alert, { type AlertProps } from '@cloudscape-design/components/alert';
import Box from '@cloudscape-design/components/box';
import Button, { type ButtonProps } from '@cloudscape-design/components/button';
import Container from '@cloudscape-design/components/container';
import Form from '@cloudscape-design/components/form';
import Header from '@cloudscape-design/components/header';
import Link from '@cloudscape-design/components/link';
import type { SelectProps } from '@cloudscape-design/components/select';
import SpaceBetween from '@cloudscape-design/components/space-between';
import StatusIndicator from '@cloudscape-design/components/status-indicator';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router';

import { DiscardDialog, type DiscardAnswer } from '../../../components/discard-dialog';
import { actionFailureItem, readFailureState, ReadFailure, useAnnouncer } from '../../../components/failure-states';
import { usePageFlash, type FlashItem } from '../../../components/page-flash';
import { useShowsResources } from '../../../components/page-resources';
import { useFollow } from '../../../components/use-follow';
import { failureOf } from '../../../components/use-token-listing';
import { ValueText } from '../../../components/value-text';
import type { VpcChoice } from '../../../lib/ec2-network-choices';
import type { ScreenPageProps } from '../../../screens';
import type { InternetGateway } from '../api';
import { CHOOSE_A_VPC, VpcField } from '../components/vpc-field';
import {
  ATTACH_INTERNET_GATEWAY_TITLE,
  INTERNET_GATEWAYS_WORD,
  internetGatewaysHref,
  nameOrId,
  VPC_QUERY,
} from '../format';
import { GATEWAY_CHANGE_OPERATIONS } from '../gateway-changes-api';
import { useAttachGateway } from '../gateway-changes';
import { useInternetGateway } from '../queries';

// S14, "Attach internet gateway" (issue 574, design task 3): the gateway of the address, read by the filter
// `internet-gateway-id`, and the VPC, chosen a page of `DescribeVpcs` at a time when the field opens. One
// `AttachInternetGateway`; on 200 the gateways list opens with the result. A gateway that is attached already shows
// that, with a link to the list, and no form; one the emulator does not hold is "Internet gateway not found". Once an
// attach is sent, the form stays as it was sent: the gateway's own read, asked again by the attach and answering
// "attached" before the list opens, does not turn the page to its "is attached" state.

const ATTACHING = 'Attaching';
const ATTACH = 'Attach';

/** A box of the page in the place of the form, with Cloudscape's empty-state pattern. */
function Notice({ title, body, back }: { title?: string; body: string; back: string }) {
  const handleFollow = useFollow();
  return (
    <Container>
      <Box textAlign="center" color="inherit">
        <SpaceBetween size="xxs">
          {title !== undefined && (
            <Box variant="strong" color="inherit">
              {title}
            </Box>
          )}
          <Box variant="p" color="inherit">
            <ValueText kind="text" value={body} />
          </Box>
          <Link href={back} onFollow={handleFollow}>
            View internet gateways
          </Link>
        </SpaceBetween>
      </Box>
    </Container>
  );
}

/**
 * `/aws/vpc/internet-gateways/gateway/{id}/attach`. A failed read of the gateway is read again once the connection is
 * connected again.
 */
export function AttachGatewayPage({ connection, params }: ScreenPageProps) {
  useShowsResources(INTERNET_GATEWAYS_WORD);
  const id = params['id'] ?? '';
  const navigate = useNavigate();
  const flash = usePageFlash();
  const [announcement, announce] = useAnnouncer();
  const engineOrigin = connection.engineOrigin;
  const attach = useAttachGateway(engineOrigin);
  const reading = useInternetGateway(engineOrigin, id);
  const { value: read, failure: readFailure, refresh } = reading;
  // The VPC of `?vpc=`, chosen at start by the one rule of `?vpc=` (S5, S8) when the emulator holds it.
  const [query] = useSearchParams();
  const [preset] = useState(() => {
    const value = query.get(VPC_QUERY);
    return value === null || value === '' ? undefined : value;
  });
  // Every way back to S12 keeps the VPC of `?vpc=`.
  const back = internetGatewaysHref(preset);

  const [vpc, setVpc] = useState<VpcChoice>();
  const [openedWith, setOpenedWith] = useState<VpcChoice>();
  const [tried, setTried] = useState(false);
  const [failure, setFailure] = useState<FlashItem>();
  const [pending, setPending] = useState(false);
  // The detached gateway the form was sent for, kept while the attach is in flight or has succeeded.
  const [sentFor, setSentFor] = useState<InternetGateway>();

  const vpcRef = useRef<SelectProps.Ref>(null);
  const failureRef = useRef<AlertProps.Ref>(null);

  const busy = useRef(false);
  const inFlight = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      inFlight.current?.abort();
    },
    [],
  );

  useEffect(() => {
    if (failure !== undefined) {
      failureRef.current?.focus();
    }
  }, [failure]);

  const failureState =
    readFailure === undefined || sentFor !== undefined
      ? undefined
      : readFailureState(readFailure, connection, 'internet gateway');

  // Kept from the previous render, as React's own pattern for it, so each change is acted on once.
  const [seenFailureLine, setSeenFailureLine] = useState<string>();
  const failureLine = failureState?.firstText;
  const connected = connection.result?.kind === 'connected';
  const [seenConnected, setSeenConnected] = useState(connected);
  const down = connection.result !== undefined && !connected;
  const [wasDown, setWasDown] = useState(down);
  if (down && !wasDown) {
    setWasDown(true);
  }
  if (failureLine !== seenFailureLine) {
    setSeenFailureLine(failureLine);
    if (failureLine !== undefined) {
      announce(failureLine);
    }
  }
  if (connected !== seenConnected) {
    setSeenConnected(connected);
    if (connected && (readFailure !== undefined || wasDown) && sentFor === undefined) {
      setWasDown(false);
      refresh();
    }
  }

  const gateway = sentFor ?? (read?.found === true ? read.value : undefined);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy.current || gateway === undefined || gateway.vpcId !== undefined) {
      return;
    }
    setTried(true);
    setFailure(undefined);
    if (vpc === undefined) {
      vpcRef.current?.focus();
      return;
    }
    const operation = GATEWAY_CHANGE_OPERATIONS.attachInternetGateway;
    const what = `Attaching internet gateway ${nameOrId(gateway.id, gateway.tags)}`;
    if (engineOrigin === undefined) {
      setFailure(actionFailureItem({ kind: 'engine-did-not-answer', operation }, what, undefined));
      return;
    }
    busy.current = true;
    setPending(true);
    setSentFor(gateway);
    const controller = new AbortController();
    inFlight.current = controller;
    const settle = () => {
      inFlight.current = null;
      busy.current = false;
      setPending(false);
    };
    try {
      await attach(gateway.id, vpc.id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      settle();
      flash.handOver(back, [{ type: 'success', content: `Attached ${gateway.id} to ${vpc.id}` }]);
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }
      settle();
      setSentFor(undefined);
      setFailure(actionFailureItem(failureOf(error, operation), what, engineOrigin));
    }
  };

  // "Cancel" leaves at once while no VPC is chosen, or the one of `?vpc=` still is; otherwise it asks
  // (`aws-area.md`, entry 5).
  const [asking, setAsking] = useState(false);
  const cancelRef = useRef<ButtonProps.Ref>(null);
  const [kept, setKept] = useState(0);
  useEffect(() => {
    if (kept > 0) {
      cancelRef.current?.focus();
    }
  }, [kept]);
  const handleCancel = () => {
    if (vpc !== undefined && vpc.id !== openedWith?.id) {
      setAsking(true);
      return;
    }
    void navigate(back);
  };
  const handleDiscardAnswer = useCallback(
    (answer: DiscardAnswer) => {
      setAsking(false);
      if (answer === 'discard') {
        void navigate(back);
      } else {
        setKept((count) => count + 1);
      }
    },
    [navigate, back],
  );

  const handleVpc = useCallback((chosen: VpcChoice | undefined) => {
    setVpc(chosen);
  }, []);
  const handlePresetSettled = useCallback((chosen: VpcChoice | undefined) => {
    setOpenedWith(chosen);
  }, []);

  let content;
  let description;
  if (failureState !== undefined) {
    content = (
      <Container>
        <ReadFailure state={failureState} onRetry={refresh} />
      </Container>
    );
  } else if (gateway === undefined && read === undefined) {
    content = (
      <Container>
        <Box textAlign="center" color="inherit">
          <StatusIndicator type="loading">Loading internet gateway</StatusIndicator>
        </Box>
      </Container>
    );
  } else if (gateway === undefined) {
    content = (
      <Notice
        title="Internet gateway not found"
        body="The emulator holds no internet gateway with this ID."
        back={back}
      />
    );
  } else if (gateway.vpcId !== undefined) {
    content = <Notice body={`${gateway.id} is attached to ${gateway.vpcId}.`} back={back} />;
  } else {
    description = `Attaches ${nameOrId(gateway.id, gateway.tags)} to a VPC.`;
    content = (
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Form
          actions={
            <SpaceBetween direction="horizontal" size="xs">
              <Button ref={cancelRef} variant="link" formAction="none" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="primary" loading={pending} loadingText={ATTACHING}>
                {pending ? ATTACHING : ATTACH}
              </Button>
            </SpaceBetween>
          }
        >
          <SpaceBetween size="l">
            <Container>
              <VpcField
                connection={connection}
                value={vpc}
                onChange={handleVpc}
                preset={preset}
                onPresetSettled={handlePresetSettled}
                errorText={tried && vpc === undefined ? CHOOSE_A_VPC : undefined}
                selectRef={vpcRef}
              />
            </Container>

            {failure !== undefined && (
              <Alert ref={failureRef} type={failure.type} header={failure.header}>
                {failure.content}
              </Alert>
            )}
          </SpaceBetween>
        </Form>
      </form>
    );
  }

  return (
    <SpaceBetween size="l">
      <Header variant="h1" {...(description === undefined ? {} : { description })}>
        {ATTACH_INTERNET_GATEWAY_TITLE}
      </Header>
      {content}
      {asking && <DiscardDialog visible onAnswer={handleDiscardAnswer} />}
      {announcement}
    </SpaceBetween>
  );
}
