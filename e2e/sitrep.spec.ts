import { test, expect, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'

/**
 * The happy path, through a real browser.
 *
 * One journey, covering the assignment's three minimums end to end: sign in,
 * see what changed since the cursor, understand why, acknowledge it, and watch
 * the brief change as a result. The unit tests prove the engine is correct;
 * this proves the correctness reaches the screen.
 *
 * Deliberately not exhaustive. Broad browser coverage of a product whose logic
 * is already covered by 130 unit tests would be slow to run and slower to
 * maintain, and would mostly re-test React.
 */

/** Reset the demo user to a known returning-user state before the journey. */
test.beforeAll(() => {
  execSync('npx tsx scripts/seed-demo.ts --days=75', { stdio: 'pipe' })
})

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('EMAIL').fill('demo@sitrep.local')
  await page.getByLabel('PASSWORD').fill('sitrep-demo-2026')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Navika')
}

test('a returning user sees what changed, why, and can clear it', async ({
  page,
}) => {
  await signIn(page)

  // --- the brief exists and is framed by the cursor ------------------------
  await expect(page.getByText(/HERE'S WHAT CHANGED SINCE YOU LAST CHECKED/)).toBeVisible()
  await expect(page.getByText(/DAYS AGO/)).toBeVisible()

  const cards = page.locator('article')
  const cardCount = await cards.count()
  expect(cardCount).toBeGreaterThan(0)

  // The attention budget must actually cap the list, not just exist.
  expect(cardCount).toBeLessThanOrEqual(5)

  // --- the score is explained, in both directions --------------------------
  const first = cards.first()
  const symbol = (await first.locator('h3').first().innerText()).trim()

  await first.getByRole('button', { name: 'Why am I seeing this?' }).click()
  await expect(first.getByText('RANKED')).toBeVisible()
  await expect(first.getByText('WHY NOT HIGHER')).toBeVisible()

  // --- acknowledging removes it and promotes the next ----------------------
  // Wait for the write to land rather than racing it: the click handler is
  // async, so click() returns before the request completes.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/watch-state/mark-seen') && r.ok(),
    ),
    first.getByRole('button', { name: 'Mark seen' }).click(),
  ])

  // The card must stay gone across a full reload, not just optimistically in
  // local state - the cursor lives on the server.
  await page.reload()
  await expect(
    page.locator('article').filter({ has: page.getByRole('heading', { name: symbol, exact: true }) }),
  ).toHaveCount(0)

  // --- the product is honest about what it held back -----------------------
  await expect(
    page.getByText(/moved within (its|their) normal range/),
  ).toBeVisible()
})

test('snoozing defers an event without advancing the cursor', async ({
  page,
}) => {
  await signIn(page)

  const header = page.getByText(/HERE'S WHAT CHANGED SINCE YOU LAST CHECKED/)
  const before = (await header.innerText()).trim()

  const card = page.locator('article').first()
  const symbol = (await card.locator('h3').first().innerText()).trim()

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/watch-state/snooze') && r.ok(),
    ),
    card.getByRole('button', { name: 'Snooze 24h' }).click(),
  ])

  await page.reload()

  // Gone from the brief...
  await expect(
    page
      .locator('article')
      .filter({ has: page.getByRole('heading', { name: symbol, exact: true }) }),
  ).toHaveCount(0)

  // ...but the cursor did NOT move. This is the whole point of snooze: the
  // window still measures from the last real acknowledgement, so the deferred
  // event returns intact rather than being silently absorbed.
  await expect(header).toHaveText(before)

  // And the brief says so rather than counting it as a quiet name.
  await expect(page.getByText(/snoozed/)).toBeVisible()
  await expect(page.getByText(/still pending, not cleared/)).toBeVisible()
})

