/** One cargo run (a status file in the builds folder), as the pane shows it. */
export type BuildView = {
  id: string
  label: string
  state: 'running' | 'ok' | 'failed'
  startedMs: number
  endedMs: number | null
  /** Crates built so far and in all, from cargo's progress line; 0 and 0 before the first one. */
  done: number
  total: number
  /** What cargo is compiling now ("serde, syn, ..."), for a running build. */
  current: string | null
  warnings: number
  /** The first `error` line of the log, for a failed run. */
  error: string | null
}

declare module 'claude-code' {
  interface PluginState {
    'cargo-builds': {
      builds: Shaped<BuildView[]>
      /** The time of the last poll while a build runs, so its clock moves even when cargo prints nothing. */
      tick: number
    }
  }
}
