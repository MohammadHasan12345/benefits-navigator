// Benefits Navigator — Vercel serverless function
// Reimplements the 3-agent pipeline (intake -> research -> eligibility) using the
// Gemini REST API directly (no heavy google-adk) and reads programs from Supabase.

const CATEGORIES = ["food", "housing", "healthcare", "utilities", "childcare", "legal", "employment"];

// Bundled copy of the NJ programs. Used as a graceful fallback when Supabase
// isn't configured yet, so the site works the moment GEMINI_API_KEY is set.
const FALLBACK_PROGRAMS = [
  { name: "NJ SNAP (Food Stamps)", category: "food", description: "Monthly food assistance benefits loaded onto an EBT card", eligibility: "NJ residents with low income, any immigration status may apply", documents: ["Photo ID", "Proof of NJ residence", "Proof of income or unemployment"], apply_link: "https://www.nj.gov/humanservices/dfd/programs/snap/" },
  { name: "NJ WIC Program", category: "food", description: "Food, nutrition counseling for pregnant women, new mothers, and children under 5", eligibility: "Pregnant, postpartum, or breastfeeding women; infants and children under 5 with low income", documents: ["Proof of identity", "Proof of NJ residence", "Proof of income", "Medical documentation if available"], apply_link: "https://www.nj.gov/health/fhs/wic/" },
  { name: "NJ FamilyCare (Medicaid)", category: "healthcare", description: "Free or low cost health insurance for NJ residents", eligibility: "NJ residents who meet income limits, includes children, parents, pregnant women", documents: ["Proof of identity", "Proof of NJ residence", "Proof of income", "Social Security number if available"], apply_link: "https://www.nj.gov/humanservices/dmahs/clients/medicaid/" },
  { name: "LIHEAP (Utility Assistance)", category: "utilities", description: "Help paying heating and cooling energy bills", eligibility: "NJ residents with low income who pay energy bills", documents: ["Photo ID", "Proof of NJ residence", "Proof of income", "Recent utility bill"], apply_link: "https://www.nj.gov/dca/divisions/dhcr/offices/hea.html" },
  { name: "NJ Rental Assistance (DCA)", category: "housing", description: "Emergency rental assistance for NJ residents at risk of eviction", eligibility: "NJ renters experiencing financial hardship", documents: ["Photo ID", "Proof of NJ residence", "Lease agreement", "Proof of income", "Eviction notice if applicable"], apply_link: "https://www.nj.gov/dca/divisions/dhcr/offices/era.html" },
  { name: "NJ Child Care Assistance (CCAP)", category: "childcare", description: "Subsidized childcare for working low income families", eligibility: "Working or in school NJ parents with children under 13 with low income", documents: ["Proof of identity", "Proof of NJ residence", "Proof of income", "Proof of employment or school enrollment", "Child birth certificate"], apply_link: "https://www.nj.gov/humanservices/dfd/programs/cc/" },
  { name: "NJ Legal Services", category: "legal", description: "Free civil legal help for low income NJ residents including immigration issues", eligibility: "Low income NJ residents needing civil legal assistance", documents: ["Photo ID", "Description of legal issue"], apply_link: "https://www.lsnj.org/" },
  { name: "NJ Unemployment Insurance", category: "employment", description: "Weekly payments if you lost your job through no fault of your own", eligibility: "NJ workers who lost jobs involuntarily and meet wage requirements", documents: ["Social Security number", "Work history for past 18 months", "Banking info for direct deposit"], apply_link: "https://myunemployment.nj.gov/" }
];

async function gemini(key, prompt, asJson) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }]}] };
  if (asJson) body.generationConfig = { responseMimeType: "application/json" };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function getPrograms(categories) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (url && key) {
    try {
      let q = `${url}/rest/v1/programs?select=*`;
      if (categories.length) q += `&category=in.(${categories.map(encodeURIComponent).join(",")})`;
      const r = await fetch(q, { headers: { apikey: key, Authorization: `Bearer ${key}` }});
      if (r.ok) {
        const rows = await r.json();
        if (Array.isArray(rows) && rows.length) return rows;
      }
    } catch (_) { /* fall through to bundled data */ }
  }
  if (categories.length) {
    const hits = FALLBACK_PROGRAMS.filter(p => categories.includes(p.category));
    if (hits.length) return hits;
  }
  return FALLBACK_PROGRAMS;
}

