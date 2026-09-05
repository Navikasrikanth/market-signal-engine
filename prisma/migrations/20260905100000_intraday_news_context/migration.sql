-- Intraday bars: recent window only, and NOT an analytical input.
CREATE TABLE "intraday_bars" (
    "instrumentId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL,
    "open" DOUBLE PRECISION NOT NULL,
    "high" DOUBLE PRECISION NOT NULL,
    "low" DOUBLE PRECISION NOT NULL,
    "close" DOUBLE PRECISION NOT NULL,
    "volume" BIGINT NOT NULL,
    "source" TEXT NOT NULL,

    CONSTRAINT "intraday_bars_pkey" PRIMARY KEY ("instrumentId","at")
);
CREATE INDEX "intraday_bars_at_idx" ON "intraday_bars"("at");
ALTER TABLE "intraday_bars" ADD CONSTRAINT "intraday_bars_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- News: corroboration counts distinct outlets, never article volume.
CREATE TABLE "news_items" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "headline" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "summary" TEXT,
    "corroboration" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_items_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "news_items_fingerprint_key" ON "news_items"("fingerprint");
CREATE INDEX "news_items_instrumentId_publishedAt_idx" ON "news_items"("instrumentId", "publishedAt" DESC);
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_instrumentId_fkey"
    FOREIGN KEY ("instrumentId") REFERENCES "instruments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Curated historical context: what a market event COINCIDED with.
CREATE TABLE "historical_context_events" (
    "id" TEXT NOT NULL,
    "eventDate" DATE NOT NULL,
    "eventEndDate" DATE,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "importance" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceUrl" TEXT,
    "sectors" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "historical_context_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "historical_context_events_eventDate_idx" ON "historical_context_events"("eventDate");

-- Reconciliation audit trail: the decision, not just the outcome.
ALTER TABLE "bar_conflicts" ADD COLUMN "resolvedValue" DECIMAL(18,6);
ALTER TABLE "bar_conflicts" ADD COLUMN "reason" TEXT NOT NULL DEFAULT 'HIGHER_TRUST_SOURCE';
ALTER TABLE "bar_conflicts" ADD COLUMN "trustOverride" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "bar_conflicts" ADD COLUMN "algorithmV" TEXT NOT NULL DEFAULT 'RECONCILIATION_V1';
