# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

A dashboard for dxw staff to maintain the dxw Slack workspace. It lists public channels with their members and recent activity, and lets staff archive quiet channels, one at a time or several at once. Express 5 + Nunjucks templates + Tailwind 4, plain ESM JavaScript (no TypeScript, no bundler). Node version is pinned in `.nvmrc`.

## Commands

```sh
npm run dev          # nodemon server + Tailwind watch, reads .env (http://localhost:3000)
npm start            # production start (no CSS build; run `npm run build` first)
npm run build        # compile src/main.css → src/public/styles.css
npm test             # node:test, finds src/**/*.test.js
npm run lint         # eslint (CI runs lint then test on PRs and pushes to main)
npm run format       # prettier (tabs, single quotes, no bracket spacing)

node --test src/slack/index.test.js                       # one file
node --test --test-name-pattern="archive" src/app.test.js # matching tests
```

To run locally with no Slack app or Google client, set `SESSION_SECRET`, `DEV_AUTH=true` and `SLACK_FAKE_DATA=true` in `.env` (both flags are ignored when `NODE_ENV=production`). All env vars are documented in `.env.example`.

## Deployment

Production runs on Heroku and deploys automatically on every push to `main`. There's no Procfile, so Heroku runs `npm start`. The Node.js buildpack runs `npm run build` (the Tailwind CSS) during the build, and the Node version comes from `engines` in `package.json` (keep it in step with `.nvmrc`).

Things that follow from running on Heroku:

- **Run one dyno only.** Channel data, bulk archive progress and sessions are all held in process memory, so more than one dyno would show different data and lose sessions.
- **Restarts start fresh.** Heroku restarts dynos at least once a day and on every deploy. Each restart signs everyone out and runs a full refresh from Slack. The `.cache` file is only used in development.
- **`NODE_ENV=production`** turns off `DEV_AUTH`, `SLACK_FAKE_DATA` and the dev cache, and makes session cookies `secure`. `app.set('trust proxy', 1)` is there because Heroku's router sits in front of the app.
- **`BASE_URL`** must be the app's public URL, and `<BASE_URL>/auth/callback` must be an authorised redirect URI on the Google OAuth client.

## Architecture

**Request path never calls Slack for reads.** `src/slack/index.js` holds a module-level in-memory `state` (channels, per-channel activity, team names, the current bulk archive job). `startChannelRefresh()` (called from `src/server.js`, not `app.js`) loads it from Slack at startup and every 6 hours; routes read it synchronously with `getChannelData()` / `getChannel()`. A refresh is slow on purpose (it pauses between channels to stay under Slack rate limits), and the page fills in as results arrive.

**Layers in `src/slack/`:**
- `api.js` — thin Slack Web API client over `fetch`, with 429/`Retry-After` retry. `toChannel()` maps Slack's conversation objects to the app's `Channel` shape (JSDoc typedef there).
- `activity.js` — turns messages into `{lastMessageAt, messagesLastSixMonths}` and decides "inactive" (182 days, treated as 6 months). Only messages from people/bots count, not Slack system subtypes.
- `index.js` — the store, refresh loop, archivability rules (`isArchivable`) and archive actions.
- `cache.js` — in development only, saves state to `.cache/channels.json` so nodemon restarts don't trigger a multi-minute refresh. Delete the file to force a refresh. `loadCache` returns null for files in an old shape, so change its check if you change what's stored.
- `fake-channels.js` — data for `SLACK_FAKE_DATA=true`. In fake mode, archiving updates state without calling Slack (`state.fake`).

**Archiving.** `archiveChannelById` re-checks the channel with Slack (fresh info and messages) before archiving, because stored data can be hours old, and throws `NotArchivableError` if it no longer qualifies. Bulk archive (`startBulkArchive`) runs in the background, one channel at a time with pauses, tracks progress in `state.bulkArchive`, and allows only one job at a time (`BulkArchiveRunningError`) of at most `MAX_BULK_ARCHIVE`. The route saves the job ID in the session so only the person who started it sees the summary.

**Slack Connect.** Channels hosted by another organisation are filtered out. For shared channels we host, `sharedTeamIds` comes from `conversations.info` (the list call leaves it out), and team names are looked up and kept between refreshes.

**Web layer.** `src/app.js` builds the Express app (sessions in `memorystore`, Nunjucks, auth) and is imported by tests without starting the refresh. Auth (`src/auth/`) is Google OIDC limited to verified `@dxw.com` accounts, or a dev email login when `DEV_AUTH=true`. Startup throws if neither is configured. All routes are in `src/routes/index.js`. The homepage takes `status`/`q` query params, and `homeUrl()` leaves out defaults. One-off flash messages go through `req.session.notice`. The route supplies all matching rows as JSON; sorting comparators live in `src/public/channel-sorting.js`, and AG Grid handles sorting and pagination in `src/public/channel-grid.js`.

**Browser JS (`src/public/*.js`)** includes ES modules (`channel-grid.js` and its imports) and classic scripts (`search.js`, `archive-dialog.js` and `bulk-archive.js`). Top-level names in the classic scripts share a global scope and must not clash. The channels grid requires JavaScript; search also supports normal form submission. `search.js` swaps parts of the page in place and dispatches a `channels:updated` event, so other scripts listen on `document` or re-query elements instead of binding to table rows once.

## Testing conventions

Tests use `node:test` + `node:assert/strict` and sit next to the code they test (`*.test.js`). Slack is faked by `mock.method(globalThis, 'fetch', …)`, routing on the API method name in the URL. Real `fetch` still reaches the test server. `app.test.js` sets `process.env` and the fetch mock before dynamically importing `app.js`, then listens on port 0. Store tests call `resetChannelData()` between cases, pass `pauseMs: 0` and a fixed `now`, and use `waitForBulkArchive()` to await background jobs.

## Repo-specific notes

- The Slack plan isn't Enterprise, so `admin.*` APIs aren't available.
- Bot scopes: `channels:read`, `channels:history`, `channels:join`, `channels:manage`, `team:read`. The bot only sees activity in channels it's a member of. Joining (`SLACK_JOIN_CHANNELS=true`) posts a visible message, so it's off by default.
- Code comments and UI text use British English, plain language and typographic apostrophes (’).
