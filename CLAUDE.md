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
- **Search and chat are separate calls, again, on purpose.** This app tried
  Gemini's built-in `google_search` grounding tool first (one call for
  search+scoring) — but that returned HTTP 429 on every call on a fresh
  account with no billing linked, even though the base text-generation
  quota was fine. Rather than ask the founder to add a credit card, it went
  back to two standalone free services with no billing requirement: Tavily
  for search, Groq for scoring. `server.js` runs the searches itself, then
  hands results to the model as plain context. If a future provider offers
  genuinely free (no-billing) built-in search, collapsing back to one call
  is reasonable — but verify the billing requirement first, not just the
  advertised free quota.
- **The JSON parser salvages partial output, on purpose.** Free-tier models
  are weaker and slower than Claude at strict-format compliance, and can get
  cut off. `extractJSON()` in `server.js` scans for complete `{...}` objects
  even if the outer array is truncated, so a partial response still returns
  usable creators instead of failing the whole batch. Keep this behavior
  when touching that function.
- **API keys never reach the browser.** `server.js` is the only thing that
  holds the Groq/Tavily keys (from `GROQ_API_KEY`/`TAVILY_API_KEY` env vars
  or `config.json`); the frontend only ever calls this app's own `/api/*`
  routes. Don't add a fetch straight from `public/index.html` to Groq or
  Tavily.

## Architecture

```
public/index.html  →  server.js (/api/discover, /api/score)  →  Tavily (api.tavily.com/search)
                                                                →  Groq   (api.groq.com/openai/v1/chat/completions)
```

No second local process required — this is why it can deploy to a plain
Node host like Render or Railway, not just run on the founder's own
machine. `render.yaml` at the repo root configures that deploy.

`requestsThisSession` (in-memory counter in `server.js`, surfaced via
`/api/status` and in each `/api/discover`/`/api/score` response) is a rough
local tally, NOT real provider quota — neither Groq nor Tavily expose
remaining-quota data over the API, so this just counts Groq calls since the
process last started and resets on every restart/redeploy. The frontend
badge links out to `console.groq.com/settings/limits` for the real number.
Don't present the counter as authoritative if you touch this.

## Files

| File | Purpose |
|---|---|
| `server.js` | Express backend. Loads config (env vars or `config.json`), searches via Tavily, builds the scoring prompt, calls Groq, parses the result. |
| `public/index.html` | Entire frontend — UI, weight sliders, ranking math, rendering. Self-contained, no imports beyond a Google Fonts `@import`. |
| `config.example.json` → `config.json` | `groqApiKey`, `tavilyApiKey`, `model`. `config.json` is user-specific, gitignored — local-run convenience only. Hosted deploys use the `GROQ_API_KEY`/`TAVILY_API_KEY` env vars instead (set in the host's dashboard), which `loadConfig()` checks first. |
| `render.yaml` | Render deploy config — build/start commands, declares `GROQ_API_KEY` and `TAVILY_API_KEY` as required env vars. |
| `README.md` | Setup instructions written for the non-technical founder, not for a developer. Keep that audience in mind if editing it. |

## Running it locally

```bash
npm install
cp config.example.json config.json   # then paste in real Groq + Tavily keys
npm start                            # http://localhost:3000
```

Get free keys at https://console.groq.com/keys and https://app.tavily.com —
neither requires a linked billing account. No separate process needs to be
running. If no keys are found (env vars unset and no valid `config.json`),
the app fails gracefully — clean JSON error, not a crash; preserve that
behavior in `loadConfig()`.

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

## Provider history (why Gemini isn't used, if it comes up again)

Tried three configurations in order, all discovered by actually deploying
and hitting real errors, not by reading docs alone:
1. `gemini-2.5-flash` via plain chat completions through a third-party
   router (OmniRoute) — abandoned because it required the founder to run a
   second local process, which doesn't work on a hosted deploy at all.
2. Gemini's native API with `google_search` grounding, one call for
   search+scoring — `gemini-2.5-flash` 404'd ("no longer available to new
   users"), then `gemini-flash-latest` 429'd on its very first call
   (resolved to a model with zero account quota), then `gemini-3-flash` and
   `gemini-3.5-flash-lite` both 429'd on every call despite confirmed
   nonzero *text* quota on https://aistudio.google.com/rate-limit — the
   `google_search` tool specifically appears to require a linked billing
   account, separate from the base model's free quota.
3. **Current: Tavily (search) + Groq (scoring), two separate calls.**
   Neither requires billing to be linked for their free tier. This is the
   setup actually in `server.js` now.

If someone proposes moving back to Gemini, the billing-for-grounding issue
needs to be resolved first (or accepted, with a spend cap), not just the
model name swapped again.

## Known gaps / likely next work

- No automated tests yet. `server.js` has been manually boot-tested
  (serves the frontend, fails gracefully with no keys configured) but not
  yet exercised end-to-end against real Groq/Tavily calls with live keys —
  confirm the first live Discover/Score run actually returns usable
  results, and check the raw Groq response shape if `extractJSON()`
  produces nothing.
- No persistence — every run is stateless; nothing is saved between
  sessions. A "saved shortlist" or pipeline-tracking view (DM'd → booked →
  posted) has been discussed as a possible future addition but isn't built.
- `DIMS` is duplicated between `server.js` (prompt text) and
  `public/index.html` (UI + weighting). If the rubric changes, update both.
