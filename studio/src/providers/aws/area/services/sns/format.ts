import { AWS_PATH } from '../../../identity';

// How the SNS screens address a topic and read its values (issue 536, design "The service's files"). A topic is
// named by its ARN alone, as the API names it; Studio builds no ARN from a name, since the Region and the account are
// the emulator's to say. Every name is cut from an ARN the emulator returned.

/** Shown for a value the answer lacks. */
export const NONE = '-';

/** SNS's route in the area, `/aws/sns`. */
export const SNS_PATH = `${AWS_PATH}/sns`;

/** S1, the topics list. */
export const TOPICS_PATH = `${SNS_PATH}/topics`;

/** S2, "Create topic". */
export const CREATE_TOPIC_PATH = `${TOPICS_PATH}/create`;

/** The query parameter that names a topic page's tab. */
export const TAB_PARAMETER = 'tab';

/** The tabs of a topic's page: "Subscriptions" at the page's own address, "Publish" at `?tab=publish`. */
export type TopicTab = 'subscriptions' | 'publish';

/** S3, a topic's page: its ARN percent-encoded once as one segment below `topic/`. */
export function topicHref(arn: string): string {
  return `${TOPICS_PATH}/topic/${encodeURIComponent(arn)}`;
}

/** S4, "Create subscription" for the topic `arn`. */
export function subscribeHref(arn: string): string {
  return `${topicHref(arn)}/subscribe`;
}

/** S3's "Publish" tab of the topic `arn`. */
export function publishTabHref(arn: string): string {
  return `${topicHref(arn)}?${TAB_PARAMETER}=publish`;
}

/** The tab a value of `?tab=` names: `publish` names "Publish"; no value and any other "Subscriptions". */
export function tabOf(value: string | null | undefined): TopicTab {
  return value === 'publish' ? 'publish' : 'subscriptions';
}

/** The suffix of a FIFO topic's name. */
export const FIFO_SUFFIX = '.fifo';

/** A topic's name: the text after its ARN's last `:`. */
export function topicName(arn: string): string {
  return arn.slice(arn.lastIndexOf(':') + 1);
}

/** "FIFO" for a name that ends with `.fifo`, "Standard" for any other. */
export function topicType(name: string): 'FIFO' | 'Standard' {
  return name.endsWith(FIFO_SUFFIX) ? 'FIFO' : 'Standard';
}

const FUNCTION_ARN = /^arn:[^:]+:lambda:[^:]*:[^:]*:function:([^:]+)(?::[^:]*)?$/;

/**
 * The name an endpoint's ARN ends with: a queue's name (`arn:aws:sqs:{region}:{account}:{name}`), a function's name
 * (`…:function:{name}`, a qualifier after it left out), or for any other text what follows its last `:`.
 */
export function endpointName(arn: string): string {
  const fn = FUNCTION_ARN.exec(arn);
  if (fn?.[1] !== undefined) {
    return fn[1];
  }
  return arn.slice(arn.lastIndexOf(':') + 1);
}
