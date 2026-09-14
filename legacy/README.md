# Previous manual-player implementation

These text snapshots preserve the app and regression tests before account migration. They are not loaded by the frontend and do not execute as app modules.

Inspection showed `players` supplied opponent names and handicaps to a browser-local `activeGolfMatch`. There were no database-backed match results, profile IDs, or friendship records. It is not safe to identify an Auth account by a legacy player's name.

The migration keeps all existing player/course rows. It revokes client access to `players` after retirement, keeps authenticated read access to `courses`, and does not delete the old `activeGolfMatch` localStorage entry. The new app never associates that unauthenticated state with an account or counts it in account statistics. Review/export it separately if it matters. Keep these snapshots for reference; do not restore the old app against the new grants without a deliberate rollback plan.
