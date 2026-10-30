import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
const lockfile = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))

describe('package publication', () => {
  it('builds the runtime entry before installing from git', () => {
    expect(manifest.scripts.prepare).toBe('npm run build')
  })

  it('supports the dsh 0.2 tools line', () => {
    expect(manifest.peerDependencies['@deepseek-ai/dsh-tools']).toContain('>=0.2.0-rc.1 <0.3.0')
  })

  it('keeps the lockfile root version synchronized', () => {
    expect(lockfile.packages[''].version).toBe(manifest.version)
  })
})
