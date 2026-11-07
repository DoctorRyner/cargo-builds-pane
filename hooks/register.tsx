// Cargo builds: a pane beside the chat with every cargo build and test run, live.
//
// Every second it reads <dir>/*.json (one status file per run) and, for a running build, its log (cargo's
// "Building [==> ] 161/466: naga, ..." line). A build that ends raises a toast and a desktop notification and sets
// the status line. Runs are written by scripts/track-cargo.ps1 or scripts/track-cargo.sh, and by this plugin itself
// for cargo commands Claude runs through its Bash or PowerShell tool.
//
// <dir> is $CARGO_BUILDS_DIR, else ~/.cargo-builds (the tracker scripts use the same rule).
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { BuildView } from '../types'

const PANE = 'cargo-builds'
const TITLE = 'Cargo builds'
const SHOWN = 4

const builds = atom({ plugin: 'cargo-builds', key: 'builds' } as const, [] as BuildView[], { shape: 'builds-1' })
const tick = atom({ plugin: 'cargo-builds', key: 'tick' } as const, 0)

/** Colours of a state, as hex for the SVG and as theme keys for text. */
const LOOK = {
  running: { hex: '#E3B341', theme: 'warning', word: 'Building' },
  ok: { hex: '#3FB950', theme: 'success', word: 'OK' },
  failed: { hex: '#F85149', theme: 'error', word: 'Failed' },
} as const

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const PROGRESS = /Building \[[^\]]*\]\s*(\d+)\/(\d+)(?::\s*([^\r\n]*))?/g

/** The folder of status files: $CARGO_BUILDS_DIR, else ~/.cargo-builds, with forward slashes. */
export function buildsDir(fromEnv: string | undefined, home: string | undefined): string {
  const dir = fromEnv?.trim() || `${home ?? '.'}/.cargo-builds`
  return dir.replace(/\\/g, '/').replace(/\/+$/, '')
}

/** Reads cargo's last progress line, what it compiles now, the warning count and the first error. */
export function readLog(text: string): Pick<BuildView, 'done' | 'total' | 'current' | 'warnings' | 'error'> {
  const plain = text.replace(ANSI, '')
  let done = 0
  let total = 0
  let current: string | null = null
  for (const m of plain.matchAll(PROGRESS)) {
    done = Number(m[1])
    total = Number(m[2])
    current = m[3]?.replace(/[…�]+$/, '').trim() || null
  }
  const warnings = (plain.match(/^warning: /gm) ?? []).length
  const error = plain.match(/^error(\[E\d+\])?: .*$/m)?.[0]?.slice(0, 200) ?? null
  return { done, total, current, warnings, error }
}

/**
 * A cargo build or test typed straight into a shell (not through a track-cargo script): its label, such as
 * "test · my-crate" or "build · workspace", or null for anything else.
 */
export function cargoLabel(command: string): string | null {
  if (/track-cargo/i.test(command)) return null
  const m = command.match(/\bcargo(?:\.exe)?\s+(build|test|check|clippy|run|bench)\b([^;&|\n]*)/i)
  if (!m) return null
  const crates = [...(m[2] ?? '').matchAll(/(?:^|\s)-p\s+([\w-]+)/g)].map(x => x[1])
  const folder = command.match(/\bcd\s+["']?([^"';&|\n]+?)["']?\s*(?:;|&&|\n)/i)?.[1]
  const where = crates.length > 0 ? crates.join(', ') : folder ? (folder.split(/[\\/]/).filter(Boolean).slice(-2).join('/') || 'workspace') : 'workspace'
  return `${(m[1] ?? 'cargo').toLowerCase()} · ${where}`
}

/** A build id that sorts with the tracker scripts' (`yyyyMMdd-HHmmss-<n>`), in local time. */
export function buildId(nowMs: number, n: number): string {
  const d = new Date(nowMs)
  const p = (v: number) => String(v).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}-c${n}`
}

/** A text bar of `width` cells, for the terminal. */
export function textBar(fraction: number, width: number): string {
  const full = Math.max(0, Math.min(width, Math.round(fraction * width)))
  return '━'.repeat(full) + '─'.repeat(width - full)
}

/** A thin rounded bar as SVG: a soft track, the filled part in `hex`. */
export function svgBar(fraction: number, width: number, height: number, hex: string): string {
  const f = Math.max(0, Math.min(1, fraction))
  const fill = f <= 0 ? 0 : Math.max(height, Math.round(f * width))
  const r = height / 2
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<defs><linearGradient id="g" x1="0" x2="1"><stop offset="0" stop-color="${hex}" stop-opacity="0.75"/>` +
    `<stop offset="1" stop-color="${hex}"/></linearGradient></defs>` +
    `<rect width="${width}" height="${height}" rx="${r}" fill="#8b949e" fill-opacity="0.22"/>` +
    (fill > 0 ? `<rect width="${fill}" height="${height}" rx="${r}" fill="url(#g)"/>` : '') +
    `</svg>`
  )
}

