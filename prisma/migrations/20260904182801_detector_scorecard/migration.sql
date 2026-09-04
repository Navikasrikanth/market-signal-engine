-- CreateTable
CREATE TABLE "detector_scorecards" (
    "detector" TEXT NOT NULL,
    "engineV" TEXT NOT NULL,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "fired" INTEGER NOT NULL,
    "surfaced" INTEGER NOT NULL,
    "checked" INTEGER NOT NULL,
    "followed" INTEGER NOT NULL,
    "baseChecked" INTEGER NOT NULL,
    "baseFollowed" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "detector_scorecards_pkey" PRIMARY KEY ("detector")
);
