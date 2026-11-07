import { expect, test } from 'claude-code/testing'

import { buildsDir, cargoLabel, readLog } from './register'

test('reads progress, warnings and the first error from a log', async () => {
  const log = 'warning: unused\n   Building [=====>   ] 12/40: serde, syn\nerror[E0308]: mismatched types\nerror: later\n'
  expect(readLog(log)).toEqual({ done: 12, total: 40, current: 'serde, syn', warnings: 1, error: 'error[E0308]: mismatched types' })
})

test('labels cargo commands and skips the tracker and other commands', async () => {
  expect(cargoLabel('cargo test -p my-crate --release')).toBe('test · my-crate')
  expect(cargoLabel('cd /x/app && cargo build')).toBe('build · x/app')
  expect(cargoLabel('sh track-cargo.sh build')).toBe(null)
  expect(cargoLabel('cargo fmt')).toBe(null)
})

// Status files as the trackers wrote them in a real run (ps1 with its BOM and backslashes, sh minified).
const FILES: Record<string, string> = {
  'D:/b/20261107-144023-29432.json':
    '\uFEFF{"id":"20261107-144023-29432","label":"hello ps1","state":"ok","started":"2026-11-07T13:40:23.2201263Z","ended":"2026-11-07T13:40:26.3673887Z","exitCode":0,"log":"D:\\\\b\\\\20261107-144023-29432.log"}',
  'D:/b/20261107-144023-29432.log': '   Compiling hello v0.1.0\n    Building [   ] 0/1: hello(bin)\n    Finished `dev` profile\n',
  'D:/b/20261107-144026-708.json':
    '{"id":"20261107-144026-708","label":"hello sh","state":"failed","started":"2026-11-07T13:40:26Z","ended":"2026-11-07T13:40:27Z","exitCode":1,"log":"D:/b/20261107-144026-708.log"}',
  'D:/b/20261107-144026-708.log': "error: unexpected argument '--bogus' found\n",
}

test('the pane lists real tracker runs, on every surface', async ($, on) => {
  on('command.register', () => ({ value: { command: 'builds' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: Date.parse('2026-11-07T13:41:00Z') }))
  on('clock.every', () => ({ value: {} }))
  on('ui.status', () => ({ value: {} }))
  on('env.get',(_, e: any) => ({ value: e.name === 'CARGO_BUILDS_DIR' ? 'D:\\b' : undefined }))
  on('fs.list', () => ({ value: Object.keys(FILES).map(p => ({ name: p.split('/').pop() })) }))
  // The engine hands the path over in the platform's form (D:\b\... on Windows).
  on('fs.read', (_, e: any) => {
    const p = e.path.replace(/\\/g, '/')
    return p in FILES ? { value: FILES[p] } : { deny: 'missing' }
  })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'cargo-builds',
      component: 'Pane',
      requestId: 'cargo-builds',
      surface,
      props: { title: 'Cargo builds', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 20 }, view: {} },
    })
    expect((await ui.find({ type: 'Text', text: /hello ps1/ }))?.text).toContain('OK')
    expect((await ui.find({ type: 'Text', text: /--bogus/ }))?.text).toBe("error: unexpected argument '--bogus' found")
    await ui.unmount()
  }
})

test('the builds folder: env first, else ~/.cargo-builds', async () => {
  expect(buildsDir('D:\\b\\', 'C:\\Users\\a')).toBe('D:/b')
  expect(buildsDir(undefined, 'C:\\Users\\a')).toBe('C:/Users/a/.cargo-builds')
  expect(buildsDir('  ', '/home/a')).toBe('/home/a/.cargo-builds')
})
