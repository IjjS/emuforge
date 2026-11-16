// Used by unit tests only; nothing in the app imports it. The shared example of an AWS service the area has no
// screen for (test-criteria.md, issue 56, "Existing checks rewritten"; requirement R10): a case that needs "a
// service without a screen" opens this one, never a service that has a screen of its own or will get one by an open
// issue. Amazon Kinesis is the example: Studio lists it (`providers/aws/services.ts`) and no issue builds a screen
// for it yet. Its captures are under `docs/aws-console/`, so it may get one: the requirement that plans that screen
// moves this example to another service without one, here and in the other file, as issue 56 did for S3.
// `tests/integration/studio/support/no-screen.ts` holds the same example for the flow checks.

/** Amazon Kinesis: its label (the `h1` of its "no screen yet" page), crumb, route and a path below the route. */
export const NO_SCREEN_SERVICE = {
  label: 'Amazon Kinesis',
  crumb: 'Kinesis',
  path: '/aws/kinesis',
  below: '/aws/kinesis/streams',
} as const;

/** The sentence of the "no screen yet" page of `NO_SCREEN_SERVICE`. */
export const NO_SCREEN_SENTENCE = `Studio has no screen for ${NO_SCREEN_SERVICE.label} yet.`;
