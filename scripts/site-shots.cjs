// Takes the pictures of the app for the website (site/public/shots) from the
// demo, so they always show the real app with its sample data.
//   npm run build:demo && node scripts/site-shots.cjs
// Needs Playwright with Chromium. Run it again after big screen changes and
// look at the pictures before committing them.
const { chromium } = require('playwright')
const http = require('node:http')
const fs = require('node:fs')
const path = require('node:path')

const demo = path.join(__dirname, '../dist-demo')
const out = path.join(__dirname, '../site/public/shots')
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

// A tiny file server for the demo build (its code is a module, which browsers won't load from a file).
function serve() {
  const server = http.createServer((req, res) => {
    const file = path.join(demo, decodeURIComponent(new URL(req.url, 'http://x').pathname))
    if (!file.startsWith(demo) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end()
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file))
  })
  return new Promise((resolve) => server.listen(0, () => resolve(server)))
}

// Chromium shrinks the picture to WebP itself, so nothing else is needed.
async function saveWebp(page, png, name, quality = 0.8) {
  const data = await page.evaluate(
    async ({ src, quality }) => {
      const img = new Image()
      img.src = src
      await img.decode()
      const canvas = Object.assign(document.createElement('canvas'), { width: img.width, height: img.height })
      canvas.getContext('2d').drawImage(img, 0, 0)
      return canvas.toDataURL('image/webp', quality)
    },
    { src: `data:image/png;base64,${png.toString('base64')}`, quality },
  )
  const file = path.join(out, `${name}.webp`)
  fs.writeFileSync(file, Buffer.from(data.split(',')[1], 'base64'))
  console.log(`${name}.webp ${Math.round(fs.statSync(file).size / 1024)} KB`)
}

async function open(browser, base, viewport, scale) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: scale })
  await page.goto(`${base}/demo.html`)
  await page.getByText('Hi, Sam').waitFor()
  await page.getByText('Live', { exact: true }).filter({ visible: true }).first().waitFor()
  return page
}

// Hides the demo banner, then waits for the pictures to load.
async function tidy(page, scrollY = 0) {
  await page.addStyleTag({ content: '[data-demo-bar]{display:none!important}' })
  await page.evaluate((y) => window.scrollTo(0, y), scrollY)
  // Pictures further down load later on purpose, so only wait for the ones on screen.
  // Hidden ones (like the desktop table on a phone) never load either.
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete || !i.getClientRects().length || i.getBoundingClientRect().top > innerHeight),
  )
  await page.waitForTimeout(300)
}

;(async () => {
  fs.mkdirSync(out, { recursive: true })
  const server = await serve()
  const base = `http://localhost:${server.address().port}`
  const browser = await chromium.launch()
  try {
    // A driver's starting count, with pictures.
    let page = await open(browser, base, { width: 390, height: 844 }, 2)
    await page.getByRole('radio', { name: 'Jake (driver)' }).click()
    await page.getByText('Hi, Jake').waitFor()
    await page.getByRole('button', { name: 'Continue shift' }).click()
    await page.getByLabel('Ice amount', { exact: true }).waitFor()
    await tidy(page, 405)
    await saveWebp(page, await page.screenshot(), 'phone-count')
    await page.close()

    // The warehouse on a computer.
    page = await open(browser, base, { width: 1280, height: 800 }, 1.5)
    await page.getByRole('link', { name: 'Inventory' }).filter({ visible: true }).first().click()
    await page.getByText('Value on hand').waitFor()
    await tidy(page)
    await saveWebp(page, await page.screenshot(), 'desktop-inventory')

    // Reports.
    await page.getByRole('link', { name: 'Reports' }).filter({ visible: true }).first().click()
    await page.getByText('Sales minus costs').first().waitFor()
    await tidy(page)
    await saveWebp(page, await page.screenshot(), 'desktop-reports')

    // The picture shown when someone shares the link.
    await page.setViewportSize({ width: 1200, height: 630 })
    await page.getByRole('link', { name: 'Inventory' }).filter({ visible: true }).first().click()
    await page.getByText('Value on hand').waitFor()
    await tidy(page)
    const share = await page.screenshot({ type: 'jpeg', quality: 80, scale: 'css' })
    fs.writeFileSync(path.join(out, 'share.jpg'), share)
    console.log(`share.jpg ${Math.round(share.length / 1024)} KB`)
  } finally {
    await browser.close()
    server.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
