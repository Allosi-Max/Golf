// All account data goes through the existing public Supabase client.
export function createApi(client) {
    async function result(query) {
        const { data, error } = await query;
        if (error) throw error;
        return data;
    }
    async function all(table, order) {
        const rows = [];
        for (let offset = 0; ; offset += 200) {
            const page = await result(client.from(table).select('*').order(order, { ascending: true }).range(offset, offset + 199));
            rows.push(...page);
            if (page.length < 200) return rows;
        }
    }
    return {
        session: async () => (await result(client.auth.getSession())).session,
        login: (email, password) => result(client.auth.signInWithPassword({ email, password })),
        signup: (email, password, redirect) => result(client.auth.signUp({ email, password, options: { emailRedirectTo: redirect } })),
        google: redirect => result(client.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: redirect } })),
        logout: () => result(client.auth.signOut()),
        profile: id => result(client.from('profiles').select('*').eq('id', id).maybeSingle()),
        createProfile: (id, fields) => result(client.from('profiles').insert({ id, ...fields }).select().single()),
        editProfile: (id, fields) => result(client.from('profiles').update({ display_name: fields.display_name, handicap: fields.handicap }).eq('id', id).select().single()),
        search: username => result(client.from('profiles').select('id,username,display_name,handicap').eq('username', username).maybeSingle()),
        profiles: async ids => {
            const unique = [...new Set(ids)], rows = [];
            for (let i = 0; i < unique.length; i += 100) {
                rows.push(...await result(client.from('profiles').select('id,username,display_name,handicap').in('id', unique.slice(i, i + 100))));
            }
            return rows;
        },
        friendships: () => all('friendships', 'created_at'),
        requests: () => all('friend_requests', 'created_at'),
        sendRequest: username => result(client.rpc('send_friend_request', { p_username: username })),
        respondRequest: (id, accept) => result(client.rpc('respond_friend_request', { p_request_id: id, p_accept: accept })),
        courses: () => all('courses', 'id'),
        matches: () => all('matches', 'created_at'),
        match: id => result(client.from('matches').select('*').eq('id', id).single()),
        holes: id => result(client.from('match_holes').select('*').eq('match_id', id).order('hole', { ascending: true })),
        startMatch: (id, opponent, course) => result(client.rpc('start_match', { p_match_id: id, p_opponent_id: opponent, p_course_id: course })),
        submitHole: (id, hole, score1, score2) => result(client.rpc('submit_match_hole', { p_match_id: id, p_hole: hole, p_score1: score1, p_score2: score2 })),
        cancelMatch: id => result(client.rpc('cancel_match', { p_match_id: id }))
    };
}