test('the watchlist can be managed', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'watchlist', exact: true }).click()

  await expect(page.getByRole('heading', { name: 'Manage your watchlist' })).toBeVisible()

  const rows = page.locator('li').filter({ has: page.locator('select') })
  const before = await rows.count()
  expect(before).toBeGreaterThan(0)

  // Priority is a real control, not decoration: it multiplies the score.
  const symbol = (await rows.first().locator('span').first().innerText()).trim()

  // Match the ticker exactly. `hasText` is a case-insensitive SUBSTRING match,
  // so filtering on "MU" also selected every name in Communication Services -
  // which only showed up once the seed order changed and MU landed first.
  const row = rows.filter({ has: page.getByText(symbol, { exact: true }) })

  // Wait for the write rather than racing it. selectOption returns as soon as
  // the change event fires, so reloading immediately could read the row back
  // before the PATCH had landed - and the test would then blame the UI for a
  // value the server had simply not been told about yet.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/watchlist/items') && r.ok(),
    ),
    row.locator('select').first().selectOption('HIGH'),
  ])

  await page.reload()
  await expect(row.locator('select').first()).toHaveValue('HIGH')

  // Remove it, confirm the list shrank, then add it back.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/watchlist/items') && r.ok(),
    ),
    row.getByRole('button', { name: 'Remove' }).click(),
  ])
  await expect(rows).toHaveCount(before - 1)

  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/watchlist/items') && r.ok(),
    ),
    page.getByRole('button', { name: `+ ${symbol}` }).click(),
  ])
  await expect(rows).toHaveCount(before)

  // Leave the demo state as it was found.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes('/api/watchlist/items') && r.ok(),
    ),
    row.locator('select').first().selectOption('NORMAL'),
  ])
})

test('replay shows a theme forming, and refuses to invent one', async ({
  page,
}) => {
  await signIn(page)

  // The semiconductor window: a theme should form.
  await page.goto('/replay?s=semis-selloff')
  await expect(page.getByRole('heading', { name: /Watch the engine work/ })).toBeVisible()

  await page.getByRole('button', { name: /skip to next event/ }).click()
  await page.getByRole('button', { name: /skip to next event/ }).click()

  await expect(page.getByText('SEMICONDUCTORS THEME DETECTED')).toBeVisible()
  await expect(page.getByText(/rule: theme_led_market/)).toBeVisible()

  // The COVID window: everything falls, so NO sector theme may be reported.
  // This is the single most important behavioural claim in the product.
  await page.goto('/replay?s=covid-crash')

  for (let i = 0; i < 12; i++) {
    const skip = page.getByRole('button', { name: /skip to next event/ })
    if (!(await skip.isVisible().catch(() => false))) break
    await skip.click()
    await expect(page.getByText(/THEME DETECTED/)).toHaveCount(0)
  }
})

test('the track record is published, with its sample sizes', async ({
  page,
}) => {
  await signIn(page)
  await page.getByRole('link', { name: 'track record' }).click()

  await expect(
    page.getByRole('heading', { name: 'Does this thing actually work?' }),
  ).toBeVisible()

  // A rate is meaningless without its sample size, so both must be on screen.
  await expect(page.getByText(/%\s*n=/).first()).toBeVisible()

  // And without its baseline: the page must state what "look every day" scores.
  await expect(page.getByText(/BASELINE/).first()).toBeVisible()

  // The claim the page exists to make - it says what it is not.
  await expect(page.getByText(/proxy, not ground truth/)).toBeVisible()

  // The same figures reach the card, next to the reason they qualify.
  await page.goto('/')
  const first = page.locator('article').first()
  await first.getByRole('button', { name: 'Why am I seeing this?' }).click()
  await expect(first.getByText(/preceded a real move .*% of the time/).first()).toBeVisible()
})

test('the brief says what happened, not only what still matters', async ({
  page,
}) => {
  await signIn(page)

  await expect(page.getByText('WHILE YOU WERE AWAY')).toBeVisible()

  // Events that fired AND resolved during the absence are invisible in the
  // ranked list by construction - ranking only sees the present. Their absence
  // would be a silent omission of exactly what "you missed" means.
  await expect(page.getByText('CAME AND WENT')).toBeVisible()
  await expect(
    page.getByText(/no longer ranked, because they are no longer true/),
  ).toBeVisible()
})

test('replay runs an arbitrary window and never invents a cause', async ({
  page,
}) => {
  await signIn(page)

  // A user-chosen range, through the same pipeline as the featured examples.
  await page.goto('/replay?from=2026-06-01&to=2026-06-30')
  await expect(
    page.getByRole('heading', { name: /Watch the engine work/ }),
  ).toBeVisible()
  await expect(page.getByText('HISTORICAL CONTEXT').first()).toBeVisible()

  // A window with nothing stored says which windows exist, rather than
  // rendering an empty player that looks broken.
  await page.goto('/replay?from=2015-01-05&to=2015-01-20')
  await expect(page.getByText('NO DATA FOR THIS WINDOW')).toBeVisible()

  // The language rule, asserted on screen rather than only in the engine.
  const body = await page.locator('main').innerText()
  expect(body).not.toMatch(/caused|because of|due to/i)

  // The featured window reaches a day the curated table knows about, and
  // still only ever says the two things coincided.
  await page.goto('/replay?s=semis-selloff')
  for (let i = 0; i < 3; i++) {
    const skip = page.getByRole('button', { name: /skip to next event/ })
    if (!(await skip.isVisible().catch(() => false))) break
    await skip.click()
  }
  const semis = await page.locator('main').innerText()
  expect(semis).not.toMatch(/caused/i)
})

