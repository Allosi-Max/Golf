// Display helpers only. Supabase calculates and stores the authoritative result.
export function statusFor(match, side = 1) {
    const diff = (match.holes_won1 - match.holes_won2) * (side === 1 ? 1 : -1);
    return diff === 0 ? 'AS' : `${Math.abs(diff)} ${diff > 0 ? 'UP' : 'DOWN'}`;
}
export function outcome(match, userId) {
    if (match.status === 'cancelled') return 'Cancelled';
    if (match.status !== 'finished') return 'In progress';
    return match.winner_id === null ? 'Draw' : match.winner_id === userId ? 'Win' : 'Loss';
}
export function opponentName(match, userId) {
    return match.player1_id === userId ? match.player2_name : match.player1_name;
}
export function statistics(matches, userId) {
    const finished = matches.filter(m => m.status === 'finished');
    return { played: finished.length, wins: finished.filter(m => m.winner_id === userId).length,
        losses: finished.filter(m => m.winner_id && m.winner_id !== userId).length,
        draws: finished.filter(m => !m.winner_id).length };
}
export function profileFields(username, displayName, handicap) {
    const fields = { username: username.trim().toLowerCase(), display_name: displayName.trim(), handicap: Number(handicap) };
    if (!/^[a-z0-9_]{3,24}$/.test(fields.username)) throw new Error('Username must contain 3–24 lowercase letters, numbers or underscores.');
    if (!fields.display_name || fields.display_name.length > 80) throw new Error('Display name must contain 1–80 characters.');
    if (String(handicap).trim() === '' || !Number.isFinite(fields.handicap) || fields.handicap < -10 || fields.handicap > 54
        || Math.abs(fields.handicap * 10 - Math.round(fields.handicap * 10)) > 0.00001) {
        throw new Error('Handicap Index must be between −10 and 54, with at most one decimal place.');
    }
    return fields;
}
export function errorMessage(error) {
    const message = error?.message || '';
    const known = {
        USER_NOT_FOUND: 'No user found with that username.',
        CANNOT_ADD_SELF: 'You cannot add yourself.',
        ALREADY_FRIENDS: 'You are already friends.',
        INCOMING_REQUEST_EXISTS: 'This user has already sent you a request. Accept it under Incoming requests.',
        REQUEST_ALREADY_HANDLED: 'This request has already been handled. Refresh your friends list.',
        FRIEND_REQUIRED: 'Choose a friend who has accepted your request.',
        PROFILE_REQUIRED: 'Complete your profile first.',
        NOT_ALLOWED: 'You do not have permission to do that.',
        SCORE_CONFLICT: 'This hole already has a different score. Refresh the scorecard before continuing.',
        STALE_HOLE: 'The match was updated on another device. Refresh the scorecard.',
        MATCH_FINISHED: 'This match has already ended. Refresh the scorecard.',
        INVALID_SCORE: 'Enter a score between 1 and 30 for both players.',
        INVALID_TEE_RATINGS: 'The selected tee has missing or invalid ratings in the course database.',
        INVALID_COURSE: 'This course has invalid hole data. Choose another course or play without a course.',
        COURSE_NOT_FOUND: 'This course is no longer available. Choose another course.'
    };
    for (const [key, value] of Object.entries(known)) if (message.includes(key)) return value;
    if (error?.code === '23505') return 'That username is taken. Choose another.';
    if (['42P01', 'PGRST202', 'PGRST205'].includes(error?.code)) return 'Database setup is missing. Run the Supabase SQL migration before continuing.';
    if (/Invalid login credentials/i.test(message)) return 'Incorrect email or password.';
    if (/Email not confirmed/i.test(message)) return 'Confirm your email address before logging in.';
    if (/provider.*not.*enabled|Unsupported provider/i.test(message)) return 'Google sign-in must be enabled in Supabase first.';
    if (/rate limit/i.test(message)) return 'Too many attempts. Please wait and try again.';
    if (/fetch|network|load failed/i.test(message)) return 'Could not connect. Check your connection and try again.';
    return message || 'Something went wrong. Please try again.';
}
