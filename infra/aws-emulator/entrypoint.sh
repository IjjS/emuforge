#!/bin/sh
# Starts the emulator as the owner of the mounted folder $HOME/.aws/emulator, so that on Docker Engine on Linux
# the files it writes there belong to the user who must read them. The container starts as root only for this
# choice; the emulator itself never runs as root. The first rule that applies picks the user:
#   1. started with --user (this script is not root)      -> that user
#   2. no folder                                          -> 1000:0, the image's own user, under its own HOME
#   3. the folder's owner is not root                     -> that owner
#   4. the folder is root's and 1000:0 may write it       -> 1000:0 (Docker Desktop shows a mount so)
#   5. the folder is root's and 1000:0 may not write it   -> nobody: a message and exit 1
# Only the folder's owner and whether it may be written are looked at; no file in it is opened.
set -eu

folder="${HOME}/.aws/emulator"
image_user=1000:0

if [ "$(id -u)" != 0 ]; then
  exec aws-emulator "$@"
fi

user="$image_user"
if [ -d "$folder" ]; then
  owner="$(stat -L -c %u:%g "$folder")"
  case "$owner" in
    0:*)
      if ! chroot --userspec="$image_user" --groups=0 --skip-chdir / test -w "$folder"; then
        echo "aws-emulator image: $folder belongs to root, and the emulator does not run as root. Docker creates the folder as root when it is missing at the first start. Give it to your user (sudo chown \"\$(id -u):\$(id -g)\" ~/.aws ~/.aws/emulator), or create it yourself before the first start (mkdir -p ~/.aws/emulator), then start again." >&2
        exit 1
      fi
      ;;
    *)
      user="$owner"
      ;;
  esac
fi

exec chroot --userspec="$user" --groups="${user#*:}" --skip-chdir / aws-emulator "$@"
