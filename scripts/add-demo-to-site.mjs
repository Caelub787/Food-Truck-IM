// Puts the demo build (dist-demo) on the website at /demo. Part of npm run build:site.
import { cpSync, renameSync, rmSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const to = new URL('dist-site/demo/', root)
rmSync(to, { recursive: true, force: true })
cpSync(new URL('dist-demo/', root), to, { recursive: true })
renameSync(new URL('demo.html', to), new URL('index.html', to))
console.log('Added the demo to dist-site/demo')
