Issue-Id: 670
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.rule|edit-rule-and-targets
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Change an EventBridge rule and its targets: pattern, schedule, target settings, tags, and trying a pattern

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
Issue 75 builds a rule and its targets once (Create rule, Add target, Remove, Enable, Disable, Delete rule). A rule cannot be changed afterwards: its pattern, schedule and description, a target's input transformer, dead-letter queue, retry policy and role, and a rule's tags are shown at most, never edited, and a pattern cannot be tried on a sample event. Reference: the same requests sent straight to aws-emulator (`PutRule`, `PutTargets`, `TagResource`, `TestEventPattern`). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ events test-event-pattern --event-pattern {"source":["shop"],"detail-type":["order placed"]} --event {"id":"1",…,"source":"shop","detail-type":"order placed","detail":{"n":7}}
   -> {"Result":true}
$ events test-event-pattern --event-pattern {"source":["other"]} --event {… "source":"shop" …}
   -> {"Result":false}
$ events test-event-pattern --event-pattern {"detail":{"n":[{"numeric":[">",5]}]}} --event {… "detail":{"n":7}}
   -> {"Result":true}
PutRule over an existing rule answers 200 and replaces pattern, schedule, state and description, keeping its targets and tags.
PutTargets with an Id the rule holds answers 200 and replaces that target; ListTargetsByRule returns InputTransformer, DeadLetterConfig, RetryPolicy and RoleArn as put.
TagResource / UntagResource / ListTagsForResource answer 200 for a rule's ARN.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and make a rule with a target on an event bus.
2. Open the rule's page under `/aws/events`.
3. Nothing on the page changes the rule's pattern, schedule or description, a target's settings or the rule's tags, or tries the pattern on an event.

## Expected
- A rule's pattern or schedule, description and state can be changed from its page; the emulator then reports the change, and the rule's targets and tags are as before.
- A target's input, input transformer, dead-letter queue, retry policy and role can be set and changed; the emulator reports them.
- A rule's tags can be read and changed.
- A pattern can be tried on a sample event and the screen says whether it matches, from `TestEventPattern`.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Giving a target the permission EventBridge needs (its own issue). Targets of kinds whose delivery the emulator was not seen to make. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
