# Golf Match — accounts and saved matchplay

A plain HTML/CSS/ES-module app. Supabase Auth handles credentials and sessions. The existing project URL and **publishable** key in `supabase.js` are unchanged. No service-role key is needed in this app.

## Supabase setup (required before using the new app)

1. Review and run **`supabase/migrations/202609140001_accounts.sql`** once in your project's SQL Editor as the database owner. It creates `profiles`, `friend_requests`, `friendships`, `matches`, `match_holes`, constraints, indexes, RLS, permissions, and transactional RPC functions. It was tested locally, **not applied to your hosted project**.
2. If any of those tables already exist, the migration intentionally fails and rolls back rather than overwriting them. Compare their schemas first; do not drop existing tables to make the script pass. No existing `players` or `courses` rows are deleted. `players` client permissions are revoked; courses become read-only for authenticated clients. Review any unrelated legacy RPCs separately, since their hosted definitions are not in this repository.
3. In **Authentication → Providers**, enable email/password and keep email confirmation enabled. Configure a working email sender/SMTP for delivery. Leave anonymous sign-ins disabled for this account-based app.
4. In **Authentication → URL Configuration**, set the Site URL to your deployed app. Add its exact page URL and your local development URL to Redirect URLs (including `/index.html` or a subdirectory if that is how you open the app). Sign-up confirmation and OAuth return to the current origin + pathname.
5. Enable **Google** in Supabase Auth. Create a Google Web OAuth client. Set its authorized origin to your app's origin and its callback URI to the Supabase callback shown in the dashboard. For this existing project it is `https://uzbvdcjlmuebagmuzjjq.supabase.co/auth/v1/callback`. Put the Google client ID/secret in Supabase's Google provider settings, **never in these frontend files**. If the Google app is in testing mode, add your testers in Google Cloud.
6. Serve `GOLF` over HTTP locally or HTTPS in production. ES modules and OAuth are not supported by opening `index.html` using `file://`. No build step is required. The Supabase SDK loads from the existing jsDelivr import.

### Handicap allocation update

After the original accounts migration, run **`supabase/migrations/202609170001_individual_si_allowances.sql`** once. Run missing migrations in date order, including the Course Handicap migration below. This updates `start_match` and allows signed stroke allowances for existing negative handicaps. It does not change authentication, RLS, friendships, the net-score comparison, or saved match rows. Start a new match to use the corrected allocations; already-started/completed matches retain their original snapshots. The migration has not been applied to the hosted database by these local tests.

### Course Handicap update

Run missing migrations in order, including **`supabase/migrations/202609170002_course_handicap.sql`** followed by **`supabase/migrations/202609170003_stored_tee_ratings.sql`**. Do not edit or rerun earlier applied migrations. The latest migration replaces the manual-rating RPC with a three-argument RPC that accepts only match ID, opponent ID and the existing course/tee row ID. These migrations have not been applied to hosted Supabase by these local tests. Existing match snapshots and results are unchanged.

The verified existing structure is **`public.courses`**, one row per course/tee: `id`, `club_name`, `course_name`, `tee_name`, `slope_rating`, `course_rating`, `par_total`, and `holes` JSON with `hole`, `par`, `stroke_index` (and optional yardage). There is no separate tee ID in the supplied structure; the selected row ID identifies the tee. The existing paginated course loader and club/course/tee selection are reused. Setup displays stored ratings read-only and calculates a preview. Missing/invalid ratings block course-backed starts with a database-data message; no manual-entry fallback or guessed ratings.

At creation the server rereads the selected course row, validates its data, and snapshots its ID, labels, ratings, `par_total` (also `par` for display compatibility), tee row ID, and complete `holes` JSON in `matches.course_snapshot`. Hole number, par and SI are also copied to the existing `match_holes` records alongside allocated strokes. No permanent course/tee rows are created or edited. Server values are authoritative if the course was edited after the preview loaded.

The provided Haga Golf / Blå-Rød / tee 61 row (ID 10) uses Slope 139, CR 73.3 and Par 71. Indices 12.2 / 17.2 produce Course/Playing Handicaps 17 / 23. This differs from the 113/75/72 example below because the stored tee ratings differ.

The server reads each player's Handicap Index from their profile and calculates `round(Index × (Slope / 113) + (CR − Par))`, with no explicit intermediate rounding. Exact half values round away from zero; the browser uses exact decimal arithmetic for the same preview. `matches.handicap1/2` retain the exact Index; `course_handicap1/2` and `playing_handicap1/2` are separate integer snapshots. Current testing uses an explicit **100% allowance**, stored in `handicap_allowance`, so Playing Handicap equals Course Handicap. No handicap difference is redistributed. For Index 12.2 and 17.2, Slope 113, CR 75, Par 72: Course/Playing Handicaps are 15 and 20, and B's advantage is SI 1, 2, 16, 17, 18.

The supplied formula is used as requested; there is no separate nine-hole conversion or automatic format allowance. No-course mode remains zero strokes (Course Handicap not calculated, Playing Handicap 0). The scorecard shows names, scores, hole/Par/SI and subtle current-hole stroke-advantage highlights. The temporary debug table has been removed; allocation calculations and saved data are unchanged.

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

Each player's calculated Playing Handicap supplies their stroke allowance. For nonnegative allowance `H`, each hole receives `floor(H / 18) + (SI <= H % 18 ? 1 : 0)` strokes, using the SI stored for that hole—not the hole number, array order, or a rank within the selected course. Both full allowances are snapshotted in `match_holes`; `submit_match_hole` compares each player's gross score minus their own allowance. Thus 10 vs 15 gives B an extra stroke only on SI 11–15; 10 vs 20 gives B an extra stroke on SI 1–2 and 11–18. Nine-hole courses retain their stored SI on the same 1–18 scale; they are not re-ranked. New course-backed matches reject SI outside 1–18. Negative handicaps already supported by profiles use signed allowances (e.g. −2 gives strokes back on SI 17–18). New matches use the Course Handicap conversion described above. Without a course, the existing 18-hole, zero-handicap fallback is unchanged. Both scores are entered as gross strokes (1–30); the match ends when the lead exceeds holes remaining or the last hole is played.

A match is saved at creation and each hole is saved transactionally. No offline win is presented as a saved result. Per-account localStorage journals keep an uncertain start ID or failed score attempt for retry; authoritative matches and history load from Supabase after refresh or another login. The app never restores the previous anonymous `activeGolfMatch`. Use **Refresh** to fetch changes from another phone; realtime subscriptions are not required or configured.

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
