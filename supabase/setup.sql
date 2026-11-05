-- TalkContext team sharing: run once in the SQL editor of your Supabase project.
-- Safe to re-run. Every object is prefixed with talkcontext_ so it can live next to an existing app.
--
-- Security model: the extension only ever holds the project URL and the anon (publishable) key.
-- Everything is enforced here: only signed-in users whose email domain is listed in
-- talkcontext_allowed_domains can read; everyone can only write and delete their own recordings.

-- 1. Who belongs to the team ---------------------------------------------------------------

create table if not exists public.talkcontext_allowed_domains (
  domain text primary key check (domain = lower(domain) and domain !~ '[@\s]')
);
alter table public.talkcontext_allowed_domains enable row level security;
-- No policies: the list is invisible through the API and only editable in the dashboard.

-- Empty list = nobody is a member. Add your domain(s) after running this script:
--   insert into public.talkcontext_allowed_domains (domain) values ('example.com');

create or replace function public.talkcontext_is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.talkcontext_allowed_domains d
    where d.domain = lower(split_part(auth.jwt() ->> 'email', '@', 2))
  )
$$;
revoke execute on function public.talkcontext_is_member() from public, anon;
grant execute on function public.talkcontext_is_member() to authenticated;

-- Auth hook "Before User Created": refuses sign-ups from other domains.
-- Enable it in Dashboard → Authentication → Hooks → Before User Created → Postgres → this function.
create or replace function public.talkcontext_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.talkcontext_allowed_domains d
    where d.domain = lower(split_part(event -> 'user' ->> 'email', '@', 2))
  ) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object('http_code', 403, 'message', 'This email address is not part of the team.')
  );
end
$$;
revoke execute on function public.talkcontext_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.talkcontext_before_user_created(jsonb) to supabase_auth_admin;

-- 2. Shared recordings ----------------------------------------------------------------------

create table if not exists public.talkcontext_recordings (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_email text not null default (auth.jwt() ->> 'email'),
  title text not null check (char_length(title) <= 300),
  url text not null check (char_length(url) <= 2000),
  environment text check (char_length(environment) <= 100),
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  feedback_count integer not null default 0 check (feedback_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  -- The handoff manifest; the files themselves live in the storage bucket under <owner_id>/<id>/.
  manifest jsonb not null default '{}'::jsonb,
  shared_at timestamptz not null default now()
);
create index if not exists talkcontext_recordings_shared_at on public.talkcontext_recordings (shared_at desc);

alter table public.talkcontext_recordings enable row level security;
revoke all on public.talkcontext_recordings from anon;
-- Newer projects no longer expose new tables to the API by default: grant explicitly, RLS below decides per row.
grant select, insert, update, delete on public.talkcontext_recordings to authenticated;

drop policy if exists "members read" on public.talkcontext_recordings;
create policy "members read" on public.talkcontext_recordings
  for select to authenticated
  using (public.talkcontext_is_member());

drop policy if exists "members share own" on public.talkcontext_recordings;
create policy "members share own" on public.talkcontext_recordings
  for insert to authenticated
  with check (
    public.talkcontext_is_member()
    and owner_id = auth.uid()
    and owner_email = auth.jwt() ->> 'email'
  );

drop policy if exists "owner edits" on public.talkcontext_recordings;
create policy "owner edits" on public.talkcontext_recordings
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and owner_email = auth.jwt() ->> 'email');

drop policy if exists "owner unshares" on public.talkcontext_recordings;
create policy "owner unshares" on public.talkcontext_recordings
  for delete to authenticated
  using (owner_id = auth.uid());

-- Live folder: other members see new and removed recordings without reloading.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'talkcontext_recordings'
  ) then
    alter publication supabase_realtime add table public.talkcontext_recordings;
  end if;
end
$$;

-- 3. Files (screenshots, DOM snippets, feedback.md, replay) ---------------------------------

insert into storage.buckets (id, name, public, file_size_limit)
values ('talkcontext', 'talkcontext', false, 104857600)  -- 100 MB per file
on conflict (id) do nothing;

drop policy if exists "talkcontext members read" on storage.objects;
create policy "talkcontext members read" on storage.objects
  for select to authenticated
  using (bucket_id = 'talkcontext' and public.talkcontext_is_member());

drop policy if exists "talkcontext upload own" on storage.objects;
create policy "talkcontext upload own" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'talkcontext'
    and public.talkcontext_is_member()
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "talkcontext replace own" on storage.objects;
create policy "talkcontext replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'talkcontext' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'talkcontext' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "talkcontext delete own" on storage.objects;
create policy "talkcontext delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'talkcontext' and (storage.foldername(name))[1] = auth.uid()::text);
