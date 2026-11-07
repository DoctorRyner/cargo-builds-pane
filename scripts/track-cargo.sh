#!/bin/sh
# Runs cargo exactly as given and keeps a status file and a log of it, so the Cargo builds pane shows the run live:
# what it builds, progress, time, OK or FAILED, and a notification when it ends. The output still goes to this terminal.
#
#   track-cargo.sh -l app build --release
#   track-cargo.sh test -p my-crate          # label defaults to "cargo"
#
# Folder: $CARGO_BUILDS_DIR, else ~/.cargo-builds. Same files as track-cargo.ps1. Exit code: cargo's.
label=cargo
if [ "$1" = "-l" ]; then label=$2; shift 2; fi

dir=${CARGO_BUILDS_DIR:-$HOME/.cargo-builds}
mkdir -p "$dir" || exit 1
id="$(date +%Y%m%d-%H%M%S)-$$"
log="$dir/$id.log"
json="$dir/$id.json"
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
cwd=$(pwd)
args="$*"
# Git Bash or Cygwin on Windows: the pane reads Windows paths (C:/...), not /c/...
logpath=$log
if command -v cygpath >/dev/null 2>&1; then logpath=$(cygpath -m "$log"); cwd=$(cygpath -m "$cwd"); fi

# JSON string escape: backslash, quote and control characters.
esc() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr '\t\r\n' '   '; }

status() { # state exitCode(or null)
  ended=null
  [ "$1" != running ] && ended="\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\""
  printf '{"id":"%s","label":"%s","state":"%s","started":"%s","ended":%s,"exitCode":%s,"log":"%s","cwd":"%s","args":"%s"}\n' \
    "$id" "$(esc "$label")" "$1" "$started" "$ended" "$2" "$(esc "$logpath")" "$(esc "$cwd")" "$(esc "$args")" > "$json.tmp"
  mv -f "$json.tmp" "$json" # whole, so the pane never reads half a file
}

# Old runs: keep the newest 40.
ls "$dir"/*.json 2>/dev/null | sort -r | tail -n +41 | while read -r f; do rm -f "$f" "${f%.json}.log"; done

status running null
code=1
trap 'status failed 130; exit 130' INT TERM
# Progress lines ("Building [=>  ] 161/466") also when the output is not a console, so the pane can read them.
export CARGO_TERM_PROGRESS_WHEN=always CARGO_TERM_PROGRESS_WIDTH=110
# cargo's exit code through the pipe (POSIX sh has no pipefail): written to a file beside the status.
{ cargo "$@" 2>&1; echo $? > "$json.code"; } | tee "$log"
code=$(cat "$json.code" 2>/dev/null); rm -f "$json.code"
trap - INT TERM
if [ "$code" = 0 ]; then status ok 0; else status failed "${code:-1}"; fi
exit "${code:-1}"
