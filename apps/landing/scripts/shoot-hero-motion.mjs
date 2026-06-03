/**
 * shoot-hero-motion.mjs — capture the hero WITH the OGL shader animating
 * (no reduced-motion), so the deliverable shows the reused ink-flow aesthetic.
 * The shader is gated on prefers-reduced-motion, so we must NOT set it here,
 * and we wait a couple seconds for the fluid to evolve away from its dark t=0.
 */
import { chromium } from '~/dev/sui/suize/node_modules/.bun/playwright@1.60.0/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4173'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

async function run (label, width, height) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    // NOTE: deliberately leave reducedMotion unset so the shader RAF runs.
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  // Let the domain-warped FBM evolve out of its near-black t=0 frame.
  await page.waitForTimeout(2600)
  await page.screenshot({ path: join(OUT, `${label}-hero-motion.png`) })
  await browser.close()
  console.log(`done: ${label}-hero-motion (${width}x${height})`)
}

await run('desktop', 1280, 900)
await run('mobile', 420, 850)
console.log('ALL DONE')
