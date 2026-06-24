# Benefits Navigator 🧭

An AI assistant that helps **New Jersey** residents discover assistance programs they may
qualify for — described in plain language, returned as a clear, step-by-step action checklist.
No jargon, no judgment, no SSN required.

> _This is not legal or financial advice. Always confirm eligibility with each program directly._

---

## Two ways it runs

| | Stack | Use |
|---|---|---|
| **Web (Vercel)** | Static UI + Vercel serverless function (`/api/chat`) calling the **Gemini REST API**, programs stored in **Supabase** | The live website |
| **CLI / local (Python)** | Google ADK 3-agent pipeline (`main.py`) | The original reference implementation |

The web version reimplements the same **intake → research → eligibility** pipeline without the
heavy `google-adk` dependency, so it fits Vercel's serverless limits.

```
public/index.html   animated single-page UI (no build step)
api/chat.js          serverless fn: Gemini pipeline + Supabase
supabase/schema.sql  tables + seed data for Supabase
main.py / agents/    Python ADK reference (not deployed)
```

---

## Deploy to Vercel + Supabase

### 1. Supabase (database)
1. Create a project at [supabase.com](https://supabase.com).
2. **SQL Editor → New query**, paste [`supabase/schema.sql`](supabase/schema.sql), **Run**.
   (Creates `programs` + `messages` and seeds the NJ programs.)
3. **Project Settings → API**: copy the **Project URL** and the **anon public** key.

### 2. Vercel (frontend + function)
1. Push this repo to GitHub (already done if you're reading this on GitHub).
2. [vercel.com](https://vercel.com) → **Add New → Project → Import** this repo.
3. Add **Environment Variables**:
   | Name | Value |
   |---|---|
   | `GEMINI_API_KEY` | your Google Gemini API key |
   | `SUPABASE_URL` | the Supabase Project URL |
   | `SUPABASE_ANON_KEY` | the Supabase anon public key |
4. **Deploy.** Your site is live. 🎉

> If you skip Supabase, the app still works — it falls back to a bundled copy of the programs.
> You only need `GEMINI_API_KEY` for the chat to respond.

---

## Run locally (Python ADK version)

```bash
pip install -r requirements.txt   # or: google-adk python-dotenv fastapi uvicorn
echo "GOOGLE_API_KEY=..." > .env
python web.py                      # http://127.0.0.1:8000
# or the terminal version:
python main.py
```
