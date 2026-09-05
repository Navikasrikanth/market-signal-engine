# How to run SITREP

Two routes below — **from a zip** and **from GitHub**. They differ only in how
you get the files; everything after that is identical.

**No API keys are needed.** The project ships with committed price history and
runs entirely offline by default. Keys are optional and only add live data.

Expect **5–10 minutes**, most of it Docker pulling images the first time.

---

## Before you start

You need three things installed:

| | check it works | if missing |
|---|---|---|
| **Docker Desktop** | `docker --version` | https://www.docker.com/products/docker-desktop — install, then **launch it** and wait for the whale icon to stop animating |
| **Node.js 20 or newer** | `node --version` | https://nodejs.org — take the LTS build |
| **npm** (ships with Node) | `npm --version` | — |

Docker Desktop must actually be **running**, not just installed. Every command
below assumes it is.

---

# Route A — from a zip file

### A1. Extract it

Unzip anywhere you like, then open a terminal **inside the extracted folder**.

```bash
cd path/to/market-signal-engine
```

You are in the right place if this lists a `package.json`:

```bash
ls
```

### A2. Create the settings file

The project reads its settings from a file called `.env`, which is not included
in the zip. Copy the template:

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

**That is all the configuration required.** The template already points at the
database Docker will start, and already has `FIXTURE_MODE=1`, which runs
everything from the committed history with no network access.

Now continue at **[Common steps](#common-steps)** below.

---

# Route B — from GitHub

### B1. Clone the repository

```bash
git clone https://github.com/Navikasrikanth/market-signal-engine.git
```

```bash
cd market-signal-engine
```

### B2. Get the right branch

The current work lives on `new-test`:

```bash
git checkout new-test
```

### B3. Create the settings file

```bash
cp .env.example .env
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Now continue below.

---

# Common steps

Run these in order, from inside the project folder.

### 1. Install dependencies

```bash
npm install
```

Takes a minute or two. Downloads the libraries the project uses.

### 2. Start the database and queue

```bash
docker compose up -d
```

This starts two containers: **PostgreSQL** (stores everything) on port 5433 and
**Redis** (job queue and cache) on port 6380. Non-standard ports on purpose, so
they cannot clash with anything already on your machine.

Check both are healthy — you want to see `(healthy)` twice:

```bash
docker compose ps
```

If it says `starting`, wait ten seconds and run it again.

### 3. Create the database tables

```bash
npx prisma migrate deploy
```

```bash
npx prisma generate
```

The first creates the tables; the second generates the type-safe database
client the app uses.

### 4. Load the data and compute everything

```bash
npm run demo:reset
```

**This is the big one, and it takes 2–4 minutes.** It runs four steps in
sequence:

1. seeds the 26 companies and the demo user
2. loads ~33,000 committed daily prices — no network
3. runs the analysis engine over all of it
4. sets the demo user's "last visit" to 75 days ago, so there is something to
   report

You will see it print progress per company, then a preview of the brief.

### 5. Start the app

```bash
npm run dev
```

Leave this running. Open **http://localhost:3000** in a browser.

Sign in with:

```
email:    demo@sitrep.local
password: sitrep-demo-2026
```

---

## What to look at

| page | what it shows |
|---|---|
| **/** | the brief — what changed since the demo user last looked |
| **/market** | the same data with nothing filtered out |
| **/positions** | the same moves, reframed by what you said you were doing |
| **/performance** | how often each detector's warnings actually preceded a move |
| **/replay** | step through a real historical crash one day at a time |
| **/watchlist** | add and remove names, set priority and intent |
| **/admin/pipeline** | data quality, queue depth, freshness |

Try this order: read the brief → open **"Why am I seeing this?"** on a card →
click **everything** to see what was held back → click **replay** and press
"skip to next event" a few times.

---

## Optional: the background worker

The app works fully without this. The worker is what fetches new data on a
schedule and recomputes when it arrives.

In a **second terminal**, from the same folder:

```bash
npm run worker
```

It prints which mode it is in. With the default settings it will say
`FIXTURE MODE - committed history, no network` and make no external calls.

---

## Optional: live market data

Only if you want fresh prices. Three free accounts, no card required:

- https://twelvedata.com — prices
- https://www.tiingo.com — second price source, used to cross-check the first
- https://finnhub.io — earnings dates and news headlines

Open `.env` in any text editor and fill in the three keys, then change:

```
FIXTURE_MODE=0
```

Restart the worker. It will now say `sources live (twelvedata, tiingo)`.

**Note:** the free tiers are slow by design — fetching all 26 companies takes
about three minutes because the app deliberately paces itself to stay inside
the rate limits rather than getting rejected.

---

## Checking everything works

```bash
npm test
```

225 tests of the analysis engine. Takes a few seconds.

```bash
npm run verify
```

69 checks against the real database and queue — that the security works, that
missing data is detected and repaired, that the cache cannot change an answer.

```bash
npm run build
```

Confirms it compiles for production.

---

## Stopping

Press `Ctrl+C` in the terminal running the app, then:

```bash
docker compose down
```

Your data survives. To start again, `docker compose up -d` and `npm run dev` —
no need to reload anything.

To erase everything and start completely fresh:

```bash
docker compose down -v
```

Then repeat from step 2.

---

## If something goes wrong

**`docker: command not found`** or `Cannot connect to the Docker daemon`
Docker Desktop is not running. Launch it and wait for it to finish starting.

**`DATABASE_URL is not set`**
The `.env` file is missing. Go back to the "Create the settings file" step.
Check it exists with `ls -a` (or `dir` on Windows).

**`Port 5433 is already allocated`**
Something else is using that port. Stop it, or edit `docker-compose.yml` and
`.env` together to use a different one.

**The page says "no data yet" or the brief is empty**
Step 4 did not finish. Run `npm run demo:reset` again and watch for errors.

**`P1001: Can't reach database server`**
The containers are not up yet. Run `docker compose ps` and wait for
`(healthy)`.

**Changes to the database don't show up in the running app**
Stop the app (`Ctrl+C`), run `npx prisma generate`, start it again. The running
process holds an older copy of the database client.

**Nothing else works**
Full reset, in order:

```bash
docker compose down -v
```

```bash
docker compose up -d
```

```bash
npx prisma migrate deploy && npx prisma generate && npm run demo:reset
```
