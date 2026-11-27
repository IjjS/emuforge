Issue-Id: 673
Issue-Severity: LOW
Issue-Module: studio
Issue-Kind: feature
Issue-Source: plan
Issue-Key: studio|events.archive|screens
Issue-Check-Ids:
Issue-Commit: fab7ba7217133ac83b9d3844d380d1db51565c41

# Build the EventBridge archive and replay screens

> Identified against commit `fab7ba7217133ac83b9d3844d380d1db51565c41`. The code may have drifted since; trace the issue to the current code before fixing.

## Description
The entries "Archives" and "Replays" of EventBridge lead to the area's page for an entry without a screen. The emulator keeps archives and replays. Reference: the same requests sent straight to aws-emulator (`CreateArchive`, `ListArchives`, `DescribeArchive`, `UpdateArchive`, `DeleteArchive`, `StartReplay`, `ListReplays`, `DescribeReplay`, `CancelReplay`). Found while planning issue 75, which builds the event bus, rule, target and send screens.

## Evidence
Called on aws-emulator 1.0.633, a fresh one started for the probe and signed with its own files, while planning issue 75 (EventBridge):

```
$ events create-archive --archive-name p75-arch --event-source-arn arn:aws:events:us-east-1:000000000000:event-bus/p75e --description all --retention-days 1
   -> {"ArchiveArn":"arn:aws:events:us-east-1:000000000000:archive/p75-arch","State":"ENABLED",…}
$ events create-archive --archive-name p75-arch2 --event-source-arn …:event-bus/p75-missing
   -> ResourceNotFoundException: Event bus p75-missing does not exist.
$ events put-events … EventBusName=p75e ; events describe-archive --archive-name p75-arch --query [EventCount,SizeBytes,State]
   -> [1,203,"ENABLED"]
$ events start-replay --replay-name p75-rep --event-source-arn …:archive/p75-arch --event-start-time … --event-end-time … --destination Arn=…:event-bus/…
   -> {"ReplayArn":"arn:aws:events:us-east-1:000000000000:replay/p75-rep","State":"STARTING",…}
$ events cancel-replay --replay-name p75-rep
   -> {"ReplayArn":"…","State":"CANCELLING"}
Whether a replay delivers the archived events again was not observed.
```

## Steps to Reproduce
1. Start EmuForge with a fresh emulator and open `/aws/events`.
2. Follow "Archives" or "Replays" in the navigation.
3. The page says there is no screen yet.

## Expected
- The archives of the emulator are listed, one can be made for an event bus, described, changed and deleted.
- A replay can be started from an archive, listed, described and cancelled; the requirement first finds whether the emulator delivers replayed events and the screen claims no more than that.
- The requirement first calls every operation it uses with real arguments and records what comes back.
- Resources made outside Studio appear; every read goes to the emulator through the engine.
- Loading, empty, a failure, the emulator not reachable and an operation answered 501 ("Not implemented by the emulator", with the operation's name) each have their own state.
- The screens pass the impeccable critique on the built app (`studio/references/critique.md`).

## Out of scope
Archives of partner event sources. Any engine change (filed separately if the requirement finds one is needed). Anything sent to real AWS.
