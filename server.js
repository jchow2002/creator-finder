// Creator Finder — standalone server
//
// The browser never talks to any AI provider directly — it only talks to
// this server, and this server talks out to two free services: Tavily for
// web search, and Groq for the actual scoring. Neither requires a linked
// billing account for their free tier (unlike Gemini's Google Search
// grounding, which returned HTTP 429 on every call on a fresh account with
// no billing attached — that's why this isn't calling Gemini anymore).
//
// Get free keys at https://console.groq.com/keys and https://app.tavily.com
//
// No separate local process to run, so this deploys cleanly to a free host
// like Render or Railway — see README.

const express = require("express");
const path = require("path");
const fs = require("fs");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

// ---------------------------------------------------------------------------
// Config — GROQ_API_KEY / TAVILY_API_KEY env vars take priority (what a
// hosted deploy uses, set in the host's dashboard). Falls back to
// config.json for local runs (created from config.example.json, gitignored
// — never commit it).
// ---------------------------------------------------------------------------
const CONFIG_PATH = path.join(__dirname, "config.json");
function loadConfig() {
  if (process.env.GROQ_API_KEY && process.env.TAVILY_API_KEY) {
    return {
      groqApiKey: process.env.GROQ_API_KEY,
      tavilyApiKey: process.env.TAVILY_API_KEY,
      model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    };
  }
  if (!fs.existsSync(CONFIG_PATH)) {
    throw new Error(
      "No API keys found. Either set GROQ_API_KEY and TAVILY_API_KEY environment variables, or copy config.example.json to config.json and fill it in (see README.md)."
    );
  }
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  if (!cfg.groqApiKey || cfg.groqApiKey.startsWith("PASTE_")) {
    throw new Error("config.json is missing a real groqApiKey. Get a free key at https://console.groq.com/keys (see README.md).");
  }
  if (!cfg.tavilyApiKey || cfg.tavilyApiKey.startsWith("PASTE_")) {
    throw new Error("config.json is missing a real tavilyApiKey. Get a free key at https://app.tavily.com (see README.md).");
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
rationale <=22 words. hook = one specific outreach angle <=16 words. source = a URL from the SEARCH RESULTS below if used, else "". confidence one of "high","med","low" (low if inferring rather than grounded in a search result). Never invent handles, follower counts, or facts not present in the search results or the input.`;

// ---------------------------------------------------------------------------
// Search step — Tavily is a standalone REST search API built for feeding
// LLMs, no billing account required for its free tier.
// https://docs.tavily.com/documentation/api-reference/endpoint/search
// ---------------------------------------------------------------------------
async function tavilySearch(cfg, query) {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.tavilyApiKey}`,
      },
      body: JSON.stringify({ query, search_depth: "basic", max_results: 10 }),
    });
    if (!res.ok) {
      console.warn(`[search] "${query}" failed: HTTP ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data.results || []).map((r) => ({
      title: r.title || "",
      snippet: r.content || "",
      url: r.url || "",
    }));
  } catch (e) {
    console.warn(`[search] "${query}" errored:`, e.message);
    return [];
  }
}

function formatResults(allResults) {
  if (!allResults.length) return "(no search results retrieved — score conservatively, mark confidence 'low')";
  return allResults
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nURL: ${r.url}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Chat completion step — Groq's OpenAI-compatible endpoint. Its free tier
// doesn't require a linked billing account either.
//
// requestsThisSession is a rough, in-memory counter only — neither provider
// exposes real remaining-quota data over the API, so this is NOT the same
// as your actual free-tier usage (check that at
// https://console.groq.com/settings/limits and your Tavily dashboard). It
// resets to 0 on every restart/redeploy, which on a free Render plan can
// happen whenever the service spins down from inactivity. Don't present it
// to the user as authoritative.
// ---------------------------------------------------------------------------
let requestsThisSession = 0;

async function groqChat(cfg, prompt) {
  const model = cfg.model || "llama-3.3-70b-versatile";
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.groqApiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Groq call failed: HTTP ${res.status} ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";
  const finishReason = data.choices?.[0]?.finish_reason;
  requestsThisSession++;
  return { text, truncated: finishReason === "length", model };
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

// Lets the frontend show which model is configured before any search runs.
// requestsThisSession is a rough local tally, not real provider quota — see
// the comment above groqChat().
app.get("/api/status", (req, res) => {
  try {
    const cfg = loadConfig();
    res.json({ model: cfg.model || "llama-3.3-70b-versatile", requestsThisSession });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/discover", async (req, res) => {
  try {
    const cfg = loadConfig();
    const { segments = [], city = "New York City", tierNote = "" } = req.body;
    if (!segments.length) return res.status(400).json({ error: "Pick at least one segment." });

    const queries = segments.map((s) => `${s} creator ${city} instagram`);
    const searchBatches = await Promise.all(queries.map((q) => tavilySearch(cfg, q)));
    const allResults = searchBatches.flat();

    const prompt = `You are a B2B prospecting analyst for an eco-friendly RESIDENTIAL cleaning startup in ${city}. It seeds creators with a free clean in exchange for a post. The real target is the CUSTOMER — affluent, time-poor ${city} professionals — so a creator is only valuable if their audience is that customer. From the SEARCH RESULTS below, identify up to 4 REAL creators across these segments: ${segments.join(", ")}. ${tierNote} Do not gate on follower count; a small creator with a dense local audience can outrank a big one. Only use creators actually present in the search results — do not invent any.

SEARCH RESULTS:
${formatResults(allResults)}

${SCHEMA_INSTRUCTIONS}`;

    const { text, truncated, model } = await groqChat(cfg, prompt);
    const parsed = extractJSON(text);
    res.json({ results: parsed, truncated, model, requestsThisSession, searchHits: allResults.length });
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
    const searchBatches = await Promise.all(lines.map((l) => tavilySearch(cfg, `${l} instagram ${city}`)));
    const allResults = searchBatches.flat();

    const prompt = `You are a B2B prospecting analyst for an eco-friendly RESIDENTIAL cleaning startup in ${city}. Assess each creator below as a free-clean-for-post partner, using the SEARCH RESULTS to verify where possible. If a creator isn't covered by the results, score from the input text alone and mark confidence "low".

CREATORS:
${lines.join("\n")}

SEARCH RESULTS:
${formatResults(allResults)}

${SCHEMA_INSTRUCTIONS}`;

    const { text, truncated, model } = await groqChat(cfg, prompt);
    const parsed = extractJSON(text);
    res.json({ results: parsed, truncated, model, requestsThisSession, searchHits: allResults.length });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Creator Finder running at http://localhost:${PORT}`);
});
