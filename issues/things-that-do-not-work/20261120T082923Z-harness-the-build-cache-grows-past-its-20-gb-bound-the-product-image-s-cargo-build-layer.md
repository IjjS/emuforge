Issue-Id: 593
Issue-Severity: MEDIUM
Issue-Module: harness
Issue-Kind: bug
Issue-Source: finder
Issue-Key: harness|build-cache.bound|shared-records-not-counted
Issue-Check-Ids:
Issue-Commit: 05b68ccc7d8ea286238146d70e73c9bf6fc44441

# The build cache grows past its 20 GB bound: the product image's cargo build layers are not counted

> Identified against commit `05b68ccc7d8ea286238146d70e73c9bf6fc44441`. The code may have drifted since; trace the issue to the current code before fixing.

## Description

On 2026-11-20 at 17:40 `docker buildx du` gave `Shared: 29.87GB`, `Private: 21.43GB`, `Total: 51.3GB`, all of it
`Reclaimable`, on a disk with 18 GB free. The bound of 20 GB (issue 507: `pm-emulator-image` runs `docker builder prune
--max-used-space 20000000000` after a refresh to a new version; Docker's own `builder.gc.defaultKeepStorage` is 20GB too)
holds for the private records only, as issue 554 found and `pm-emulator-image` says.

Issue 554 read the shared part as the images' own disk. It is not: of the 29.87 GB shared, 24.88 GB is 78 records of one
step, `cargo build --release --locked -p emuforge --features embed-studio` of the build stage of
`infra/emuforge/Dockerfile`, 0.32 GB each, each used once, the newest minutes old. That stage is in no image (the
product image is 151 MB; all tagged images together hold about 7 GB). Every build of the product image from a changed
tree (a check run's, in every worktree) leaves one such record, it is counted as shared, and so neither Docker's
garbage collection nor the prune at a refresh ever removes it. With three issues building at once the cache grew by
several GB in an afternoon, and it is pruned only when the emulator's version changes.

## Evidence

`.pm/run/evidence/buildx-du-verbose-20261120T1740.txt` (`docker buildx du --verbose`, 805 records); `~/.docker/daemon.json` (`builder.gc.defaultKeepStorage` 20GB); `.pm/run/emulator-image-refresh.log` (the prune of 14:13: reclaimed 1.664GB, private 19.81GB left, image-shared 27.31GB apart).

## Steps to Reproduce

Run `pm-check` on worktrees with different trees several times; read `docker buildx du` and, with `--verbose`, the records whose description starts `mount / from exec /bin/sh -c cargo build --release`.

## Expected

The build cache the harness's builds leave stays under a bound that counts what they really take, the product image's build layers included, and it is brought down more often than at a change of the emulator's version (for example after a check run's own clean-up, by the records that run made or by age). Nothing of another project's cache or of a running build is removed.

## Out of scope

How the product image is built (a cache mount for cargo's target folder would make each record small): that is a product change, filed apart if wanted.
