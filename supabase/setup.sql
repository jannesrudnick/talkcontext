-- TalkContext team sharing: run once in the SQL editor of your Supabase project.
-- Safe to re-run. Every object is prefixed with talkcontext_ so it can live next to an existing app.
--
-- Security model: the extension holds the project URL, the anon (publishable) key and a team key.
-- It signs in anonymously and calls talkcontext_join(team_key, name) once. Only that function can
-- see the stored key hashes; it makes the anonymous user a member. Every policy below checks
-- membership, so without a valid team key nothing is readable or writable. No email, no SMTP.
--
-- Dashboard: Authentication → Sign In / Providers → enable "Allow anonymous sign-ins".
-- Then create a key:  select public.talkcontext_new_team_key('team');  and share it with the team.

create extension if not exists pgcrypto with schema extensions;

-- 0. Upgrade from the email-based version ---------------------------------------------------

do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('talkcontext_recordings', 'owner_email', 'owner_name'),
      ('talkcontext_threads', 'created_by_email', 'created_by_name'),
      ('talkcontext_threads', 'resolved_by_email', 'resolved_by_name'),
      ('talkcontext_comments', 'author_email', 'author_name'),
      ('talkcontext_specs', 'updated_by_email', 'updated_by_name')
    ) as t(tbl, old_col, new_col)
  loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = r.tbl and column_name = r.old_col
    ) then
      execute format('alter table public.%I rename column %I to %I', r.tbl, r.old_col, r.new_col);
    end if;
  end loop;
  -- The old sign-up guard rejected users without a work email - anonymous users have none.
  if exists (select 1 from pg_proc where proname = 'talkcontext_before_user_created') then
    execute $f$
      create or replace function public.talkcontext_before_user_created(event jsonb)
      returns jsonb language sql as $b$ select '{}'::jsonb $b$
    $f$;
  end if;
end
$$;

-- 1. Who belongs to the team ---------------------------------------------------------------

-- SHA-256 of each team key. Not readable through the API (RLS on, no policies, no grants).
create table if not exists public.talkcontext_team_keys (
  key_hash text primary key,
  label text not null default '',
  created_at timestamptz not null default now()
);
alter table public.talkcontext_team_keys enable row level security;
revoke all on public.talkcontext_team_keys from anon, authenticated;

-- Anonymous users that presented a valid key. Deleting a key removes its members.
create table if not exists public.talkcontext_members (
  user_id uuid primary key references auth.users (id) on delete cascade,
  key_hash text not null references public.talkcontext_team_keys (key_hash) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  joined_at timestamptz not null default now()
);
alter table public.talkcontext_members enable row level security;
revoke all on public.talkcontext_members from anon, authenticated;

-- Creates a key and returns it once. Only callable from the SQL editor (not through the API).
create or replace function public.talkcontext_new_team_key(label text default '')
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  team_key text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  insert into public.talkcontext_team_keys (key_hash, label)
  values (encode(extensions.digest(team_key, 'sha256'), 'hex'), coalesce(label, ''));
  return team_key;
end
$$;
revoke execute on function public.talkcontext_new_team_key(text) from public, anon, authenticated;

-- The only way in: a signed-in (anonymous) user presents the team key and a display name.
create or replace function public.talkcontext_join(team_key text, member_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  found_hash text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(member_name, ''))) not between 1 and 80 then
    raise exception 'Name must be 1 to 80 characters' using errcode = '22023';
  end if;
  select k.key_hash into found_hash
  from public.talkcontext_team_keys k
  where k.key_hash = encode(extensions.digest(btrim(coalesce(team_key, '')), 'sha256'), 'hex');
  if found_hash is null then
    raise exception 'Invalid team key' using errcode = '42501';
  end if;
  insert into public.talkcontext_members (user_id, key_hash, name)
  values (auth.uid(), found_hash, btrim(member_name))
  on conflict (user_id) do update set key_hash = excluded.key_hash, name = excluded.name;
  return btrim(member_name);
end
$$;
revoke execute on function public.talkcontext_join(text, text) from public, anon;
grant execute on function public.talkcontext_join(text, text) to authenticated;

create or replace function public.talkcontext_is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.talkcontext_members m where m.user_id = auth.uid())
$$;
revoke execute on function public.talkcontext_is_member() from public, anon;
grant execute on function public.talkcontext_is_member() to authenticated;

-- Display name of the current member - used as author on everything they write.
create or replace function public.talkcontext_member_name()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.name from public.talkcontext_members m where m.user_id = auth.uid()
$$;
revoke execute on function public.talkcontext_member_name() from public, anon;
grant execute on function public.talkcontext_member_name() to authenticated;

