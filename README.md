# Golf League — accounts and saved matchplay

A plain HTML/CSS/ES-module app. Supabase Auth handles credentials and sessions. The existing project URL and **publishable** key in `supabase.js` are unchanged. No service-role key is needed in this app.

## Supabase setup (required before using the new app)

1. Review and run **`supabase/migrations/202609140001_accounts.sql`** once in your project's SQL Editor as the database owner. It creates `profiles`, `friend_requests`, `friendships`, `matches`, `match_holes`, constraints, indexes, RLS, permissions, and transactional RPC functions. It was tested locally, **not applied to your hosted project**.
2. If any of those tables already exist, the migration intentionally fails and rolls back rather than overwriting them. Compare their schemas first; do not drop existing tables to make the script pass. No existing `players` or `courses` rows are deleted. `players` client permissions are revoked; courses become read-only for authenticated clients. Review any unrelated legacy RPCs separately, since their hosted definitions are not in this repository.
3. In **Authentication → Providers**, enable email/password and keep email confirmation enabled. Configure a working email sender/SMTP for delivery. Leave anonymous sign-ins disabled for this account-based app.
4. In **Authentication → URL Configuration**, set the Site URL to your deployed app. Add its exact page URL and your local development URL to Redirect URLs (including `/index.html` or a subdirectory if that is how you open the app). Sign-up confirmation and OAuth return to the current origin + pathname.
5. Enable **Google** in Supabase Auth. Create a Google Web OAuth client. Set its authorized origin to your app's origin and its callback URI to the Supabase callback shown in the dashboard. For this existing project it is `https://uzbvdcjlmuebagmuzjjq.supabase.co/auth/v1/callback`. Put the Google client ID/secret in Supabase's Google provider settings, **never in these frontend files**. If the Google app is in testing mode, add your testers in Google Cloud.
6. Serve `GOLF` over HTTP locally or HTTPS in production. ES modules and OAuth are not supported by opening `index.html` using `file://`. No build step is required. The Supabase SDK loads from the existing jsDelivr import.

The SDK manages the browser OAuth callback and persisted session. Auth events defer database calls outside the callback to avoid holding the SDK's auth lock. A signed-in account without a profile can only use onboarding or log out. A profile is created explicitly, not by guessing a username from a Google name or email.

## Application structure

- `index.html`: login, mandatory onboarding, home, friends, setup, scorecard, profile/history views.
- `style.css`: white/green mobile layout, 480px max width, 48–58px controls and iPhone safe-area spacing. No wide tables.
- `supabase.js`: unchanged public connection, SDK-provided auth persistence.
- `script.js`: starts the app.
- `js/app.js`: account lifecycle, navigation, form states, friends, course selection, scoring and history rendering. User-controlled text uses DOM text nodes.
- `js/api.js`: Auth API, scoped database reads and RPC calls. Collections are paginated; no silent 1,000-row truncation.
- `js/match.js`: profile validation, display statuses and user statistics. Final scoring is authoritative in PostgreSQL.
- `legacy/`: non-executing snapshots and the manual-player migration assessment.

## Data and security decisions

| Data | Read | Write |
| --- | --- | --- |
| Profiles | Signed-in users (username/name/handicap; no email) | Own row only; username and Auth ID cannot be edited |
| Requests | Sender/recipient only | Send/respond RPCs; only recipient can accept/decline |
| Friendships | The two friends | Created atomically when recipient accepts |
| Matches and holes | The two players | Validated RPCs only; no direct client inserts/updates/deletes |
| Courses | Signed-in users | Database administrator |

All RPCs use a fixed empty search path and qualified table names, explicit `auth.uid()` checks, and restricted execution grants. An unordered unique pair prevents opposite-direction duplicate requests. Match RPCs lock the match row. Repeated identical score submissions return the saved match; contradictory or out-of-order scores are rejected. The browser cannot choose the winner, date, handicaps, participants of an existing match, or final result.

Either participant can record both players' scores or cancel an active match, as requested for shared-phone 1v1 play. This is a trust model between the two participants, not a referee/dual-confirmation system. Other users cannot access that match.

Names, handicaps, course labels, hole pars/indices, and allocated strokes are snapshotted at match creation. Later profile/course edits do not rewrite history. Completed results are stored for both participants. Cancelled rounds remain stored but are excluded from win/loss/draw statistics. Profile deletion is deliberately not exposed; history foreign keys require a separate retention/anonymization decision if account deletion is added later.

The existing handicap rule is preserved: round the absolute difference in registered handicaps, distribute it across the selected course's holes ranked by stroke index (including odd-numbered indices on 9-hole courses). This is not a slope/course-rating calculation. Without a course the app retains the original 18-hole, no-handicap fallback. Both scores are entered as gross strokes (1–30); the database subtracts allocated strokes and ends the match once the lead exceeds holes remaining, or the last hole is played.

A match is saved at creation and each hole is saved transactionally. No offline win is presented as a saved result. Per-account localStorage journals keep an uncertain start ID or failed score attempt for retry; authoritative matches and history load from Supabase after refresh or another login. The app never restores the previous anonymous `activeGolfMatch`. Use **Oppdater** to fetch changes from another phone; realtime subscriptions are not required or configured.

## Validation

```sh
npm ci --ignore-scripts
npm run check
npm test
```

The only development dependency is PGlite (local PostgreSQL). It is not shipped to the browser. `tests/database.test.cjs` runs the real migration with mock Supabase Auth roles/IDs and verifies grants/RLS, invalid access, friend flows, idempotency, snapshots, early wins, draws and cancellation. `tests/flows.test.cjs` exercises the actual app/API modules with a minimal DOM and an isolated Supabase test double, including auth/onboarding, friends, retries, history and logout races.

These tests do not contact your hosted database, send emails, or authenticate with Google. Browser visual QA was not available in the current session. After setup, verify with two real test accounts and a third outsider:

1. Register, confirm email, log in; create a unique profile. Repeat using Google. Log out and back in.
2. Edit your own name/handicap. Check self-request prevention, duplicate requests, acceptance, decline and pending states.
3. Start a match with an accepted friend. Pick club/course/tee; confirm both handicaps. Also test the no-course fallback.
4. Enter scores from both accounts, refresh mid-match, retry an interrupted save, complete an early win and a draw. Confirm matching history and opposite win/loss outcomes for the two participants.
5. Verify the third account cannot read the match or score rows or modify another profile, including through direct API calls.
6. Inspect login, onboarding, friends, setup, scoring and history at 320/390/480px, large text, keyboard-open and iPhone safe-area sizes. Test Google cancellation, wrong passwords, an already-used username, and offline errors.

Official setup references: [Google Auth](https://supabase.com/docs/guides/auth/social-login/auth-google), [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [database functions](https://supabase.com/docs/guides/database/functions).
