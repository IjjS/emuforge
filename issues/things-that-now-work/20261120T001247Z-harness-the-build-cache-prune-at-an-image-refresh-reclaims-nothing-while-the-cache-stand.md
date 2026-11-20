Issue-Id: 554
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|docker|build-cache-prune-reclaims-nothing
Issue-Check-Ids: none (harness issue, no kept guard shows it)
Issue-Commit: 8fa9756f1c35f10b47234e3b548dd0517141ee0a

# The build cache prune at an image refresh reclaims nothing while the cache stands at 43 GB

> Identified against commit `8fa9756f1c35f10b47234e3b548dd0517141ee0a`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

Issue 507 runs `docker builder prune --max-used-space 20GB --force` when `pm-emulator-image refresh` ends with a new
version. Its first real run, 2026-11-20 09:11 (1.0.515 to 1.0.531): Docker printed `Total: 0B`, the outcome line reads
`build cache pruned to 20GB (reclaimed 0B)`, and `docker system df` right after shows `Build Cache 808 … 43.73GB`,
of which `20.17GB` reclaimable. The bound did not bring the cache down: the option does not do alone what the issue
took it to do on this builder (Docker 29.4.3, buildx v0.33.0-desktop.1, the Docker Desktop builder), or the size it
counts is not the size `docker system df` shows (shared layers). Issue 507 tested the call against a stand-in only.

Wanted: after a refresh to a new version the build cache `docker system df` shows is at or under 20 GB, by whatever
call of `docker builder prune` does that here (found by reading its options and what `docker buildx du` counts, and by
one real run on this machine, which the owner's decision of 2026-11-19 covers: the build cache down to 20 GB, nothing
else of Docker). The outcome line says what was reclaimed and the size left. Still no image, container or volume is
pruned and never `docker system prune`. No test is added (issue 523); the engineer's real run is the evidence.

## Evidence

`.pm/run/emulator-image-refresh.log` (the lines after "build cache prune down to 20GB"); `docker system df` at 09:12.

## Steps to Reproduce

`pm-emulator-image refresh` to a new version; `docker system df`.

## Expected

The build cache is at or under 20 GB after the refresh.

## Out of scope
