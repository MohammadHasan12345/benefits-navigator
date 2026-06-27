// Benefits Navigator — Vercel serverless function
// Reimplements the 3-agent pipeline (intake -> research -> eligibility) using the
// Gemini REST API directly (no heavy google-adk) and reads programs from Supabase.

const CATEGORIES = ["food", "housing", "healthcare", "utilities", "childcare", "legal", "employment"];

const STATE_NAMES = {
  AL:"Alabama",AK:"Alaska",AZ:"Arizona",AR:"Arkansas",CA:"California",CO:"Colorado",CT:"Connecticut",DE:"Delaware",
  DC:"District of Columbia",FL:"Florida",GA:"Georgia",HI:"Hawaii",ID:"Idaho",IL:"Illinois",IN:"Indiana",IA:"Iowa",
  KS:"Kansas",KY:"Kentucky",LA:"Louisiana",ME:"Maine",MD:"Maryland",MA:"Massachusetts",MI:"Michigan",MN:"Minnesota",
  MS:"Mississippi",MO:"Missouri",MT:"Montana",NE:"Nebraska",NV:"Nevada",NH:"New Hampshire",NJ:"New Jersey",
  NM:"New Mexico",NY:"New York",NC:"North Carolina",ND:"North Dakota",OH:"Ohio",OK:"Oklahoma",OR:"Oregon",
  PA:"Pennsylvania",RI:"Rhode Island",SC:"South Carolina",SD:"South Dakota",TN:"Tennessee",TX:"Texas",UT:"Utah",
  VT:"Vermont",VA:"Virginia",WA:"Washington",WV:"West Virginia",WI:"Wisconsin",WY:"Wyoming"
};

// These safety-net programs are FEDERAL but run by each state. The `find` URL is the
// official federal "find help in your state" directory — it works for all 50 states.
const PROGRAM_TYPES = [
  { category:"food", name:"SNAP (Food Assistance)", description:"Monthly money on an EBT card to help buy groceries.", documents:["Photo ID","Proof of residence","Proof of income or unemployment"], find:"https://www.fns.usda.gov/snap/state-directory" },
  { category:"food", name:"WIC (Women, Infants & Children)", description:"Healthy food, formula and nutrition support for pregnant people, new parents and children under 5.", documents:["Photo ID","Proof of residence","Proof of income","Pregnancy or medical documentation if available"], find:"https://www.signupwic.com/" },
  { category:"healthcare", name:"Medicaid / CHIP", description:"Free or low-cost health insurance for people and children with low income.", documents:["Photo ID","Proof of residence","Proof of income","Social Security number if available"], find:"https://www.medicaid.gov/about-us/where-can-people-get-help-medicaid-chip/index.html" },
  { category:"utilities", name:"LIHEAP (Energy Bill Help)", description:"Help paying heating, cooling and utility bills.", documents:["Photo ID","Proof of residence","Proof of income","Recent utility bill"], find:"https://www.acf.gov/ocs/map/liheap-map-state-and-territory-contact-listing" },
  { category:"housing", name:"Housing & Rental Assistance", description:"Rental help, eviction prevention and housing vouchers for people facing hardship.", documents:["Photo ID","Proof of residence","Lease agreement","Proof of income","Eviction notice if applicable"], find:"https://www.hud.gov/states" },
  { category:"childcare", name:"Child Care Assistance (CCDF)", description:"Help paying for child care so parents can work, train or go to school.", documents:["Photo ID","Proof of residence","Proof of income","Proof of work, training or school","Child's birth certificate"], find:"https://childcare.gov/state-resources" },
  { category:"legal", name:"Free Legal Aid", description:"Free civil legal help with housing, family, immigration and more for people with low income.", documents:["Photo ID","A short description of your legal issue"], find:"https://www.lawhelp.org/" },
  { category:"employment", name:"Unemployment Insurance", description:"Weekly payments if you lost your job through no fault of your own.", documents:["Social Security number","Work history for the past 18 months","Bank info for direct deposit"], find:"https://www.careeronestop.org/LocalHelp/UnemploymentBenefits/find-unemployment-benefits.aspx" }
];

// One-stop state benefits portals (apply for several programs in one place). Verified.
const STATE_PORTALS = {
  NJ:"https://www.mynjhelps.gov/", CA:"https://benefitscal.com/", TX:"https://www.yourtexasbenefits.com/",
  NY:"https://mybenefits.ny.gov/", PA:"https://www.compass.dhs.pa.gov/home/", IL:"https://abe.illinois.gov/",
  GA:"https://gateway.ga.gov/"
};

