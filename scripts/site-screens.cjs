// Checks the public website (dist-site) at phone and desktop sizes: saves
// screenshots, makes sure nothing scrolls sideways, every picture loads, the
// sign up and log in buttons go to the app, and the demo opens.
//   npm run build:site && node scripts/site-screens.cjs
// Screenshots land in test-results/site. Exits with an error if a check fails.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const site = path.join(__dirname, '../dist-site')
const out = path.join(__dirname, '../test-results/site')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' }
const app = 'https://app.foodtruckim.com'

function serve() {
  const server = http.createServer((req, res) => {
    let file = path.join(site, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (file.startsWith(site) && fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html')
    if (!file.startsWith(site) || !fs.existsSync(file)) return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file))
  })
  return new Promise((resolve) => server.listen(0, () => resolve(server)))
}

;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const server = await serve()
  const base = `http://localhost:${server.address().port}`
  const browser = await chromium.launch()
  let failed = false
  try {
    for (const [label, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1366, height: 860 }]]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 2 })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      page.on('response', (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`))
      const checks = []
      const check = (ok, name) => (ok ? checks.push(name) : errors.push(`failed: ${name}`))

      await page.goto(base)
      await page.getByRole('heading', { level: 1 }).waitFor()
      // Load the pictures further down now instead of on scroll.
      await page.evaluate(() => document.querySelectorAll('img[loading=lazy]').forEach((i) => (i.loading = 'eager')))
      await page.waitForFunction(() => [...document.images].every((i) => i.complete))
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'nothing scrolls sideways')
      // SVG logos have no size of their own, so only the photos are measured.
      check(await page.evaluate(() => [...document.images].every((i) => i.naturalWidth > 0 || i.src.endsWith('.svg'))), 'every picture loads')
      const links = await page.$$eval('a', (as) => as.map((a) => ({ text: a.textContent.trim(), href: a.href })))
      const signups = links.filter((l) => /^sign up/i.test(l.text))
      check(signups.length >= 3 && signups.every((l) => l.href === `${app}/signup`), 'sign up buttons go to the app')
      check(links.filter((l) => l.text === 'Log in').every((l) => l.href === `${app}/login`), 'log in links go to the app')
      if (label === 'phone') {
        const small = await page.$$eval('a.btn, header a', (as) =>
          as.filter((a) => a.getClientRects().length && a.getBoundingClientRect().height < 48).map((a) => a.textContent.trim()),
        )
        check(small.length === 0, `buttons are big enough to tap ${small.join(', ')}`)
      }
      await page.screenshot({ path: path.join(out, `${label}-home.png`), fullPage: true })

      await page.getByRole('link', { name: 'Try the demo' }).click()
      await page.getByText('Hi, Sam').waitFor({ timeout: 15000 })
      check(await page.getByRole('link', { name: 'Sign up your business' }).getAttribute('href') === `${app}/signup`, 'the demo opens, with a sign up link')
      await page.screenshot({ path: path.join(out, `${label}-demo.png`) })

      console.log(`${label}: ${checks.length} checks passed: ${checks.join('; ')}`)
      if (errors.length) {
        failed = true
        console.error(`${label} problems:\n  ${errors.join('\n  ')}`)
      }
      await page.close()
    }
  } finally {
    await browser.close()
    server.close()
  }
  if (failed) process.exit(1)
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