test('the brief shows the path, not only the endpoints', async ({ page }) => {
  await signIn(page)

  // A one-line shape of the absence, before any card.
  await expect(page.getByText(/^In \d+ trading sessions?:/)).toBeVisible()

  // And where the price went in between — but only when the endpoints do not
  // already imply it. A name up 76% was obviously lower earlier; saying so is
  // arithmetic, not information.
  await expect(page.getByText(/REACHED|FELL TO/).first()).toBeVisible()
  await expect(
    page.getByText(
      /(higher before easing back|below where you last saw it, then recovered)/,
    ).first(),
  ).toBeVisible()
})

test('the attention budget is adjustable, and signing out is possible', async ({
  page,
}) => {
  await signIn(page)
  const before = await page.locator('article').count()

  await page.getByRole('link', { name: 'watchlist', exact: true }).click()

  // The budget was read from user settings from the start while being settable
  // only by editing the database.
  const select = page.getByLabel('Names per brief')
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/settings') && r.ok()),
    select.selectOption('3'),
  ])

  await page.goto('/')
  await expect(page.locator('article')).toHaveCount(Math.min(3, before))

  // Put it back, then prove a user can actually leave.
  await page.goto('/watchlist')
  await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/settings') && r.ok()),
    page.getByLabel('Names per brief').selectOption('5'),
  ])

  await page.getByRole('button', { name: 'sign out', exact: true }).click()
  await expect(page).toHaveURL(/\/login/)

  // And that the session is genuinely gone, not just navigated away from.
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('three views answer three different questions', async ({ page }) => {
  await signIn(page)

  // The brief has an opinion: it cuts to the attention budget.
  const briefCount = await page.locator('article').count()
  expect(briefCount).toBeLessThanOrEqual(5)

  // "Everything" is the same market with the opinion removed, so it must show
  // at least as much - a view that filtered too would not be a second view.
  await page.getByRole('link', { name: 'everything' }).click()
  await expect(
    page.getByRole('heading', { name: 'Everything at once' }),
  ).toBeVisible()
  const rows = page.locator('tbody tr')
  expect(await rows.count()).toBeGreaterThanOrEqual(briefCount)

  // Positions reframes rather than re-ranks.
  await page.getByRole('link', { name: 'positions' }).click()
  await expect(
    page.getByRole('heading', { name: 'What it means for you' }),
  ).toBeVisible()

  // The claim the page exists to make, and the one it must never break: no
  // position size, cost basis or profit in any ROW.
  //
  // Scoped to the list rather than the page, because the page's own footer
  // says those words in order to promise their absence - asserting over the
  // whole document would fail on the disclaimer explaining the rule.
  const positionRows = page.locator('main li')
  const count = await positionRows.count()
  for (let i = 0; i < count; i++) {
    const text = await positionRows.nth(i).innerText()
    expect(text).not.toMatch(/cost basis|P&L|profit|shares|units/i)
  }
})

test('a holding and a considered buy read the same move oppositely', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/positions')

  // Whatever the demo state, any framing shown must be position-aware rather
  // than a restatement of the price move.
  const text = await page.locator('main').innerText()
  if (/HOLDING/.test(text)) {
    expect(text).toMatch(/You hold this\./)
  }
  if (/CONSIDERING/.test(text)) {
    expect(text).toMatch(/considering buying/)
  }
})

test('the pipeline page reports data quality and queue state', async ({
  page,
}) => {
  await signIn(page)
  await page.goto('/admin/pipeline')

  await expect(page.getByRole('heading', { name: 'Pipeline health' })).toBeVisible()
  // Headings specifically: "SOURCES" also appears as a table column header.
  await expect(page.getByRole('heading', { name: 'DATA QUALITY' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'QUEUES' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'SOURCES' })).toBeVisible()
})