async function logMessage(session_id, role, content) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    await fetch(`${url}/rest/v1/messages`, {
      method: "POST",
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify({ session_id, role, content })
    });
  } catch (_) { /* logging is best-effort */ }
}

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  const body = typeof req.body === "string" ? safeParse(req.body) : (req.body || {});
  const msg = (body.message || "").trim();
  const sid = body.session_id || Math.random().toString(36).slice(2);

  if (!msg) { res.status(400).json({ error: "Please enter a message." }); return; }
  if (!key) {
    res.status(500).json({ error: "The server is missing its GEMINI_API_KEY. Add it in Vercel → Settings → Environment Variables." });
    return;
  }

  try {
    await logMessage(sid, "user", msg);

    // 1) INTAKE — understand the situation, pick categories
    const intakePrompt =
`You are a compassionate intake assistant for New Jersey assistance programs.
From the user's message, decide which help categories apply.
Valid categories: ${CATEGORIES.join(", ")}.
User message: """${msg}"""
Return ONLY JSON: {"categories": string[], "summary": string, "circumstances": string}`;

    let profile = { categories: [], summary: msg, circumstances: "" };
    try { profile = JSON.parse(await gemini(key, intakePrompt, true)); } catch (_) {}
    const cats = (profile.categories || []).filter(c => CATEGORIES.includes(c));

    // 2) RESEARCH — pull matching programs from Supabase (or bundled fallback)
    const programs = await getPrograms(cats);

    // 3) ELIGIBILITY — talk like a real caseworker, grounded ONLY in the NJ programs we found
    const eligPrompt =
`You are Benefits Navigator — a warm, human New Jersey caseworker, NOT a generic chatbot.
You speak with genuine empathy and you ONLY recommend the real NJ programs listed below. Never invent programs.

The person said: """${msg}"""
What we understand about them: ${JSON.stringify(profile)}
Real NJ programs to consider (JSON): ${JSON.stringify(programs)}

Reply in EXACTLY this structure:

1. Open with 1-2 warm, human sentences that acknowledge their SPECIFIC situation and reassure them
   (e.g. "I'm really sorry you're going through this — losing a job is so stressful, and you're not alone.").
   Sound like a caring person, not a form.
2. Then a line containing only: ---
3. Then, for EACH relevant program, a block followed by a line containing only --- :

✅ LIKELY ELIGIBLE
<Program Name>
Overview: <1 plain-language sentence on what this program actually gives them>
Why: <1 sentence connecting it to THEIR specific situation>
Documents needed: <comma-separated list>
How to apply: <1 short sentence>
Where: <where/how to get it, e.g. "Apply online, or in person at your county welfare/social services office — available statewide in New Jersey">
Link: <apply_link>

   Use "⚠️ MIGHT QUALIFY" if more info is needed, or "❌ PROBABLY NOT" (list those last).
4. After the last program's ---, close with 1-2 encouraging sentences AND one friendly follow-up
   question to keep helping (e.g. "Would you like me to walk you through gathering the documents for any of these?").
5. Final line, EXACTLY: "This is not legal or financial advice. Please contact each program directly to confirm eligibility."

RULES: Never say "you qualify" — say "you may qualify" / "you're likely eligible". No legal or medical advice.
Be warm, personal and conversational. Use "you", contractions, and real empathy. No markdown asterisks.`;

    const reply = await gemini(key, eligPrompt, false);
    await logMessage(sid, "assistant", reply);

    res.status(200).json({ session_id: sid, reply });
  } catch (e) {
    res.status(500).json({
      session_id: sid,
      error: "The navigator hit a snag reaching the model. Please check the GEMINI_API_KEY / quota and try again.",
      detail: String(e)
    });
  }
};

function safeParse(s) { try { return JSON.parse(s); } catch { return {}; } }
