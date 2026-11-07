# Cargo builds

A Claude Code plugin that keeps your Rust builds in sight. It adds a pane beside the chat, **Cargo builds**, with:

- the last four cargo builds and test runs: Building, OK or Failed, a progress bar from cargo's own crate count
  (`470 / 877 crates`), what is compiling now, elapsed time and warnings;
- the first error of a failed run, right under it;
- a toast and a desktop notification the moment a build ends, and a status line while one runs.

## Install

At the prompt of a Claude Code session:

```
/plugin install cargo-builds --marketplace DoctorRyner/cargo-builds-pane
```

Answer `y` to add the marketplace, then pick a scope. From a shell instead:

```
claude plugin marketplace add DoctorRyner/cargo-builds-pane
claude plugin install cargo-builds@cargo-builds-pane
```

Start a new session and the pane opens by itself. `/builds` brings it back to the front.

## What shows up

1. **Cargo that Claude runs.** A `cargo build|test|check|clippy|run|bench` that Claude runs through its Bash or
   PowerShell tool is recorded automatically: running, then OK or FAILED with its first error. No progress bar,
   because the tool hands its output over only at the end. Background runs are left out.
2. **Cargo you or a script run through the tracker**, with live progress. Copy a tracker script into your project
   (or onto your `PATH`) and put it in front of cargo's arguments:

   ```
   sh scripts/track-cargo.sh -l app build --release
   ```

   ```
   pwsh -File scripts/track-cargo.ps1 -Label app build --release
   ```

   Output still goes to your terminal; the exit code is cargo's.

Cargo typed by hand without the tracker does not show.

## Settings

- `CARGO_BUILDS_DIR`: the folder of status files (`<id>.json`) and logs (`<id>.log`). Default `~/.cargo-builds`.
  Set the same value for Claude Code and for the shells that run the tracker. The newest 40 runs are kept.

## How it works

`hooks/register.tsx` lists the folder once a second, reads a running build's log for cargo's
`Building [==> ] 161/466: crate, ...` line (the trackers set `CARGO_TERM_PROGRESS_WHEN=always` so cargo prints it into
a pipe), and reads a finished log once. The pane redraws only when something changed. On the desktop the bars are thin
SVG; the terminal draws text bars. Check a change with `claude plugin validate .` and `claude plugin test .`.

## Licence

MIT
