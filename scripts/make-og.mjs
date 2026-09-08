/**
 * Render the OpenGraph preview from the app itself, so the card always shows a
 * real sign rather than a mock up. Run against a served build:
 *
 *   npx vite preview --port 4195 &
 *   node scripts/make-og.mjs http://localhost:4195
 */
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:4195'
const out = process.argv[3] ?? 'public/og.png'
const executablePath =
  process.env.CHROME_PATH ?? `${process.env.HOME}/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`

const browser = await chromium.launch({
  executablePath,
  args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox'],
})
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 })
await page.goto(base, { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

// A representative sign with the measurements off, then the interface hidden so
// only the preview is left.
await page.click('#presets button:text-is("Stop sign")')
await page.waitForTimeout(2000)
await page.click('#viewDims')
await page.waitForTimeout(400)
await page.click('#viewFit')
await page.waitForTimeout(500)
await page.click('#collapse')
await page.waitForTimeout(900)

// Pull the camera in so the sign carries the frame.
const canvas = await page.$('#viewport canvas')
const box = await canvas.boundingBox()
for (let i = 0; i < 7; i++) {
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.wheel(0, -110)
  await page.waitForTimeout(90)
}

await page.addStyleTag({
  content: `
    .view-controls, .overlay, .expand, .busy { display: none !important; }
    .og-mark {
      position: fixed;
      left: 56px;
      bottom: 48px;
      font: 600 40px/1.1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      color: #e6e9ef;
      letter-spacing: -0.01em;
      z-index: 20;
    }
    .og-mark small {
      display: block;
      margin-top: 8px;
      font: 400 17px/1.4 system-ui, sans-serif;
      color: #98a1b0;
      letter-spacing: 0;
    }
  `,
})
await page.evaluate(() => {
  const mark = document.createElement('div')
  mark.className = 'og-mark'
  mark.innerHTML = 'Emboss<small>Multicolour 3MF signs, straight from the browser</small>'
  document.body.append(mark)
})
await page.waitForTimeout(500)

mkdirSync(out.replace(/\/[^/]+$/, ''), { recursive: true })
await page.screenshot({ path: out })
console.log(`wrote ${out}`)
await browser.close()
