Issue-Id: 676
Issue-Severity: MEDIUM
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.scheduler|screens
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the EventBridge Scheduler screens: schedule groups and schedules

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The entries of EventBridge Scheduler under `/aws/events` lead to the area's page for an entry without a screen, and Studio has no SDK client of the `scheduler` model. The emulator keeps schedule groups; a schedule needs a role that lets Scheduler assume it. Reference: the same requests sent straight to aws-emulator (the `scheduler` model, 12 operations). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ scheduler list-schedule-groups
   -> {"ScheduleGroups":[{"Arn":"arn:aws:scheduler:us-east-1:000000000000:schedule-group/default","Name":"default","State":"ACTIVE"}]}
$ scheduler create-schedule-group --name p75-grp
   -> {"ScheduleGroupArn":"arn:aws:scheduler:us-east-1:000000000000:schedule-group/p75-grp"}
$ scheduler create-schedule --name p75-s --group-name p75-grp --schedule-expression rate(1 minute) --flexible-time-window Mode=OFF --target Arn=arn:aws:sqs:…:p75-a,RoleArn=arn:aws:iam::000000000000:role/p75-role
   -> ValidationException: The execution role you provide must allow AWS EventBridge Scheduler to assume the role.
$ scheduler list-schedules --group-name p75-grp
   -> {"Schedules":[]}
$ scheduler tag-resource / untag-resource / list-tags-for-resource (a schedule group's ARN) -> 200
$ scheduler delete-schedule-group --name p75-grp -> 200
A schedule with a role that Scheduler may assume was not made, so whether a schedule fires was not observed.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open `/aws/events`.
2. Follow "Schedules" or "Schedule groups" in the navigation.
3. The page says there is no screen yet.

## Expected
- The requirement first makes a schedule with a role that lets `scheduler.amazonaws.com` assume it and finds whether it fires.
- Schedule groups are listed, made and deleted, `default` included; schedules are listed by group, made (a rate, a cron or a one-time expression; a target and a role chosen from the emulator's), described, changed and deleted.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Scheduled rules on the default event bus, which issue 75 builds on the rule form. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
