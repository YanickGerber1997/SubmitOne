-- ============================================================
-- SubmitOne – Supabase Einrichtung
-- Supabase → SQL Editor → diesen Code einfügen → "Run"
-- ============================================================

-- 1) Tabelle für alle App-Daten (eine Zeile pro Projekt + je eine für Kontakte/Dokumente)
create table if not exists public.entities (
  id          text primary key,
  typ         text not null,            -- 'projekt' | 'kontakte' | 'dokumente'
  data        jsonb not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- 2) Zugriffsschutz: nur angemeldete Nutzer (gemeinsamer Team-Arbeitsbereich)
alter table public.entities enable row level security;

drop policy if exists "auth read"   on public.entities;
drop policy if exists "auth insert" on public.entities;
drop policy if exists "auth update" on public.entities;
drop policy if exists "auth delete" on public.entities;

create policy "auth read"   on public.entities for select using (auth.role() = 'authenticated');
create policy "auth insert" on public.entities for insert with check (auth.role() = 'authenticated');
create policy "auth update" on public.entities for update using (auth.role() = 'authenticated');
create policy "auth delete" on public.entities for delete using (auth.role() = 'authenticated');

-- 3) Live-Synchronisation (Realtime) für die Tabelle aktivieren
alter publication supabase_realtime add table public.entities;

-- Fertig. Danach in Supabase unter Authentication > Users einen Benutzer anlegen
-- (oder über die Login-Maske "Neues Konto erstellen").
