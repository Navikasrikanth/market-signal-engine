import type { ContextEvent } from '../src/engine/context'

/**
 * Curated historical context.
 *
 * "Curated" is the honest word and the one used in the README. This is a
 * hand-assembled table, not a feed: historical news is unavailable through any
 * provider this project can afford, and the free tier retains about two days.
 *
 * Two rules govern what goes in:
 *
 *   1. Every row carries a `source`. An unsourced row is a rumour, and a
 *      product built on explainability cannot afford one.
 *   2. Nothing here asserts a market effect. Rows describe what HAPPENED in
 *      the world; whether a price move relates to one is decided by
 *      `src/engine/context.ts`, scored, and always phrased temporally.
 *
 * Coverage is deliberately thin and centred on the replay windows. A sparse
 * table that says "nothing known" most of the time is more useful than a dense
 * one that always has something plausible to offer.
 */
export const HISTORICAL_CONTEXT: Omit<ContextEvent, 'id'>[] = [
  // ---------------------------------------------------------------- 2020
  {
    eventDate: '2020-02-24',
    eventEndDate: '2020-02-28',
    title: 'the first wave of COVID-19 spreading beyond China',
    description:
      'Outbreaks in Italy, Iran and South Korea in late February 2020 marked the point at which the epidemic was widely understood to be global.',
    category: 'PUBLIC_HEALTH',
    scope: 'GLOBAL',
    importance: 'HIGH',
    source: 'WHO situation reports',
    sourceUrl: 'https://www.who.int/emergencies/diseases/novel-coronavirus-2019/situation-reports',
    sectors: [],
  },
  {
    eventDate: '2020-03-09',
    eventEndDate: '2020-03-23',
    title: 'the escalation of the COVID-19 pandemic and the shutdown of public life',
    description:
      'The WHO declared a pandemic on 11 March 2020. US markets hit circuit breakers repeatedly through the month, and the Federal Reserve cut rates to near zero on 15 March.',
    category: 'PUBLIC_HEALTH',
    scope: 'GLOBAL',
    importance: 'HIGH',
    source: 'WHO; Federal Reserve press releases',
    sourceUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20200315a.htm',
    sectors: [],
  },

  // ---------------------------------------------------------------- 2022
  {
    eventDate: '2022-02-24',
    eventEndDate: '2022-03-08',
    title: 'the Russian invasion of Ukraine and the commodity shock that followed',
    description:
      'Russia invaded Ukraine on 24 February 2022. Energy and grain prices moved sharply over the following fortnight.',
    category: 'GEOPOLITICAL',
    scope: 'GLOBAL',
    importance: 'HIGH',
    source: 'Contemporaneous reporting',
    sourceUrl: null,
    sectors: [],
  },
  {
    eventDate: '2022-06-15',
    eventEndDate: null,
    title: 'the Federal Reserve raising rates by 75 basis points, its largest step since 1994',
    description:
      'The FOMC raised the target range by 0.75 percentage points on 15 June 2022 as inflation ran above 8%.',
    category: 'MONETARY_POLICY',
    scope: 'US',
    importance: 'HIGH',
    source: 'FOMC statement, 15 June 2022',
    sourceUrl: 'https://www.federalreserve.gov/newsevents/pressreleases/monetary20220615a.htm',
    sectors: [],
  },

  // ---------------------------------------------------------------- 2023
  {
    eventDate: '2023-03-10',
    eventEndDate: '2023-03-17',
    title: 'the failure of Silicon Valley Bank and the regional banking stress that followed',
    description:
      'SVB was closed by California regulators on 10 March 2023, followed by Signature Bank. Emergency liquidity facilities were announced on 12 March.',
    category: 'FINANCIAL_CRISIS',
    scope: 'SECTOR',
    importance: 'HIGH',
    source: 'FDIC press releases',
    sourceUrl: 'https://www.fdic.gov/news/press-releases/2023/pr23016.html',
    sectors: ['Financials'],
  },
  {
    eventDate: '2023-11-30',
    eventEndDate: null,
    title: 'the broad rally that followed softer US inflation data',
    description:
      'October 2023 PCE inflation came in at 3.0% year on year, reinforcing expectations that the tightening cycle had ended.',
    category: 'MACROECONOMIC',
    scope: 'US',
    importance: 'MEDIUM',
    source: 'US Bureau of Economic Analysis',
    sourceUrl: null,
    sectors: [],
  },

  // ---------------------------------------------------------------- 2025
  {
    eventDate: '2025-01-27',
    eventEndDate: '2025-01-28',
    title:
      'the release of a competitive open-weight AI model trained at reportedly far lower cost',
    description:
      'Reporting on DeepSeek-R1 in late January 2025 prompted a reassessment of expected AI infrastructure spending. Semiconductor names fell sharply on 27 January.',
    category: 'CORPORATE',
    scope: 'SECTOR',
    importance: 'HIGH',
    source: 'Contemporaneous reporting',
    sourceUrl: null,
    sectors: ['Semiconductors', 'Information Technology'],
  },
]