/** 83 seconds as "1:23". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** How long ago, in words: "just now", "4 min ago", "2 h ago". */
export function ago(ms: number): string {
  const m = Math.floor(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  return `${Math.floor(m / 60)} h ago`
}

/** The builds folder of this process's environment. */
async function dirOf($: EngineInterface): Promise<string> {
  return buildsDir(await $.env.get('CARGO_BUILDS_DIR'), (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')))
}

/**
 * Cargo run straight from a shell tool: record it like the tracker scripts do, so it shows in the pane. A background
 * run returns at once with no result, so it is left out. Its result is returned unchanged.
 */
async function recordCargo($: EngineInterface, command: string, isBackground: boolean, run: () => Promise<any>) {
  const label = isBackground ? null : cargoLabel(command)
  if (!label) return run()
  const dir = await dirOf($)
  const startedMs = await $.clock.now()
  const id = buildId(startedMs, Math.floor(startedMs % 100000))
  const json = `${dir}/${id}.json`
  const log = `${dir}/${id}.log`
  const status = (state: string, endedMs: number | null) =>
    JSON.stringify({ id, label, state, started: new Date(startedMs).toISOString(), ended: endedMs ? new Date(endedMs).toISOString() : null, log, args: command.slice(0, 300) })
  await $.fs.write(json, status('running', null)).catch(() => {})
  const result = await run()
  const text = String(result?.text ?? '')
  const failed = Boolean(result?.isError) || /^error(\[E\d+\])?:|test result: FAILED|^error: could not compile/m.test(text)
  await $.fs.write(log, text).catch(() => {})
  await $.fs.write(json, status(failed ? 'failed' : 'ok', await $.clock.now())).catch(() => {})
  return result
}

export const register: Register = on => {
  // What each build was at the last poll, to notice the moment one ends (a reload starts it empty
  // and so never announces builds that ended before).
  const seen = new Map<string, BuildView['state']>()
  // Finished logs are read once.
  const finished = new Map<string, ReturnType<typeof readLog>>()

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'builds', description: 'Show the Cargo builds pane' })
    void $.ui.open({ id: PANE, title: TITLE })
    const dir = await dirOf($)

    const poll = async () => {
      const now = await $.clock.now()
      const entries = await $.fs.list(dir).catch(() => [])
      const names = entries
        .filter(x => x.name.endsWith('.json'))
        .map(x => x.name)
        .sort()
        .reverse()
        .slice(0, SHOWN)
      const list: BuildView[] = []
      for (const name of names) {
        let raw: any
        try {
          raw = JSON.parse((await $.fs.read(`${dir}/${name}`)).replace(/^﻿/, ''))
        } catch {
          continue // being written; next second
        }
        const id = String(raw.id)
        const state: BuildView['state'] = raw.state === 'ok' || raw.state === 'failed' ? raw.state : 'running'
        let info = finished.get(id)
        if (!info) {
          const logText = await $.fs.read(String(raw.log).replace(/\\/g, '/')).catch(() => '')
          info = readLog(logText)
          if (state !== 'running') finished.set(id, info)
        }
        const view: BuildView = {
          id,
          label: String(raw.label ?? 'cargo'),
          state,
          startedMs: Date.parse(raw.started),
          endedMs: raw.ended ? Date.parse(raw.ended) : null,
          ...info,
        }
        list.push(view)
        const before = seen.get(id)
        if (before === 'running' && state !== 'running') {
          const took = clock((view.endedMs ?? now) - view.startedMs)
          const text =
            state === 'ok'
              ? `Build OK: ${view.label} (${took})`
              : `Build FAILED: ${view.label} (${took})${info.error ? ` - ${info.error}` : ''}`
          $.ui.toast(text)
          void $.ui.notify(text, { title: TITLE })
        }
        seen.set(id, state)
      }
      const running = list.find(b => b.state === 'running')
      if (running) {
        const pct = running.total > 0 ? ` ${Math.round((100 * running.done) / running.total)}%` : ''
        $.ui.status(`Building ${running.label}${pct} · ${clock(now - running.startedMs)}`)
        await update($, tick, () => now)
      } else if (list[0]) {
        const last = list[0]
        $.ui.status(`Last build ${last.state === 'ok' ? 'OK' : 'FAILED'}: ${last.label}`)
      }
      await update($, builds, old => (JSON.stringify(old) === JSON.stringify(list) ? old : list))
    }
    await poll()
    $.clock.every(1000, () => void poll())

    return next(e)
  })

  on('tool.call', { tool: 'Bash' }, ($, e, next) => recordCargo($, String(e.command ?? ''), Boolean(e.run_in_background), () => next(e)))
  on('tool.call', { tool: 'PowerShell' }, ($, e, next) =>
    recordCargo($, String((e as any).command ?? ''), Boolean((e as any).run_in_background), () => next(e)),
  )

  on('command.run', { command: 'builds' }, async $ => {
    // An open on a pane that is already open only renames it: one hidden behind another tab or
    // never placed would stay out of sight, so close it first and open it fresh, in front.
    const mine = (await $.ui.panes()).find(p => p.id === PANE)
    if (mine && (!mine.isShown || !mine.isPlaced)) await $.ui.close({ id: PANE })
    const opened = await $.ui.open({ id: PANE, title: TITLE })
    return { text: opened.isPlaced ? 'Cargo builds pane opened.' : `The builds pane could not open: ${opened.reason}.` }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e) as any
    const { Box, Text } = els
    const Svg = e.surface === 'terminal' ? null : els.Svg
    const list = await read($, builds)
    const polled = await read($, tick)
    const now = Math.max(polled, await $.clock.now())
    const columns = Math.max(24, e.props.bodyColumns ?? e.viewport?.columns ?? 40)
    // About 8 CSS pixels a column on the desktop.
    const barPx = Math.max(120, Math.min(560, columns * 8 - 8))
    const cells = Math.max(10, Math.min(48, columns - 2))
    const dir = await dirOf($)

    const runningCount = list.filter(b => b.state === 'running').length
    const summary = runningCount > 0 ? `${runningCount} running` : list[0] ? `last ${ago(now - (list[0].endedMs ?? now))}` : ''

    return (
      <Box flexDirection="column" gap="md" paddingX={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="flex-end">
          <Text size="heading" weight="semibold">Builds</Text>
          <Text size="caption" dimColor>{summary}</Text>
        </Box>

        {list.length === 0 && (
          <Text size="footnote" dimColor>
            No builds yet. Cargo commands Claude runs show here, and runs through scripts/track-cargo (watching {dir}).
          </Text>
        )}

        {list.map(b => {
          const look = LOOK[b.state]
          const isRunning = b.state === 'running'
          const fraction = b.total > 0 ? b.done / b.total : isRunning ? 0 : 1
          const elapsed = clock((b.endedMs ?? now) - b.startedMs)
          const pct = b.total > 0 ? `${Math.round(fraction * 100)}%` : ''
          const detail = isRunning
            ? [b.total > 0 ? `${b.done} / ${b.total} crates` : 'starting', b.current].filter(Boolean).join(' · ')
            : [
                b.state === 'ok' ? `Finished ${ago(now - (b.endedMs ?? now))}` : `Failed ${ago(now - (b.endedMs ?? now))}`,
                b.warnings > 0 ? `${b.warnings} warnings` : null,
              ]
                .filter(Boolean)
                .join(' · ')
          return (
            <Box key={b.id} flexDirection="column" gap="xs">
              <Box flexDirection="row" justifyContent="space-between">
                <Text wrap="truncate-end">
                  <Text color={look.theme} weight="semibold">● {look.word}</Text>
                  <Text weight="medium">  {b.label}</Text>
                </Text>
                <Text mono tabular dimColor>
                  {isRunning && pct ? `${pct}  ` : ''}
                  {elapsed}
                </Text>
              </Box>
              {(isRunning || b.state === 'failed') &&
                (Svg ? (
                  <Svg source={svgBar(fraction, barPx, 6, look.hex)} alt={`${look.word} ${pct}`} width={barPx} height={6} />
                ) : (
                  <Text color={look.theme}>{textBar(fraction, cells)}</Text>
                ))}
              <Text size="caption" dimColor wrap="truncate-end">
                {detail}
              </Text>
              {b.state === 'failed' && b.error && (
                <Text size="caption" color="error" wrap="wrap">
                  {b.error}
                </Text>
              )}
            </Box>
          )
        })}
      </Box>
    )
  })
}
