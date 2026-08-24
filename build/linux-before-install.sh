#!/bin/sh
# Stop an already-running XT Music before dpkg replaces the application files.
#
# Older releases close to the system tray and hold Electron's single-instance
# lock. Without this hook, launching the newly installed package only focuses
# the old process, so the UI and protocol code can remain on the previous
# version until the user logs out or kills it manually.

set -u

pids=""
for proc in /proc/[0-9]*; do
  [ -d "$proc" ] || continue
  pid=${proc##*/}
  [ "$pid" = "$$" ] && continue

  exe=$(readlink "$proc/exe" 2>/dev/null || true)
  cmd=$(tr '\000' ' ' < "$proc/cmdline" 2>/dev/null || true)

  case "$exe" in
    "/opt/XT Music/xtmusic"|"/opt/XT Music/xtmusic (deleted)"|/tmp/.mount_XT-Mu*/xtmusic)
      pids="$pids $pid"
      continue
      ;;
  esac

  case "$cmd" in
    *"/opt/XT Music/xtmusic"*|*"XT-Music-"*.AppImage*)
      pids="$pids $pid"
      ;;
  esac
done

[ -n "$pids" ] || exit 0

for pid in $pids; do
  kill -TERM "$pid" 2>/dev/null || true
done

# Give Electron time to release the profile lock and close its tray process.
count=0
while [ "$count" -lt 30 ]; do
  alive=""
  for pid in $pids; do
    if kill -0 "$pid" 2>/dev/null; then
      alive="$alive $pid"
    fi
  done
  [ -z "$alive" ] && exit 0
  sleep 0.1
  count=$((count + 1))
done

for pid in $pids; do
  kill -KILL "$pid" 2>/dev/null || true
done

exit 0