-- 2. Shared recordings ----------------------------------------------------------------------

create table if not exists public.talkcontext_recordings (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{1,80}$'),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  owner_name text not null default public.talkcontext_member_name(),
  title text not null check (char_length(title) <= 300),
  url text not null check (char_length(url) <= 2000),
  environment text check (char_length(environment) <= 100),
  started_at timestamptz not null,
  duration_ms integer not null check (duration_ms >= 0),
  feedback_count integer not null default 0 check (feedback_count >= 0),
  error_count integer not null default 0 check (error_count >= 0),
  -- Where the .talkcontext file lives in the storage bucket (<owner_id>/<id>/).
  manifest jsonb not null default '{}'::jsonb,
  shared_at timestamptz not null default now()
);
alter table public.talkcontext_recordings alter column owner_name set default public.talkcontext_member_name();
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
    and owner_name = public.talkcontext_member_name()
  );

drop policy if exists "owner edits" on public.talkcontext_recordings;
create policy "owner edits" on public.talkcontext_recordings
  for update to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid() and owner_name = public.talkcontext_member_name());

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

-- 4. On-page comments ------------------------------------------------------------------------
-- Figma-style threads pinned to an element of a page, grouped by the feature someone works on.
-- Members read everything, write their own comments, and anyone in the team may resolve.

create table if not exists public.talkcontext_threads (
  id uuid primary key default gen_random_uuid(),
  feature text not null check (char_length(btrim(feature)) between 1 and 100),
  url text not null check (char_length(url) <= 2000),
  page_title text check (char_length(page_title) <= 300),
  selector text not null check (char_length(selector) <= 1000),
  -- Human-readable element description, e.g. "button “Save”".
  element_label text check (char_length(element_label) <= 300),
  -- Pin position inside the element, 0..1.
  pin_x real not null default 0.5 check (pin_x between 0 and 1),
  pin_y real not null default 0.5 check (pin_y between 0 and 1),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_by uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_by_name text not null default public.talkcontext_member_name(),
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_name text
);
-- `url` is the page pattern: ids in the path (uuid, number, hash) are `:id`, so a comment on one
-- meeting series shows on every series. `href` is the concrete page it was opened on.
alter table public.talkcontext_threads add column if not exists href text check (char_length(href) <= 2000);
-- Threads from before patterns: keep the page as href, turn url into its pattern (same rule as
-- pageKey() in extension/src/lib/comments.ts). Idempotent.
update public.talkcontext_threads set href = url where href is null;
update public.talkcontext_threads
set url = regexp_replace(
  url,
  '/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9]+|[0-9a-f]{16,}|(?=[a-z0-9]*[0-9])(?=[a-z0-9]*[a-z])[a-z0-9]{20,})(?=/|$)',
  '/:id',
  'gi'
);
create index if not exists talkcontext_threads_feature on public.talkcontext_threads (feature, last_activity_at desc);
create index if not exists talkcontext_threads_url on public.talkcontext_threads (url);

