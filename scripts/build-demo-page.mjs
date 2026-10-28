// Turns the demo build into one page file (styles and code inside it), ready
// to share as a link. Run after `npm run build:demo`:
//   node scripts/build-demo-page.mjs <output file>
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const out = process.argv[2]
if (!out) throw new Error('Give the output file, like: node scripts/build-demo-page.mjs demo-page.html')
const dist = join(dirname(new URL(import.meta.url).pathname), '../dist-demo')
const html = readFileSync(join(dist, 'demo.html'), 'utf8')
const js = html.match(/<script type="module" crossorigin src="\.\/([^"]+)"/)?.[1]
const css = html.match(/<link rel="stylesheet" crossorigin href="\.\/([^"]+)"/)?.[1]
if (!js || !css) throw new Error('Could not find the built script and styles. Run npm run build:demo first.')
// The logo is a file in the real app. Here it goes inside the page.
const logo = `data:image/svg+xml;base64,${readFileSync(join(dist, '../public/favicon.svg')).toString('base64')}`
const code = readFileSync(join(dist, js), 'utf8')
  .replace(/(["'`])\/favicon\.svg\1/g, JSON.stringify(logo))
  .replaceAll('</script', '<\\/script')
const styles = readFileSync(join(dist, css), 'utf8').replaceAll('</style', '<\\/style')
const page = `<title>TruckStock Demo</title>
<meta name="description" content="A clickable demo of TruckStock with made up sample data.">
<style>${styles}
html, body { background: #f8fafc; color: #0f172a; color-scheme: light; }</style>
<div id="root"></div>
<script type="module">${code}</script>
`
writeFileSync(out, page)
console.log(`Wrote ${out} (${Math.round(page.length / 1024)} KB)`)
