/**
 * Screenshot harness for review. Captures Home + the key onboarding steps at a
 * phone-ish viewport (420px). Run with the dev server up on PORT (default 5180):
 *   node scripts/screenshots.mjs
 *
 * Dev-only tooling — not shipped. Writes PNGs into ./screenshots.
 */

import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '../screenshots');
const PORT = process.env.PORT || '5180';
const BASE = `http://localhost:${PORT}`;

const VIEWPORT = { width: 420, height: 900 };

async function freezeTime(page) {
  // Pin Date.now so relative timestamps ("14s ago") read identically every run.
  await page.addInitScript(() => {
    const FIXED = new Date('2026-06-01T09:42:14Z').getTime();
    const _now = Date.now;
    // keep performance.now working; just pin wall-clock
    Date.now = () => FIXED;
    const RealDate = Date;
    // eslint-disable-next-line no-global-assign
    Date = class extends RealDate {
      constructor(...args) {
        if (args.length === 0) super(FIXED);
        else super(...args);
      }
      static now() {
        return FIXED;
      }
    };
    Date.UTC = RealDate.UTC;
    Date.parse = RealDate.parse;
    void _now;
  });
}

async function shoot(page, name) {
  await page.waitForTimeout(650); // let entrance animations settle
  const path = resolve(OUT, `${name}.png`);
  await page.screenshot({ path, fullPage: false });
  // also a full-page version for the long Home feed
  console.log(`  ✓ ${name}.png`);
  return path;
}

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce', // deterministic frames
  });

  // ---------- HOME ----------
  {
    const page = await context.newPage();
    await freezeTime(page);
    await page.goto(`${BASE}/?screen=home&static`, { waitUntil: 'networkidle' });
    await shoot(page, '01-home');

    // full-page home (the whole log)
    await page.waitForTimeout(300);
    await page.screenshot({
      path: resolve(OUT, '01-home-full.png'),
      fullPage: true,
    });
    console.log('  ✓ 01-home-full.png');

    // expand the kill-move (blocked) row to show the aborted tx detail
    const blocked = page.getByText('Blocked: a move tried to exceed the mandate.');
    if (await blocked.count()) {
      await blocked.click();
      await shoot(page, '02-home-killmove-expanded');
    }

    // open Add funds sheet
    await page.getByRole('button', { name: '+ Add funds' }).click();
    await shoot(page, '03-add-funds');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);

    // open Pause sheet
    await page.getByRole('button', { name: 'Pause agent' }).click();
    await shoot(page, '04-pause-agent');
    await page.close();
  }

  // ---------- ONBOARDING ----------
  {
    const page = await context.newPage();
    await freezeTime(page);
    await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });

    // Step 1 — Google
    await shoot(page, '05-onboarding-1-google');
    await page.getByRole('button', { name: /Continue with Google/i }).click();

    // Step 2 — name
    await page.getByPlaceholder('yourname').waitFor();
    await shoot(page, '06-onboarding-2-name-empty');
    await page.getByPlaceholder('yourname').fill('daniel'); // taken -> red
    await page.waitForTimeout(700);
    await shoot(page, '07-onboarding-2-name-taken');
    await page.getByPlaceholder('yourname').fill('');
    await page.getByPlaceholder('yourname').type('aurora', { delay: 30 }); // free -> green
    await page.waitForTimeout(700);
    await shoot(page, '08-onboarding-2-name-free');
    await page.getByRole('button', { name: /Claim aurora@suize/i }).click();

    // Step 3 — fund
    await page.getByText('How much play money?').waitFor();
    await shoot(page, '09-onboarding-3-fund-empty');
    // preset chips render as raw "$1000" (no grouping); the CTA uses grouped "$1,000".
    await page.getByRole('button', { name: '$1000', exact: true }).click();
    await page.waitForTimeout(250);
    await shoot(page, '10-onboarding-3-fund-1000');
    await page.getByRole('button', { name: /Fund \$1,000/i }).click();

    // Step 4 — dial (defaults to degen)
    await page.getByText('Pick your dial').waitFor();
    await shoot(page, '11-onboarding-4-dial');
    // select Safe to show the other card state, then pick degen to proceed
    await page.getByRole('button', { name: 'Continue with Degen' }).click();

    // Step 5 — unleash
    await page.getByText('Authorize the mandate').waitFor();
    await shoot(page, '12-onboarding-5-unleash');
    await page.getByRole('button', { name: /Unleash it/i }).click();

    // landed on Home
    await page.getByText('net worth').waitFor();
    await shoot(page, '13-onboarding-done-home');
    await page.close();
  }

  await context.close();
  await browser.close();
  console.log(`\nAll screenshots written to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
