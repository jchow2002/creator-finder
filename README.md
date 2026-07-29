# Creator Finder

Finds and ranks Instagram creators worth seeding with a free clean, in
exchange for a post. Powered by two free services: **Tavily** for web
search and **Groq** for scoring. No Anthropic key, no monthly cost, and
neither provider requires a credit card for their free tier (unlike
Google's Gemini Search grounding, which needs a linked billing account
even to unlock its free allowance — that's why this app doesn't use Gemini).

You can run this two ways: **on your own computer**, or **hosted for free**
so you (or a teammate) can just open a link in any browser. Hosting is the
easier one to hand off to someone non-technical — pick that if you're not
sure.

## Option A — Host it for free (recommended)

This gives you a real URL, no terminal required after setup.

**1. Get two free API keys — neither needs a credit card.**
- Groq (scoring): go to https://console.groq.com/keys, sign up, create a key.
- Tavily (search): go to https://app.tavily.com, sign up, copy your key from
  the dashboard.

Copy both somewhere safe — you'll paste them once into the hosting
dashboard, never into any file you commit to GitHub.

**2. Put this project on GitHub.**
If it isn't already, create a new (private is fine) GitHub repository and
push this folder to it.

**3. Deploy on Render** (or Railway — steps are nearly identical).
- Go to https://render.com and sign up (free, no card required for this).
- **New +** → **Web Service** → connect your GitHub repo.
- Render should auto-detect the settings from `render.yaml` in this repo
  (build command `npm install`, start command `npm start`). If it doesn't
  auto-detect, set those manually.
- Under **Environment**, add two variables:
  - `GROQ_API_KEY` = your Groq key
  - `TAVILY_API_KEY` = your Tavily key
- Click **Create Web Service**. Render gives you a URL like
  `https://creator-finder.onrender.com` — that's the link you share.

That's it — no local install, no second process to keep running. The free
Render plan spins the service down after inactivity, so the very first
request after a quiet period takes ~30-60 seconds to wake back up; that's
normal, not a bug.

## Option B — Run it on your own computer

**1. Install Node.js** (if you don't have it): https://nodejs.org — get the
"LTS" version.

**2. Get free API keys**, same as step 1 above:
https://console.groq.com/keys and https://app.tavily.com

**3. Install this app's dependencies** (in a terminal, in this folder):
```bash
npm install
```

**4. Set up your config:**
```bash
cp config.example.json config.json
```
Open `config.json` and paste your keys into `groqApiKey` and `tavilyApiKey`.

**5. Run it:**
```bash
npm start
```
Open `http://localhost:3000` in your browser.

`config.json` holds real secrets — it's already excluded from git via
`.gitignore`, so it's safe to leave in this folder. Never paste your keys
directly into `public/index.html` or any file you commit.

## What to expect honestly

- **Quality is good but not Claude-level.** Groq's free-tier models are
  solid for this kind of task, but expect occasional messy output or a run
  that needs a retry.
- **Free tiers are real but finite.** Groq's `llama-3.3-70b-versatile` free
  tier is generous (roughly 1,000 requests/minute, 300K tokens/minute as of
  this writing — check your real numbers at
  https://console.groq.com/settings/limits). Tavily's free tier covers a
  solid number of searches per month before it asks you to upgrade — check
  your usage at https://app.tavily.com. Every Discover/Score click uses one
  Groq call and a handful of Tavily searches (one per segment or per
  creator pasted).
- **This is still a seed list, not verified audience data.** The "local
  audience" score is the model's estimate from what it finds via search,
  not real Instagram Insights data.

## Files in this folder

- `server.js` — the backend: searches via Tavily, builds the scoring
  prompt, calls Groq, parses the result.
- `public/index.html` — the frontend UI (segments, weight sliders, ranked
  cards). No build step — plain HTML/CSS/JS.
- `config.example.json` → copy to `config.json` and fill in your keys (for
  local runs only — hosted deploys use the `GROQ_API_KEY` /
  `TAVILY_API_KEY` environment variables instead).
- `render.yaml` — deployment config Render reads automatically.
