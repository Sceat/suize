/**
 * shoot.mjs — Playwright screenshots of the rebuilt landing.
 * Assumes a server is already running at BASE (vite preview on the built dist).
 * Captures desktop (1280) + mobile (420): navbar with Apps dropdown OPEN,
 * the hero, the wallet section, and the crash section.
 */
import { chromium } from '~/dev/sui/suize/node_modules/.bun/playwright@1.60.0/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE || 'http://localhost:4173'
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'screenshots')

async function settle (page, ms = 700) {
  await page.waitForLoadState('networkidle').catch(() => {})
  await page.waitForTimeout(ms)
}

async function run (label, width, height) {
  const browser = await chromium.launch()
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    reducedMotion: 'reduce', // freeze animations so frames are deterministic
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await settle(page, 900)

  // 1) Hero (top of page) — full viewport
  await page.screenshot({ path: join(OUT, `${label}-1-hero.png`) })

  // 2) Navbar with the Apps dropdown OPEN
  const appsBtn = page.getByRole('button', { name: 'Apps' })
  await appsBtn.click()
  await page.waitForTimeout(350)
  await page.screenshot({ path: join(OUT, `${label}-2-navbar-apps-open.png`) })
  // close it again before scrolling
  await page.keyboard.press('Escape')
  await page.waitForTimeout(200)

  // 3) Wallet section
  await page.locator('#wallet').scrollIntoViewIfNeeded()
  await settle(page, 600)
  await page.screenshot({ path: join(OUT, `${label}-3-wallet.png`) })

  // 4) Crash section
  await page.locator('#crash').scrollIntoViewIfNeeded()
  await settle(page, 600)
  await page.screenshot({ path: join(OUT, `${label}-4-crash.png`) })

  // 5) Full-page tall capture (everything, for review)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, `${label}-5-fullpage.png`), fullPage: true })

  await browser.close()
  console.log(`done: ${label} (${width}x${height})`)
}

await run('desktop', 1280, 900)
await run('mobile', 420, 850)
console.log('ALL DONE')
