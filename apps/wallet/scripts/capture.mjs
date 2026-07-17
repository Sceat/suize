import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'

const [, , baseUrl, outputDir, executablePath] = process.argv
if (!baseUrl || !outputDir || !executablePath) {
  throw new Error('Usage: capture.mjs <url> <output-dir> <chromium-path>')
}

await mkdir(outputDir, { recursive: true })
const browser = await chromium.launch({ executablePath, headless: true })

for (const viewport of [
  { name: 'desktop-1440x900', width: 1440, height: 900 },
  { name: 'mobile-390x844', width: 390, height: 844 },
]) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.addInitScript(() => localStorage.clear())
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.locator('h1').waitFor()
  await page.screenshot({ path: `${outputDir}/${viewport.name}.png`, animations: 'disabled' })
  console.log(`${viewport.name}: ${await page.title()} (${await page.locator('.wallet-section').count()} sections)`)
  await context.close()
}

await browser.close()