create table if not exists public.talkcontext_comments (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.talkcontext_threads (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 10000),
  author_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text not null default public.talkcontext_member_name(),
  -- Written by Claude Code through the TalkContext MCP server, on behalf of author_name.
  via_claude boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists talkcontext_comments_thread on public.talkcontext_comments (thread_id, created_at);

-- Collaborative spec per feature: one text everybody in the team edits.
create table if not exists public.talkcontext_specs (
  feature text primary key check (char_length(btrim(feature)) between 1 and 100),
  body text not null default '' check (char_length(body) <= 200000),
  updated_at timestamptz not null default now(),
  updated_by_name text not null default public.talkcontext_member_name()
);
alter table public.talkcontext_threads alter column created_by_name set default public.talkcontext_member_name();
alter table public.talkcontext_comments alter column author_name set default public.talkcontext_member_name();
alter table public.talkcontext_specs alter column updated_by_name set default public.talkcontext_member_name();

alter table public.talkcontext_threads enable row level security;
alter table public.talkcontext_comments enable row level security;
alter table public.talkcontext_specs enable row level security;
revoke all on public.talkcontext_threads, public.talkcontext_comments, public.talkcontext_specs from anon, authenticated;
grant select, insert, delete on public.talkcontext_threads to authenticated;
-- Only the status is changeable; who and when is set by the trigger below.
grant update (status) on public.talkcontext_threads to authenticated;
grant select, insert, delete on public.talkcontext_comments to authenticated;
grant update (body) on public.talkcontext_comments to authenticated;
grant select, insert on public.talkcontext_specs to authenticated;
grant update (body) on public.talkcontext_specs to authenticated;

drop policy if exists "members read" on public.talkcontext_threads;
create policy "members read" on public.talkcontext_threads
  for select to authenticated using (public.talkcontext_is_member());
drop policy if exists "members open own" on public.talkcontext_threads;
create policy "members open own" on public.talkcontext_threads
  for insert to authenticated
  with check (public.talkcontext_is_member() and created_by = auth.uid() and created_by_name = public.talkcontext_member_name());
drop policy if exists "members resolve" on public.talkcontext_threads;
create policy "members resolve" on public.talkcontext_threads
  for update to authenticated using (public.talkcontext_is_member()) with check (public.talkcontext_is_member());
drop policy if exists "creator deletes" on public.talkcontext_threads;
create policy "creator deletes" on public.talkcontext_threads
  for delete to authenticated using (created_by = auth.uid());

drop policy if exists "members read" on public.talkcontext_comments;
create policy "members read" on public.talkcontext_comments
  for select to authenticated using (public.talkcontext_is_member());
drop policy if exists "members write own" on public.talkcontext_comments;
create policy "members write own" on public.talkcontext_comments
  for insert to authenticated
  with check (public.talkcontext_is_member() and author_id = auth.uid() and author_name = public.talkcontext_member_name());
drop policy if exists "author edits" on public.talkcontext_comments;
create policy "author edits" on public.talkcontext_comments
  for update to authenticated using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "author deletes" on public.talkcontext_comments;
create policy "author deletes" on public.talkcontext_comments
  for delete to authenticated using (author_id = auth.uid());

drop policy if exists "members read" on public.talkcontext_specs;
create policy "members read" on public.talkcontext_specs
  for select to authenticated using (public.talkcontext_is_member());
drop policy if exists "members create" on public.talkcontext_specs;
create policy "members create" on public.talkcontext_specs
  for insert to authenticated
  with check (public.talkcontext_is_member() and updated_by_name = public.talkcontext_member_name());
drop policy if exists "members edit" on public.talkcontext_specs;
create policy "members edit" on public.talkcontext_specs
  for update to authenticated using (public.talkcontext_is_member()) with check (public.talkcontext_is_member());

-- Resolve/reopen: record who and when, server-side.
create or replace function public.talkcontext_thread_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.resolved_at := case when new.status = 'resolved' then now() end;
    new.resolved_by_name := case when new.status = 'resolved' then public.talkcontext_member_name() end;
    new.last_activity_at := now();
  end if;
  return new;
end
$$;
drop trigger if exists talkcontext_thread_status on public.talkcontext_threads;
create trigger talkcontext_thread_status before update on public.talkcontext_threads
  for each row execute function public.talkcontext_thread_status();

-- A new comment bumps the thread's activity (members can't update that column themselves).
create or replace function public.talkcontext_comment_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.talkcontext_threads set last_activity_at = now() where id = new.thread_id;
  return new;
end
$$;
revoke execute on function public.talkcontext_comment_activity() from public, anon, authenticated;
drop trigger if exists talkcontext_comment_activity on public.talkcontext_comments;
create trigger talkcontext_comment_activity after insert on public.talkcontext_comments
  for each row execute function public.talkcontext_comment_activity();

-- Spec edits: record who and when, server-side.
create or replace function public.talkcontext_spec_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by_name := public.talkcontext_member_name();
  return new;
end
$$;
drop trigger if exists talkcontext_spec_touch on public.talkcontext_specs;
create trigger talkcontext_spec_touch before update on public.talkcontext_specs
  for each row execute function public.talkcontext_spec_touch();

do $$
declare
  t text;
begin
  foreach t in array array['talkcontext_threads', 'talkcontext_comments', 'talkcontext_specs'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end
$$;

-- 5. Live presence and cursors -------------------------------------------------------------
-- The overlay joins a private Realtime channel per feature ("talkcontext:scope:<feature>") to
-- show who else works on it, on which page, and their cursor. Only team members may join.
drop policy if exists "talkcontext members receive" on realtime.messages;
create policy "talkcontext members receive" on realtime.messages
  for select to authenticated
  using (realtime.topic() like 'talkcontext:%' and public.talkcontext_is_member());
drop policy if exists "talkcontext members send" on realtime.messages;
create policy "talkcontext members send" on realtime.messages
  for insert to authenticated
  with check (realtime.topic() like 'talkcontext:%' and public.talkcontext_is_member());
