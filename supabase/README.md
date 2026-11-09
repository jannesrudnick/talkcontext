# Team sharing with your own Supabase

TalkContext works fully locally. To share recordings inside a team, connect it to a Supabase
project you own. There is no TalkContext server: the extension talks to Supabase directly and
the database rules in `setup.sql` decide who may see and change what.

## Setup (about 5 minutes, once per team)

1. **Create or pick a Supabase project.** A dedicated one is simplest; every object of
   TalkContext is prefixed with `talkcontext_`, so an existing project works too.
2. **Run `setup.sql`** in Dashboard → SQL Editor. It can be re-run safely, and upgrades the
   earlier email-based version in place.
3. **Allow anonymous sign-ins:** Authentication → Sign In / Providers → *Allow anonymous
   sign-ins*. No email provider and no SMTP needed.
4. **Create the team key** in the SQL Editor and copy the result – it is shown only once:
   ```sql
   select public.talkcontext_new_team_key('team');
   ```
5. **Give each teammate** the project URL, the anon/publishable key (Settings → API) and the team
   key. Never hand out the `service_role` key; the extension does not need it.

In the extension: Settings → Team sharing → URL, anon key, team key, your name → **Connect**.

### How the key protects the data

The extension signs in anonymously and calls `talkcontext_join(team_key, name)` once. That
function compares the key's SHA-256 with `talkcontext_team_keys`, a table nobody can read
through the API (RLS on, no policies, no grants), and on a match records the user in
`talkcontext_members`. Every policy checks that membership. An anonymous user without a valid key
is signed in but sees and changes nothing.

- **Rotate or revoke:** `delete from public.talkcontext_team_keys;` removes every member of that
  key at once; then create a new key and hand it out.
- **Names are not verified:** whoever holds the key picks a display name. Fine inside a team,
  not an identity system. Ownership (unshare, delete) is bound to the anonymous user, not the name.
- **Upgrading from the email version?** If you had enabled the *Before User Created* hook, disable
  it (re-running `setup.sql` already makes it a no-op). `talkcontext_allowed_domains` is unused
  and can be dropped.

## On-page comments and specs

Collaboration is opt-in per person: Settings → Collaboration in the extension. Section 4 of
`setup.sql` adds Figma-style comments: in the extension overlay, click the comment
button, pick an element, write. Threads (`talkcontext_threads` + `talkcontext_comments`) are filed
under the feature you work on and show as pins on that element for everyone on the team. Every
feature also has one shared spec text (`talkcontext_specs`). Claude Code reads, answers and
resolves threads through the TalkContext MCP server.

Threads are pinned to the page *pattern*, not the exact URL: ids in the path (UUIDs, numbers,
long hashes) become `:id`, so a comment on `/besprechungsreihen/4f1c…/protokoll` shows on every
meeting series' protocol page. Re-running `setup.sql` converts older threads.

Section 5 adds live presence and live view. While the overlay is open in a visible tab, you are on
the team's private Realtime channel; the dock shows who else is online and in your feature.
Switch the dock to **Public** to share which page you are on: teammates can go there, or **ask to
join**. You approve each request in a small dialog; the viewer then watches your tab live (an rrweb
stream replayed in an extension tab, so they need no login to your app). Stop it from the dock, by
going private, or by closing the overlay. Comments and pins update live. Only team members can join
these channels (RLS on `realtime.messages`). Approval is consent, not access control: any member
could listen on a live channel - fine inside a team that shares the key.

| | Team member |
|---|---|
| Read threads, comments, specs | all |
| Open a thread, comment | as yourself only |
| Resolve / reopen | any thread (who and when is recorded server-side) |
| Edit / delete a comment | your own |
| Delete a thread | the one who opened it |
| Edit a spec | any (last write wins) |

## What is shared and who sees it

| | Not connected | Connected with the team key |
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
