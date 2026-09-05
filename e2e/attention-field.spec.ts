import { test, expect } from '@playwright/test'

/**
 * The field must fit its frame, at any width.
 *
 * This exists because the same bug recurred three times while the scene was
 * being built: a constant was tuned until the picture happened to fit the
 * canvas it was being looked at, and then a different width — or simply a
 * different watchlist — put the tallest points back off the top. The names
 * that got cropped were always the highest-scoring ones, which is to say the
 * ones the whole picture exists to show.
 *
 * The fix was to make the scene measure itself and solve for a scale, so this
 * is the test of that: render at widths from a phone to a wide desktop and
 * assert no ink touches the canvas border. Reading the pixels is the point —
 * asserting on the fit variables would only re-state the implementation, and
 * would not have caught the label overhang that the arithmetic missed.
 */
test('the attention field never clips, at any width', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email').fill('demo@sitrep.local')
  await page.getByLabel('Password').fill('sitrep-demo-2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForSelector('canvas')

  for (const width of [1600, 1280, 1024, 820, 600, 420, 360]) {
    await page.setViewportSize({ width, height: 900 })
    // Let the resize handler re-solve the fit and repaint.
    await page.waitForTimeout(400)

    const edges = await page.locator('canvas').first().evaluate((c) => {
      const el = c as HTMLCanvasElement
      const d = el.getContext('2d')!.getImageData(0, 0, el.width, el.height).data
      const alpha = (px: number, py: number) => d[(py * el.width + px) * 4 + 3]

      let border = 0
      let ink = 0
      for (let px = 0; px < el.width; px++) {
        if (alpha(px, 0) > 0) border++
        if (alpha(px, el.height - 1) > 0) border++
      }
      for (let py = 0; py < el.height; py++) {
        if (alpha(0, py) > 0) border++
        if (alpha(el.width - 1, py) > 0) border++
      }
      for (let i = 3; i < d.length; i += 4) if (d[i] > 0) ink++
      return { border, ink }
    })

    // Nothing touching the frame...
    expect(
      edges.border,
      `scene bleeds off the canvas edge at ${width}px`,
    ).toBe(0)

    // ...and it did not simply fit by rendering nothing.
    expect(edges.ink, `scene is blank at ${width}px`).toBeGreaterThan(500)
  }
})
