# Team sharing with your own Supabase

TalkContext works fully locally. To share recordings inside a team, connect it to a Supabase
project you own. There is no TalkContext server: the extension talks to Supabase directly and
the database rules in `setup.sql` decide who may see and change what.

## Setup (about 10 minutes, once per team)

1. **Create or pick a Supabase project.** A dedicated one is simplest; every object of
   TalkContext is prefixed with `talkcontext_`, so an existing project works too.
2. **Run `setup.sql`** in Dashboard → SQL Editor. It can be re-run safely.
3. **Add your email domain(s)** in the SQL Editor:
   ```sql
   insert into public.talkcontext_allowed_domains (domain) values ('example.com');
   ```
   With an empty list nobody can read anything.
4. **Turn on the sign-up guard:** Dashboard → Authentication → Hooks → *Before User Created* →
   Postgres → `public.talkcontext_before_user_created`. Without it outsiders can still create an
   account; they see nothing, but the account exists.
5. **Email sign-in by code:** Authentication → Sign In / Providers → Email enabled. In
   Authentication → Emails → *Magic Link* template, include `{{ .Token }}` so the mail carries the
   6-digit code the extension asks for.
6. **Own SMTP** (Authentication → Emails → SMTP Settings). The built-in mailer sends only a few
   mails per hour and is meant for testing.
7. **Give each teammate** the project URL and the anon/publishable key (Settings → API). Both are
   meant to be public. Never hand out the `service_role` key; the extension does not need it.

In the extension: Settings → Team sharing → paste URL and key → sign in with your work email.

## What is shared and who sees it

| | Without sign-in | Signed in, team domain |
|---|---|---|
| Record, replay, hand off to Claude Code | yes, local | yes, local |
| Share a recording | – | yes, stays yours |
| See the shared folder | – | all shared recordings of the team |
| Edit title / unshare | – | only your own |

Shared recordings land in the table `talkcontext_recordings` and the private bucket
`talkcontext` under `<your user id>/<recording id>/recording.talkcontext` – the full recording
(replay, audio, transcript, feedback, screenshots, console, network) in the extension's
`.talkcontext` format, so teammates can watch and listen to it, not just read the handoff. Recordings can contain what was on screen,
including customer data: share only what the whole team may see. Masking settings in the
extension apply before upload.
