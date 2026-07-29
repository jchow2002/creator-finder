// Creator Finder — standalone server
//
// The browser never talks to any AI provider directly — it only talks to
// this server, and this server talks to the Gemini API. Uses Gemini's
// built-in Google Search grounding tool, so search and scoring happen in a
// single call instead of two separate ones. Free tier: 5,000 grounded
// prompts/month shared across Gemini 3 models (see
// https://ai.google.dev/gemini-api/docs/pricing), plenty for this app's
// usage. Get a free key at https://aistudio.google.com/apikey.
//
// No separate local process to run (unlike the old OmniRoute setup), so
// this deploys cleanly to a free host like Render or Railway — see README.

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Config — GEMINI_API_KEY env var takes priority (what a hosted deploy
// uses, set in the host's dashboard). Falls back to config.json for local
// runs (created from config.example.json, gitignored — never commit it).
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, "config.json");
function loadConfig() {
  if (process.env.GEMINI_API_KEY) {
    return { geminiApiKey: process.env.GEMINI_API_KEY, model: process.env.GEMINI_MODEL || "gemini-flash-latest" };
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      "No Gemini API key found. Either set the GEMINI_API_KEY environment variable, or copy config.example.json to config.json and fill it in (see README.md)."
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.geminiApiKey || cfg.geminiApiKey.startsWith("PASTE_")) {
    throw new Error("config.json is missing a real geminiApiKey. Get a free key at https://aistudio.google.com/apikey (see README.md).");
  }
  return cfg;
}

const DIM_KEYS = ["local", "income", "native", "engagement", "activation", "eco"];

const SCHEMA_INSTRUCTIONS = `Return ONLY a JSON array (no prose, no markdown, no explanation before or after). Each creator:
{"name":"","handle":"","platform":"","followers":"","tier":"","segment":"","scores":{"local":0,"income":0,"native":0,"engagement":0,"activation":0,"eco":0},"rationale":"","hook":"","source":"","confidence":""}
Each score is 0-100 for an eco-friendly RESIDENTIAL cleaning startup:
- local: share of audience in the target city / servable area (follower count matters only as it multiplies this)
- income: audience resembles affluent professionals who'd pay for premium cleaning
- native: they show their home/apartment; a clean-home post would fit their feed
- engagement: genuine engagement rate and comment authenticity (not follower count)
- activation: is a free clean a big enough incentive that they'll actually post well (large/macro creators score LOW here — a free clean is trivial to them)
- eco: sustainability/wellness leaning that amplifies an eco-cleaning brand
tier one of "Nano","Micro","Mid","Macro". segment = best-fit label.
rationale <=22 words. hook = one specific outreach angle <=16 words. source = a real URL you found via search that supports this creator's inclusion, else "". confidence one of "high","med","low" (low if inferring rather than grounded in an actual search result). Use your search tool to verify before answering. Never invent handles, follower counts, or facts you didn't actually find.`;

// ---------------------------------------------------------------------------
// Single call to Gemini with Google Search grounding turned on — the model
// runs its own searches and writes the answer in one round trip, so there's
// no separate search step to orchestrate here.
// https://ai.google.dev/gemini-api/docs/google-search
// ---------------------------------------------------------------------------
async function geminiGroundedCall(cfg, prompt) {
  const model = cfg.model || "gemini-flash-latest";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/interactions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": cfg.geminiApiKey,
    },
    body: JSON.stringify({
      model,
      input: prompt,
      tools: [{ type: "google_search" }],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Gemini call failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const steps = data.steps || [];
  const outputStep = [...steps].reverse().find((s) => s.type === "model_output");
  const text = (outputStep?.content || [])
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("");
  const searchedAtAll = steps.some((s) => s.type === "google_search_call");
  return { text, truncated: data.status && data.status !== "completed", searched: searchedAtAll };
}

// Salvage parser: pull complete {...} objects even if the array got cut off,
// or if the (often weaker) free model wrapped the JSON in extra prose.
function extractJSON(text) {
  let t = (text || "").trim().replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = t.indexOf("[");
  if (s !== -1) t = t.slice(s);
  try {
    const parsed = JSON.parse(t);
    if (Array.isArray(parsed)) return parsed;
  } catch (_) {}
  const objs = [];
  let depth = 0, start = -1, inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === "{") { if (depth === 0) start = i; depth++; }
    else if (ch === "}") {
      depth--;
      if (depth === 0 && start !== -1) {
        try { objs.push(JSON.parse(t.slice(start, i + 1))); } catch (_) {}
        start = -1;
      }
    }
  }
  return objs;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.post("/api/discover", async (req, res) => {
  try {
    const cfg = loadConfig();
    const { segments = [], city = "New York City", tierNote = "" } = req.body;
    if (!segments.length) return res.status(400).json({ error: "Pick at least one segment." });

    const prompt = `You are a B2B prospecting analyst for an eco-friendly RESIDENTIAL cleaning startup in ${city}. It seeds creators with a free clean in exchange for a post. The real target is the CUSTOMER — affluent, time-poor ${city} professionals — so a creator is only valuable if their audience is that customer. Search the web and identify up to 4 REAL creators active on Instagram across these segments: ${segments.join(", ")}. ${tierNote} Do not gate on follower count; a small creator with a dense local audience can outrank a big one. Only include creators you actually find via search — do not invent any.

${SCHEMA_INSTRUCTIONS}`;

    const { text, truncated } = await geminiGroundedCall(cfg, prompt);
    const parsed = extractJSON(text);
    res.json({ results: parsed, truncated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/score", async (req, res) => {
  try {
    const cfg = loadConfig();
    const { list = "", city = "New York City" } = req.body;
    if (!list.trim()) return res.status(400).json({ error: "Paste at least one creator." });

    const lines = list.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6);

    const prompt = `You are a B2B prospecting analyst for an eco-friendly RESIDENTIAL cleaning startup in ${city}. Assess each creator below as a free-clean-for-post partner. Search the web to verify each one where possible. If a creator isn't findable via search, score from the input text alone and mark confidence "low".

CREATORS:
${lines.join("\n")}

${SCHEMA_INSTRUCTIONS}`;

    const { text, truncated } = await geminiGroundedCall(cfg, prompt);
    const parsed = extractJSON(text);
    res.json({ results: parsed, truncated });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Creator Finder running at http://localhost:${PORT}`);
});
