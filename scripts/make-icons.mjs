// Draws the app icons (a simple truck) as PNG files with no outside tools.
// Run with: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'

const TEAL = [15, 118, 110]
const WHITE = [255, 255, 255]

// Shapes are drawn in a 100 x 100 space.
const truck = [
  { kind: 'rect', x0: 12, y0: 28, x1: 60, y1: 64, color: WHITE },
  { kind: 'rect', x0: 20, y0: 35, x1: 52, y1: 48, color: TEAL },
  { kind: 'rect', x0: 60, y0: 40, x1: 86, y1: 64, color: WHITE },
  { kind: 'rect', x0: 65, y0: 45, x1: 80, y1: 53, color: TEAL },
  { kind: 'circle', cx: 30, cy: 67, r: 9, color: WHITE },
  { kind: 'circle', cx: 30, cy: 67, r: 3.5, color: TEAL },
  { kind: 'circle', cx: 72, cy: 67, r: 9, color: WHITE },
  { kind: 'circle', cx: 72, cy: 67, r: 3.5, color: TEAL },
]

function inside(shape, x, y) {
  if (shape.kind === 'rect') return x >= shape.x0 && x < shape.x1 && y >= shape.y0 && y < shape.y1
  return (x - shape.cx) ** 2 + (y - shape.cy) ** 2 <= shape.r ** 2
}

function inRoundedSquare(x, y, radius) {
  const cx = Math.min(Math.max(x, radius), 100 - radius)
  const cy = Math.min(Math.max(y, radius), 100 - radius)
  return (x - cx) ** 2 + (y - cy) ** 2 <= radius ** 2
}

function draw(size, { maskable = false, rounded = true } = {}) {
  const samples = 4
  const scale = maskable ? 0.72 : 1
  const pixels = Buffer.alloc(size * size * 4)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const x = ((px + (sx + 0.5) / samples) / size) * 100
          const y = ((py + (sy + 0.5) / samples) / size) * 100
          const inBackground = maskable || !rounded || inRoundedSquare(x, y, 22)
          if (!inBackground) continue
          // Map into the truck's space, shrunk toward the center for maskable icons.
          const tx = 50 + (x - 50) / scale
          const ty = 50 + (y - 50) / scale
          let color = TEAL
          for (const shape of truck) if (inside(shape, tx, ty)) color = shape.color
          r += color[0]
          g += color[1]
          b += color[2]
          a += 255
        }
      }
      const n = samples * samples
      const i = (py * size + px) * 4
      const coverage = a / 255
      pixels[i] = coverage ? Math.round(r / coverage) : 0
      pixels[i + 1] = coverage ? Math.round(g / coverage) : 0
      pixels[i + 2] = coverage ? Math.round(b / coverage) : 0
      pixels[i + 3] = Math.round(a / n)
    }
  }
  return encodePng(size, pixels)
}

function crc32(buf) {
  let c = ~0
  for (const byte of buf) {
    c ^= byte
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1
  }
  return ~c >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(size, rgba) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  const rows = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    rows[y * (size * 4 + 1)] = 0
    rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const out = new URL('../public/', import.meta.url)
writeFileSync(new URL('pwa-192.png', out), draw(192))
writeFileSync(new URL('pwa-512.png', out), draw(512))
writeFileSync(new URL('pwa-maskable-512.png', out), draw(512, { maskable: true }))
writeFileSync(new URL('apple-touch-icon.png', out), draw(180, { rounded: false }))

const svgShapes = truck
  .map((s) =>
    s.kind === 'rect'
      ? `<rect x="${s.x0}" y="${s.y0}" width="${s.x1 - s.x0}" height="${s.y1 - s.y0}" fill="rgb(${s.color})"/>`
      : `<circle cx="${s.cx}" cy="${s.cy}" r="${s.r}" fill="rgb(${s.color})"/>`,
  )
  .join('')
writeFileSync(
  new URL('favicon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="22" fill="rgb(${TEAL})"/>${svgShapes}</svg>\n`,
)
console.log('Icons written to public/')
