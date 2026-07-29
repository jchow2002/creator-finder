# Creator Finder

Finds and ranks Instagram creators worth seeding with a free clean, in
exchange for a post. Powered by Google's Gemini API — it has a free tier,
and it can search the web itself (no separate search service needed). No
Anthropic key, no monthly cost, as long as you stay within Gemini's free
quota.

You can run this two ways: **on your own computer**, or **hosted for free**
so you (or a teammate) can just open a link in any browser. Hosting is the
easier one to hand off to someone non-technical — pick that if you're not
sure.

## Option A — Host it for free (recommended)

This gives you a real URL, no terminal required after setup.

**1. Get a free Gemini API key.**
Go to https://aistudio.google.com/apikey, sign in with a Google account,
and create an API key. Copy it somewhere safe — you'll paste it once into
the hosting dashboard, never into any file you commit to GitHub.

**2. Put this project on GitHub.**
If it isn't already, create a new (private is fine) GitHub repository and
push this folder to it.

**3. Deploy on Render** (or Railway — steps are nearly identical).
- Go to https://render.com and sign up (free, no card required for this).
- **New +** → **Web Service** → connect your GitHub repo.
- Render should auto-detect the settings from `render.yaml` in this repo
  (build command `npm install`, start command `npm start`). If it doesn't
  auto-detect, set those manually.
- Under **Environment**, add a variable: `GEMINI_API_KEY` = the key from
  step 1.
- Click **Create Web Service**. Render gives you a URL like
  `https://creator-finder.onrender.com` — that's the link you share.

That's it — no local install, no second process to keep running. The free
Render plan spins the service down after inactivity, so the very first
request after a quiet period takes ~30-60 seconds to wake back up; that's
normal, not a bug.

## Option B — Run it on your own computer

**1. Install Node.js** (if you don't have it): https://nodejs.org — get the
"LTS" version.

**2. Get a free Gemini API key**, same as step 1 above:
https://aistudio.google.com/apikey

**3. Install this app's dependencies** (in a terminal, in this folder):
```bash
npm install
```

**4. Set up your config:**
```bash
cp config.example.json config.json
```
Open `config.json` and paste your API key into `geminiApiKey`.

**5. Run it:**
```bash
npm start
```
Open `http://localhost:3000` in your browser.

`config.json` holds a real secret — it's already excluded from git via
`.gitignore`, so it's safe to leave in this folder. Never paste your key
directly into `public/index.html` or any file you commit.

## What to expect honestly

- **Quality is good but not Claude-level.** Gemini's free tier is solid for
  this kind of task, but expect occasional messy output or a run that
  needs a retry.
- **The free tier has real limits.** Search-grounded requests are capped
  at roughly 5,000/month shared across Gemini's current models (Google
  changes this from time to time — check
  https://ai.google.dev/gemini-api/docs/pricing if something stops
  working). For a tool one person uses to prospect a handful of creators
  at a time, that's generous headroom.
- **This is still a seed list, not verified audience data.** The "local
  audience" score is the model's estimate from what it finds via search,
  not real Instagram Insights data.

## Files in this folder

- `server.js` — the backend: calls the Gemini API with Google Search
  grounding turned on, so search and scoring happen in one request.
- `public/index.html` — the frontend UI (segments, weight sliders, ranked
  cards). No build step — plain HTML/CSS/JS.
- `config.example.json` → copy to `config.json` and fill in your key (for
  local runs only — hosted deploys use the `GEMINI_API_KEY` environment
  variable instead).
- `render.yaml` — deployment config Render reads automatically.
