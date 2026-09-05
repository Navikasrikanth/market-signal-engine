import { test, expect } from '@playwright/test'

/**
 * Reduced motion is a promise, so it gets a test.
 *
 * The UI work added a canvas that animates, entrance animations on cards, a
 * spinning border on CRITICAL and a cursor-driven tilt. Every one of those is
 * meant to disappear for a viewer who has asked their system for less motion,
 * and every one of them is honoured in a different place — a global CSS rule
 * for the declarative animations, a `matchMedia` check for the canvas loop and
 * another for the tilt.
 *
 * Guarantees spread across three mechanisms are guarantees that rot quietly:
 * nothing visibly breaks when one of them stops working, and the people it
 * breaks for are the least likely to be in the room. So the check is that the
 * picture is still THERE and still STILL — drawn, and byte-identical over time.
 */
test('the field is painted and static under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })

  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@sitrep.local')
  await page.getByLabel('Password').fill('sitrep-demo-2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Navika')

  const canvas = page.locator('canvas').first()
  await expect(canvas).toBeVisible()

  // Painted at all. A "static frame" that is actually a blank canvas would
  // pass every stillness check ever written.
  const painted = await canvas.evaluate((c: HTMLCanvasElement) => {
    const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data
    let n = 0
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++
    return n
  })
  expect(painted).toBeGreaterThan(1000)

  // And genuinely not moving: the drift is a sine on a 2.6s period, so 700ms
  // apart is comfortably enough to differ if the loop were running.
  const before = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())
  await page.waitForTimeout(700)
  const after = await canvas.evaluate((c: HTMLCanvasElement) => c.toDataURL())
  expect(after).toBe(before)

  // Nothing declarative is running either — this catches the CSS half of the
  // promise, which the canvas check cannot see.
  const running = await page.evaluate(
    () => document.getAnimations().filter((a) => a.playState === 'running').length,
  )
  expect(running).toBe(0)
})
