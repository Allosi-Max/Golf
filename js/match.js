// Display helpers only. Supabase calculates and stores the authoritative result.
export function statusFor(match, side = 1) {
    const diff = (match.holes_won1 - match.holes_won2) * (side === 1 ? 1 : -1);
    return diff === 0 ? 'AS' : `${Math.abs(diff)} ${diff > 0 ? 'UP' : 'NED'}`;
}
export function outcome(match, userId) {
    if (match.status === 'cancelled') return 'Avbrutt';
    if (match.status !== 'finished') return 'Pågår';
    return match.winner_id === null ? 'Delt' : match.winner_id === userId ? 'Seier' : 'Tap';
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
    if (!/^[a-z0-9_]{3,24}$/.test(fields.username)) throw new Error('Brukernavnet må ha 3–24 små bokstaver, tall eller understrek.');
    if (!fields.display_name || fields.display_name.length > 80) throw new Error('Visningsnavnet må ha 1–80 tegn.');
    if (String(handicap).trim() === '' || !Number.isFinite(fields.handicap) || fields.handicap < -10 || fields.handicap > 54
        || Math.abs(fields.handicap * 10 - Math.round(fields.handicap * 10)) > 0.00001) {
        throw new Error('Handicap må være mellom −10 og 54, med maksimalt én desimal.');
    }
    return fields;
}
export function errorMessage(error) {
    const message = error?.message || '';
    const known = {
        USER_NOT_FOUND: 'Fant ingen bruker med dette brukernavnet.',
        CANNOT_ADD_SELF: 'Du kan ikke legge til deg selv.',
        ALREADY_FRIENDS: 'Dere er allerede venner.',
        INCOMING_REQUEST_EXISTS: 'Du har en forespørsel fra denne brukeren. Godta den under Mottatt.',
        REQUEST_ALREADY_HANDLED: 'Forespørselen er allerede behandlet. Oppdater vennelisten.',
        FRIEND_REQUIRED: 'Velg en venn som har godtatt forespørselen din.',
        PROFILE_REQUIRED: 'Fullfør profilen din først.',
        NOT_ALLOWED: 'Du har ikke tilgang til denne handlingen.',
        SCORE_CONFLICT: 'Dette hullet har allerede fått en annen score. Oppdater scorekortet før du fortsetter.',
        STALE_HOLE: 'Kampen er oppdatert på en annen enhet. Oppdater scorekortet.',
        MATCH_FINISHED: 'Kampen er allerede avsluttet. Oppdater scorekortet.',
        INVALID_SCORE: 'Velg en score mellom 1 og 30 for begge spillere.',
        INVALID_COURSE: 'Banen mangler gyldige hulldata. Velg en annen bane eller spill uten bane.',
        COURSE_NOT_FOUND: 'Banen finnes ikke lenger. Velg en annen bane.'
    };
    for (const [key, value] of Object.entries(known)) if (message.includes(key)) return value;
    if (error?.code === '23505') return 'Brukernavnet er opptatt. Velg et annet.';
    if (['42P01', 'PGRST202', 'PGRST205'].includes(error?.code)) return 'Databaseoppsettet mangler. Kjør SQL-filen i Supabase før du fortsetter.';
    if (/Invalid login credentials/i.test(message)) return 'Feil e-postadresse eller passord.';
    if (/Email not confirmed/i.test(message)) return 'Bekreft e-postadressen din før du logger inn.';
    if (/provider.*not.*enabled|Unsupported provider/i.test(message)) return 'Google-innlogging må aktiveres i Supabase først.';
    if (/rate limit/i.test(message)) return 'For mange forsøk. Vent litt før du prøver igjen.';
    if (/fetch|network|load failed/i.test(message)) return 'Kunne ikke koble til. Sjekk forbindelsen og prøv igjen.';
    return message || 'Noe gikk galt. Prøv igjen.';
}
