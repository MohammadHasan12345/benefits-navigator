-- Benefits Navigator — Supabase schema + seed data
-- Run this in the Supabase dashboard: SQL Editor → New query → paste → Run.

-- ---------- programs (read by /api/chat) ----------
create table if not exists programs (
  id          bigint generated always as identity primary key,
  name        text not null,
  category    text not null,
  description text,
  eligibility text,
  documents   jsonb,
  apply_link  text
);

alter table programs enable row level security;

drop policy if exists "public read programs" on programs;
create policy "public read programs"
  on programs for select
  to anon
  using (true);

-- ---------- messages (conversation log, written by /api/chat) ----------
create table if not exists messages (
  id         bigint generated always as identity primary key,
  session_id text,
  role       text,
  content    text,
  created_at timestamptz default now()
);

alter table messages enable row level security;

drop policy if exists "public insert messages" on messages;
create policy "public insert messages"
  on messages for insert
  to anon
  with check (true);

-- ---------- seed: NJ assistance programs ----------
insert into programs (name, category, description, eligibility, documents, apply_link) values
('NJ SNAP (Food Stamps)', 'food', 'Monthly food assistance benefits loaded onto an EBT card', 'NJ residents with low income, any immigration status may apply', '["Photo ID","Proof of NJ residence","Proof of income or unemployment"]', 'https://www.nj.gov/humanservices/njsnap/'),
('NJ WIC Program', 'food', 'Food, nutrition counseling for pregnant women, new mothers, and children under 5', 'Pregnant, postpartum, or breastfeeding women; infants and children under 5 with low income', '["Proof of identity","Proof of NJ residence","Proof of income","Medical documentation if available"]', 'https://www.nj.gov/health/fhs/wic/'),
('NJ FamilyCare (Medicaid)', 'healthcare', 'Free or low cost health insurance for NJ residents', 'NJ residents who meet income limits, includes children, parents, pregnant women', '["Proof of identity","Proof of NJ residence","Proof of income","Social Security number if available"]', 'https://www.njfamilycare.org/'),
('LIHEAP (Utility Assistance)', 'utilities', 'Help paying heating and cooling energy bills', 'NJ residents with low income who pay energy bills', '["Photo ID","Proof of NJ residence","Proof of income","Recent utility bill"]', 'https://dcaid.dca.nj.gov/en-US/'),
('NJ Rental / Housing Assistance', 'housing', 'Rental help and eviction-prevention assistance for NJ residents facing hardship', 'NJ renters experiencing financial hardship', '["Photo ID","Proof of NJ residence","Lease agreement","Proof of income","Eviction notice if applicable"]', 'https://nj211.org/housing-assistance-for-renters'),
('NJ Child Care Assistance (CCAP)', 'childcare', 'Subsidized childcare for working low income families', 'Working or in school NJ parents with children under 13 with low income', '["Proof of identity","Proof of NJ residence","Proof of income","Proof of employment or school enrollment","Child birth certificate"]', 'https://www.childcarenj.gov/'),
('NJ Legal Services', 'legal', 'Free civil legal help for low income NJ residents including immigration issues', 'Low income NJ residents needing civil legal assistance', '["Photo ID","Description of legal issue"]', 'https://www.lsnj.org/'),
('NJ Unemployment Insurance', 'employment', 'Weekly payments if you lost your job through no fault of your own', 'NJ workers who lost jobs involuntarily and meet wage requirements', '["Social Security number","Work history for past 18 months","Banking info for direct deposit"]', 'https://www.nj.gov/labor/myunemployment/');
