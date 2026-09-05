-- Sessions: stop storing the token.
--
-- The row id WAS the bearer token, in plaintext. Anyone able to read this
-- table held 30 days of account takeover for every user at once. Existing
-- rows cannot be migrated, because the raw tokens are precisely the thing
-- being removed - so every session is invalidated. That is intended.
DELETE FROM "sessions";

ALTER TABLE "sessions" ADD COLUMN "tokenHash" TEXT NOT NULL;
ALTER TABLE "sessions" ADD COLUMN "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "sessions" ADD COLUMN "ip" TEXT;
ALTER TABLE "sessions" ADD COLUMN "userAgent" TEXT;

CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- Failed sign-ins, for backoff and lockout. Keyed by email AND ip so neither
-- one account nor one origin can be ground down.
CREATE TABLE "login_attempts" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "attemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "succeeded" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "login_attempts_email_attemptAt_idx" ON "login_attempts"("email", "attemptAt");
CREATE INDEX "login_attempts_ip_attemptAt_idx" ON "login_attempts"("ip", "attemptAt");
