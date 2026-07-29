# Creator Finder — project context

Read this before making changes. It's the standalone version of a
creator-prospecting tool for an eco-friendly residential cleaning startup
in NYC. A parallel version exists as a Claude.ai React artifact (not in this
repo) that calls Anthropic's API directly — this version exists so the
founder can run it for free instead, either locally or deployed to a free
host (Render/Railway) so it's reachable at a plain URL.

## What this app does

Helps a cleaning-startup founder find and rank Instagram creators worth
seeding with a free clean (in exchange for a post). Two modes:
- **Discover** — search the web for candidate creators across selectable
  segments (fitness, home/interiors, NYC lifestyle, etc.)
- **Score** — rank a pasted list of creators the founder already found

Every creator gets six 0–100 sub-scores (local audience density, income
fit, content-nativeness, engagement quality, activation cost-fit, eco
alignment). The **frontend** computes the weighted total from user-adjustable
sliders, so re-weighting re-ranks instantly with no new API call.

## Why it's built this way (read before "simplifying")

- **No frontend build step, on purpose.** `public/index.html` is vanilla
  HTML/CSS/JS, not React. The person running this is a non-technical
  first-time founder — `npm install && npm start` needs to be the entire
  setup. Don't reintroduce a bundler/JSX pipeline without a strong reason.
- **Search and scoring are one call, on purpose.** Gemini's `google_search`
  tool lets the model decide when to search and write the answer in the
  same round trip (`POST /v1beta/interactions`) — there's no separate
  search step to orchestrate in `server.js` anymore. If this ever moves to
  a provider without that kind of built-in grounding, that's when a
  separate search step would come back.
- **The JSON parser salvages partial output, on purpose.** Free-tier models
  are weaker and slower than Claude at strict-format compliance, and can get
  cut off. `extractJSON()` in `server.js` scans for complete `{...}` objects
  even if the outer array is truncated, so a partial response still returns
  usable creators instead of failing the whole batch. Keep this behavior
  when touching that function.
- **The API key never reaches the browser.** `server.js` is the only thing
  that holds the Gemini key (from `GEMINI_API_KEY` env var or `config.json`);
  the frontend only ever calls this app's own `/api/*` routes. Don't add a
  fetch straight from `public/index.html` to the Gemini API.

## Architecture

```
public/index.html  →  server.js (/api/discover, /api/score)  →  Gemini API (generativelanguage.googleapis.com)
                                                                    POST /v1beta/interactions, tools:[{type:"google_search"}]
```

No second local process required — this is why it can deploy to a plain
Node host like Render or Railway, not just run on the founder's own
machine. `render.yaml` at the repo root configures that deploy.

`requestsThisSession` (in-memory counter in `server.js`, surfaced via
`/api/status` and in each `/api/discover`/`/api/score` response) is a rough
local tally, NOT real Gemini quota — the API doesn't expose remaining
quota, so this just counts calls since the process last started and resets
on every restart/redeploy. The frontend badge links out to
`aistudio.google.com/rate-limit` for the real number. Don't present the
counter as authoritative if you touch this.

## Files

| File | Purpose |
|---|---|
| `server.js` | Express backend. Loads config (env var or `config.json`), calls the Gemini API with search grounding on, parses the result. |
| `public/index.html` | Entire frontend — UI, weight sliders, ranking math, rendering. Self-contained, no imports beyond a Google Fonts `@import`. |
| `config.example.json` → `config.json` | `geminiApiKey`, `model`. `config.json` is user-specific, gitignored — local-run convenience only. Hosted deploys use the `GEMINI_API_KEY` env var instead (set in the host's dashboard), which `loadConfig()` checks first. |
| `render.yaml` | Render deploy config — build/start commands, declares `GEMINI_API_KEY` as a required env var. |
| `README.md` | Setup instructions written for the non-technical founder, not for a developer. Keep that audience in mind if editing it. |

## Running it locally

```bash
npm install
cp config.example.json config.json   # then paste in a real Gemini API key
npm start                            # http://localhost:3000
```

Get a free key at https://aistudio.google.com/apikey. No separate process
needs to be running. If no key is found (env var unset and no valid
`config.json`), the app fails gracefully — clean JSON error, not a crash;
preserve that behavior in `loadConfig()`.

## The scoring rubric (business logic, not just code)

The six dimensions and their default weights encode a real strategic
argument, not arbitrary defaults — see `DIMS` in both `server.js` and
`public/index.html` (kept in sync manually; there's no shared module yet).
In short: follower count is deliberately *not* a scoring input — it only
matters indirectly through `local` (audience density) and `activation`
(a free clean is a trivial incentive to a large/macro creator, so that
dimension penalizes them). If asked to "add follower count as a factor,"
push back and ask whether the intent is actually one of the existing six
dimensions.

**The default weights are an unvalidated hypothesis**, not calibrated data —
flagged as such in the UI. Don't quietly change them without flagging it
back to the user; they're waiting on real booking-conversion data from the
founder to recalibrate for real.

## Known gaps / likely next work

- No automated tests yet. `server.js` has been manually boot-tested
  (serves the frontend, fails gracefully with no Gemini key configured) but
  not yet exercised against a real Gemini call with a live key — the
  `/v1beta/interactions` response-parsing logic in `geminiGroundedCall()`
  (which step type holds the text, where citations live) is based on
  Google's documented shape as of 2026-07-28, not a confirmed live response.
  If parsing misbehaves, log the raw response body first.
- No persistence — every run is stateless; nothing is saved between
  sessions. A "saved shortlist" or pipeline-tracking view (DM'd → booked →
  posted) has been discussed as a possible future addition but isn't built.
- `DIMS` is duplicated between `server.js` (prompt text) and
  `public/index.html` (UI + weighting). If the rubric changes, update both.