// Curated per-program deep links for flagship states (most accurate). Other states
// fall back to the federal `find` directory above.
const STATE_PROGRAM_LINKS = {
  NJ:{
    "SNAP (Food Assistance)":"https://www.nj.gov/humanservices/njsnap/",
    "WIC (Women, Infants & Children)":"https://www.nj.gov/health/fhs/wic/",
    "Medicaid / CHIP":"https://www.njfamilycare.org/",
    "LIHEAP (Energy Bill Help)":"https://dcaid.dca.nj.gov/en-US/",
    "Housing & Rental Assistance":"https://nj211.org/housing-assistance-for-renters",
    "Child Care Assistance (CCDF)":"https://www.childcarenj.gov/",
    "Free Legal Aid":"https://www.lsnj.org/",
    "Unemployment Insurance":"https://www.nj.gov/labor/myunemployment/"
  }
};

function resolveLink(state, prog) {
  return (STATE_PROGRAM_LINKS[state] && STATE_PROGRAM_LINKS[state][prog.name]) || prog.find;
}

// Build the program list for a given state + the categories the user needs.
function buildPrograms(state, categories) {
  const wanted = categories.length ? PROGRAM_TYPES.filter(p => categories.includes(p.category)) : PROGRAM_TYPES;
  const list = wanted.length ? wanted : PROGRAM_TYPES;
  return list.map(p => ({
    name: p.name, category: p.category, description: p.description,
    documents: p.documents, apply_link: resolveLink(state, p)
  }));
}

async function gemini(key, prompt, asJson) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const body = { contents: [{ role: "user", parts: [{ text: prompt }]}] };
  if (asJson) body.generationConfig = { responseMimeType: "application/json" };
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const data = await r.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
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
  const state = STATE_NAMES[(body.state || "NJ").toUpperCase()] ? (body.state || "NJ").toUpperCase() : "NJ";
  const stateNm = STATE_NAMES[state];
  const portal = STATE_PORTALS[state];

  if (!msg) { res.status(400).json({ error: "Please enter a message." }); return; }
  if (!key) {
    res.status(500).json({ error: "The server is missing its GEMINI_API_KEY. Add it in Vercel → Settings → Environment Variables." });
    return;
  }

  try {
    await logMessage(sid, "user", msg);

    // 1) INTAKE — understand the situation, pick categories
    const intakePrompt =
`You are a compassionate intake assistant for U.S. assistance programs.
From the user's message, decide which help categories apply.
Valid categories: ${CATEGORIES.join(", ")}.
User message: """${msg}"""
Return ONLY JSON: {"categories": string[], "summary": string, "circumstances": string}`;

    let profile = { categories: [], summary: msg, circumstances: "" };
    try { profile = JSON.parse(await gemini(key, intakePrompt, true)); } catch (_) {}
    const cats = (profile.categories || []).filter(c => CATEGORIES.includes(c));

    // 2) RESEARCH — resolve programs + the correct apply links for THIS state
    const programs = buildPrograms(state, cats);

    // 3) ELIGIBILITY — talk like a real caseworker, grounded ONLY in the programs we found
    const eligPrompt =
`You are Benefits Navigator — a warm, human caseworker for ${stateNm}, NOT a generic chatbot.
You speak with genuine empathy and you ONLY recommend the real programs listed below. Never invent programs.

The person lives in: ${stateNm}
The person said: """${msg}"""
What we understand about them: ${JSON.stringify(profile)}
Programs available in ${stateNm} to consider (JSON): ${JSON.stringify(programs)}
${portal ? `${stateNm}'s one-stop online benefits portal (mention it in your closing as the easiest place to start): ${portal}` : ""}

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
How to apply: <1 short sentence on how to apply in ${stateNm}>
Where: <where/how to get it in ${stateNm}, e.g. "Apply online or at your local county social services office — available across ${stateNm}">
Link: <apply_link>

   Use "⚠️ MIGHT QUALIFY" if more info is needed, or "❌ PROBABLY NOT" (list those last).
4. After the last program's ---, close with 1-2 encouraging sentences AND one friendly follow-up
   question to keep helping (e.g. "Would you like me to walk you through gathering the documents for any of these?").
5. Final line, EXACTLY: "This is not legal or financial advice. Please contact each program directly to confirm eligibility."

RULES: Never say "you qualify" — say "you may qualify" / "you're likely eligible". No legal or medical advice.
For the "Link:" line, copy the program's apply_link EXACTLY as given — never invent, shorten, guess, or modify a URL.
Tailor wording to ${stateNm}. Be warm, personal and conversational. Use "you", contractions, and real empathy. No markdown asterisks.`;

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
