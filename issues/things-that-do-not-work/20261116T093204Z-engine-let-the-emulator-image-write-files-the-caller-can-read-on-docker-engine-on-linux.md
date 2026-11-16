Issue-Id: 55
Issue-Severity: MEDIUM
Issue-Module: engine
Issue-Kind: bug
Issue-Source: plan
Issue-Key: engine|emulator-image|fixed-uid-on-linux
Issue-Check-Ids:
Issue-Commit: f0bf02e915a04b2f17f1176275a3e00c75073aae

# Let the emulator image write files the caller can read on Docker Engine on Linux

> Identified against commit `f0bf02e915a04b2f17f1176275a3e00c75073aae`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The emulator image runs as uid 1000 (`infra/aws-emulator/Dockerfile`: `USER 1000`) and writes its keys and
certificate into the host folder `~/.aws/emulator/<port>/`, mode `0700`, each file `0600`. Docker Desktop shows
those files to the host as the host user's, so on macOS the engine, the AWS CLI and the checks can read them.
Docker Engine on Linux does no such mapping: when the host user's uid is not 1000 the emulator either cannot
write under that user's home, or writes files that user cannot read. The README's "Run the emulator" then does
not work for that user, and neither does anything that reads `ca.pem`.

Issue #53's workflow works around it on the runner by giving the image the runner user's uid in a step of its
own; this issue is the fix in the image and its Compose file, after which that step is removed.

Reference: the same start on macOS with Docker Desktop.

## Evidence

Emulator 1.0.364 (commit `7496e0f`), image `aws-emulator` built from `infra/aws-emulator/`. A Docker volume
inside the Docker VM is a Linux filesystem without Docker Desktop's mapping; the volume is mounted where the
host folder would be, with `HOME=/home/runner` (the output of the plan's probe for issue #53):

```
## A: parent dir owned by 1001:1001 mode 755 (a runner's home), emulator as image user 1000
drwxr-xr-x 2 1001 1001 4096 Nov 16 09:23 /home/runner/.aws/emulator
state: exited exit=1
emulator serve failed: server I/O error: Permission denied (os error 13)
## B: parent dir mode 777, emulator as image user 1000; read as 1001
state: running
drwx------ 2 1000 0 4096 Nov 16 09:23 /home/runner/.aws/emulator/9399
head: cannot open '/home/runner/.aws/emulator/9399/ca.pem' for reading: Permission denied
uid 1001 cannot open ca.pem
## C on a fresh volume: parent 1001:1001 mode 755, emulator started with --user 1001:1001
state: running exit=0
drwx------ 2 1001 1001 4096 Nov 16 09:23 /home/runner/.aws/emulator/9399
uid 1001 can open ca.pem
health 200
```

Not yet observed on a Linux host itself; the unit that takes this issue reproduces it there first.

## Steps to Reproduce

1. `docker volume create v && docker run --rm --user 0 -v v:/home/runner/.aws/emulator --entrypoint sh aws-emulator -c 'chown 1001:1001 /home/runner/.aws/emulator'`
2. `docker run -d --name e -e HOME=/home/runner -v v:/home/runner/.aws/emulator aws-emulator -p 9399 -t off`
3. `docker inspect -f '{{.State.Status}} {{.State.ExitCode}}' e` prints `exited 1`; `docker logs e` ends with
   `Permission denied (os error 13)`.
4. Remove the container and the volume.

## Expected

- On Docker Engine on Linux, with a host user whose uid is not 1000, the README's emulator start gives an
  emulator whose health route answers 200 and whose `~/.aws/emulator/<port>/` files that user can read and no
  other user can.
- On macOS with Docker Desktop every start of the emulator (the Compose file, `tests/integration/run`, the
  checks' own emulators, the product form's `emulator` profile) behaves as today.
- The files keep mode `0600` and the folder `0700`.
- The workflow step of issue #53 that changes the image's user is removed by the unit that fixes this.

## Out of scope

- The product form's route to the host's emulator on Linux (issue #54).
- Rootless Docker and user-namespace remapping.
