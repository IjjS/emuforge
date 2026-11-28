Issue-Id: 677
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.pipes|screens
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the EventBridge Pipes screens: list, create, start, stop, delete

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The entry "Pipes" under `/aws/events` leads to the area's page for an entry without a screen, and Studio has no SDK client of the `pipes` model. The emulator keeps pipes and moves them through their states. Reference: the same requests sent straight to aws-emulator (the `pipes` model, 10 operations). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ pipes create-pipe --name p75-pipe --source arn:aws:sqs:us-east-1:000000000000:p75-in --target arn:aws:sqs:us-east-1:000000000000:p75-a --role-arn arn:aws:iam::000000000000:role/p75-role
   -> {"Arn":"arn:aws:pipes:us-east-1:000000000000:pipe/p75-pipe","Name":"p75-pipe","DesiredState":"RUNNING","CurrentState":"CREATING",…}
$ pipes describe-pipe --name p75-pipe
   -> {… "DesiredState":"RUNNING","CurrentState":"RUNNING","StateReason":"USER_IN…" …}
$ pipes stop-pipe --name p75-pipe
   -> {… "DesiredState":"STOPPED","CurrentState":"STOPPING" …}
$ pipes tag-resource / untag-resource (the pipe's ARN) -> 200
$ pipes delete-pipe --name p75-pipe
   -> {… "CurrentState":"DELETING" …}
Whether a running pipe moves a message from its source to its target was not observed.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open `/aws/events`.
2. Follow "Pipes" in the navigation.
3. The page says there is no screen yet.

## Expected
- The requirement first finds whether a running pipe carries a message from an SQS queue to its target, and the screens claim no more than that.
- Pipes are listed with their desired and current state, made (source, target and role chosen from the emulator's), described, started, stopped and deleted; a state that is still changing is read again until it settles.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Enrichment and filtering beyond what the requirement's probe shows the emulator applies. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
