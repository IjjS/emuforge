Issue-Id: 507
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: feature
Issue-Source: owner
Issue-Key: harness|docker|build-cache-kept-under-20gb-at-image-refresh
Issue-Check-Ids: harness.emulator-image harness.emulator-image-docs
Issue-Commit: 0d6a8c21280a35c1f7972ca0cb64e802463c568d

# Bring Docker's build cache down to 20 GB when the emulator image is refreshed to a new version

> Identified against commit `0d6a8c21280a35c1f7972ca0cb64e802463c568d`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

The owner, 2026-11-19, on the machine's disk: Docker's build cache stood at 34 GB (21 GB of it unused) while the
daemon's own collection is set to keep 20 GB (`~/.docker/daemon.json`, `builder.gc.defaultKeepStorage`); each new
emulator version (1.0.498, 1.0.514, 1.0.515 within a day) leaves 1.5 GB layers of the old one behind. The owner:
"20GB로 일단해서 하네스 정리 시점에 저 커맨드를 넣는게 좋겠는데" (10 GB would be too tight, since the owner
builds other things on the machine).

Wanted: when `pm-emulator-image refresh` ends with a changed version (the moment `EVENT emulator-image refreshed
<before> -> <after>` is told), it runs once `docker builder prune --max-used-space 20GB --force`, which removes the
least recently used cache until 20 GB are left, so the layers just built stay. It is tied to that event, never to
a timer. The line it prints (the space reclaimed) goes into the refresh's log and its outcome line. The bound is a
constant of the script, named so. A prune that fails or times out changes nothing of the refresh's outcome and is
said in one line. Nothing else of Docker is pruned: no image, container or volume, and no `docker system prune`.

## Evidence

`docker system df` on 2026-11-19 (Build Cache 34.2 GB, reclaimable 21.29 GB); `~/.docker/daemon.json`.

## Steps to Reproduce

`docker system df` after a day of checks across two emulator versions.

## Expected

After a refresh to a new version the build cache is at or under 20 GB, with the new version's layers kept.

## Out of scope
