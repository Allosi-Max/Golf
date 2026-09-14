import { createApi } from './api.js';
import { statusFor, outcome, opponentName, statistics, profileFields, errorMessage } from './match.js';

export function createApp(client, env = {}) {
    const doc = env.document || document, win = env.window || window;
    const api = createApi(client), $ = id => doc.getElementById(id);
    const state = { user: null, profile: null, phase: 'loading', friends: [], requests: [], people: [],
        matches: [], match: null, holes: [], courses: [], opponent: null, course: null, signup: false };
    let epoch = 0, matchRead = 0, searchRead = 0, friendsRead = 0, authEvent = 0, subscription;
    const viewIds = ['loading', 'auth', 'onboarding', 'home', 'friends', 'setup', 'matches', 'play', 'profile'];
    const number = n => Number(n).toLocaleString('nb-NO', { maximumFractionDigits: 1 });
    const date = value => new Date(value).toLocaleDateString('nb-NO', { day: 'numeric', month: 'short', year: 'numeric' });
    function text(tag, value, className = '') {
        const el = doc.createElement(tag); el.textContent = value; el.className = className; return el;
    }
    function button(label, action, className = 'secondary') {
        const el = text('button', label, className); el.type = 'button'; el.addEventListener('click', action); return el;
    }
    function feedback(id, message = '', error = false) {
        $(id).textContent = message; $(id).classList.toggle('error', error);
        if (id === 'appMessage') $(id).hidden = !message;
    }
    function empty(id, message) { $(id).replaceChildren(text('p', message, 'empty-state')); }
    async function request(promise) {
        const version = epoch;
        const value = await promise;
        if (epoch !== version) throw new Error('SESSION_CHANGED');
        return value;
    }
    async function work(control, target, action) {
        if (control.disabled) return;
        control.disabled = true; feedback(target);
        const version = epoch;
        try { await action(); }
        catch (error) {
            if (version === epoch && error.message !== 'SESSION_CHANGED') feedback(target, errorMessage(error), true);
        } finally { control.disabled = false; }
    }
    function form(id, target, action) {
        $(id).addEventListener('submit', event => {
            event.preventDefault();
            void work(event.submitter || $(id).querySelector('button[type="submit"]') || $(id).querySelector('button'), target, action);
        });
    }
    function journalKey(kind) { return `golf.accounts.${state.user.id}.${kind}`; }
    function readJournal(kind) {
        try { return JSON.parse(win.localStorage.getItem(journalKey(kind)) || 'null'); } catch { return null; }
    }
    function writeJournal(kind, value) {
        try {
            if (value === null) win.localStorage.removeItem(journalKey(kind));
            else win.localStorage.setItem(journalKey(kind), JSON.stringify(value));
        } catch { feedback('appMessage', 'Nettleseren kan ikke lagre utkast. Hold siden åpen hvis en lagring må prøves igjen.'); }
    }
    function clearPrivateState() {
        Object.assign(state, { profile: null, friends: [], requests: [], people: [], matches: [], match: null,
            holes: [], courses: [], opponent: null, course: null });
        for (const id of ['searchResults', 'friendList', 'incomingRequests', 'outgoingRequests', 'setupPlayers',
            'matchList', 'scoringPlayers', 'holeResults', 'profileHistory', 'profileStats']) $(id).replaceChildren();
        for (const input of doc.querySelectorAll('input')) input.value = '';
        for (const id of ['authFeedback', 'onboardingFeedback', 'friendsFeedback', 'profileFeedback', 'historyFeedback',
            'setupFeedback', 'scoreFeedback', 'matchesFeedback', 'appMessage']) feedback(id);
        matchRead++; searchRead++; friendsRead++;
    }
    function show(view) {
        for (const id of viewIds) $(`${id}View`).hidden = id !== view;
        const ready = state.phase === 'ready';
        $('appNav').hidden = !ready; $('logoutButton').hidden = !state.user;
        doc.body.classList.toggle('signed-out', !ready);
        for (const link of doc.querySelectorAll('[data-route]')) {
            const active = link.dataset.route === (view === 'play' || view === 'setup' ? 'matches' : view);
            link.classList.toggle('active', active);
            if (active) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
        }
        doc.title = `${({auth:'Logg inn',onboarding:'Opprett profil',home:'Hjem',friends:'Venner',matches:'Kamper',play:'Matchplay',profile:'Min profil',setup:'Ny kamp'})[view] || 'Velkommen'} · Golf League`;
    }
    async function handleSession(session) {
        const user = session?.user || null;
        if (user && user.id === state.user?.id && ['loading', 'ready', 'onboarding'].includes(state.phase)) return;
        epoch++; clearPrivateState(); state.user = user;
        if (!user) { state.phase = 'auth'; show('auth'); return; }
        state.phase = 'loading'; show('loading');
        const version = epoch;
        try {
            const profile = await api.profile(user.id);
            if (version !== epoch) return;
            state.profile = profile; state.phase = profile ? 'ready' : 'onboarding';
            if (profile) route(); else show('onboarding');
        } catch (error) {
            if (version !== epoch) return;
            state.phase = 'error';
            empty('loadingView', 'Kontoen kunne ikke lastes.');
            $('loadingView').appendChild(button('Prøv igjen', () => handleSession(session)));
            feedback('appMessage', errorMessage(error), true);
        }
    }
    function go(hash) {
        win.history.replaceState(null, '', `#${hash}`); route();
        $('main').scrollIntoView({ block: 'start' });
    }
    function route() {
        if (state.phase !== 'ready') { show(state.phase === 'error' ? 'loading' : state.phase); return; }
        const hash = win.location.hash.slice(1) || 'home';
        if (!hash.startsWith('match/')) matchRead++;
        if (hash.startsWith('match/')) {
            show('play'); void work($('refreshMatch'), 'scoreFeedback', () => loadMatch(hash.slice(6))); return;
        }
        const aliases = { oversikt: 'home', spillere: 'friends', statistikk: 'profile', matchplay: 'matches', 'ny-kamp': 'friends' };
        const view = aliases[hash] || hash;
        if (view === 'friends') { show('friends'); void work($('refreshFriends'), 'friendsFeedback', loadFriends); }
        else if (view === 'matches') { show('matches'); void work($('refreshMatches'), 'matchesFeedback', loadMatches); }
        else if (view === 'profile') {
            show('profile'); $('profileUsername').textContent = `@${state.profile.username}`;
            $('displayName').value = state.profile.display_name; $('handicap').value = state.profile.handicap;
            void work($('refreshHistory'), 'historyFeedback', loadMatches);
        } else if (view === 'setup' && state.opponent) { show('setup'); renderSetup(); }
        else {
            show('home'); $('welcomeTitle').textContent = `Hei, ${state.profile.display_name}.`;
        }
    }
    async function loadFriends() {
        const read = ++friendsRead;
        empty('friendList', 'Henter venner …');
        const [friendships, requests] = await request(Promise.all([api.friendships(), api.requests()]));
        const ids = friendships.map(f => f.user_low === state.user.id ? f.user_high : f.user_low);
        const people = await request(api.profiles([...ids, ...requests.flatMap(r => [r.sender_id, r.recipient_id])]));
        if (read !== friendsRead) return;
        state.people = people; state.friends = people.filter(p => ids.includes(p.id)); state.requests = requests;
        renderFriends();
    }
    function personCard(person) {
        const card = doc.createElement('article'); card.className = 'person-card';
        const info = doc.createElement('div');
        info.append(text('h3', person.display_name), text('p', `@${person.username} · HCP ${number(person.handicap)}`, 'hint'));
        card.appendChild(info); return card;
    }
    function renderFriends() {
        $('friendList').replaceChildren();
        if (!state.friends.length) empty('friendList', 'Ingen venner ennå. Søk etter et brukernavn og send en forespørsel.');
        state.friends.forEach(person => {
            const card = personCard(person);
            card.appendChild(button('Start kamp', () => chooseOpponent(person), ''));
            $('friendList').appendChild(card);
        });
        for (const [id, incoming] of [['incomingRequests', true], ['outgoingRequests', false]]) {
            $(id).replaceChildren();
            const pending = state.requests.filter(r => r.status === 'pending' && (incoming ? r.recipient_id : r.sender_id) === state.user.id);
            if (!pending.length) empty(id, incoming ? 'Ingen mottatte forespørsler.' : 'Ingen ventende forespørsler.');
            pending.forEach(req => {
                const peer = state.people.find(p => p.id === (incoming ? req.sender_id : req.recipient_id));
                if (!peer) return;
                const card = personCard(peer);
                if (incoming) {
                    const actions = doc.createElement('div'); actions.className = 'button-row';
                    for (const [label, accept] of [['Godta', true], ['Avslå', false]]) {
                        const control = button(label, () => work(control, 'friendsFeedback', async () => {
                            await request(api.respondRequest(req.id, accept)); await loadFriends();
                            feedback('friendsFeedback', accept ? 'Dere er nå venner.' : 'Forespørselen er avslått.');
                        }), accept ? '' : 'secondary');
                        actions.appendChild(control);
                    }
                    card.appendChild(actions);
                } else card.appendChild(text('span', 'Venter på svar', 'hint'));
                $(id).appendChild(card);
            });
        }
    }
    async function searchFriend() {
        const read = ++searchRead;
        $('searchResults').replaceChildren();
        const username = $('friendUsername').value.trim().toLowerCase();
        const person = await request(api.search(username));
        if (read !== searchRead) return;
        if (!person) { empty('searchResults', 'Fant ingen med dette brukernavnet.'); return; }
        const card = personCard(person);
        if (person.id === state.user.id) card.appendChild(text('p', 'Dette er din profil.', 'hint'));
        else if (state.friends.some(p => p.id === person.id)) card.appendChild(text('p', 'Dere er allerede venner.', 'hint'));
        else {
            const send = button('Send venneforespørsel', () => work(send, 'friendsFeedback', async () => {
                await request(api.sendRequest(person.username));
                $('searchResults').replaceChildren(); await loadFriends();
                feedback('friendsFeedback', 'Venneforespørsel sendt.');
            }), '');
            card.appendChild(send);
        }
        $('searchResults').appendChild(card);
    }
    async function chooseOpponent(person) {
        state.opponent = person; state.course = null;
        $('clubInput').value = ''; $('clubResults').replaceChildren(); $('courseNameTiles').replaceChildren(); $('teeTiles').replaceChildren();
        feedback('setupFeedback'); go('setup');
        await work($('retryCourses'), 'courseFeedback', loadCourses);
    }
    function renderSetup() {
        $('setupPlayers').replaceChildren(personCard(state.profile), personCard(state.opponent));
        $('courseConfirm').textContent = state.course
            ? `${state.course.club_name} · ${state.course.course_name} · Tee ${state.course.tee_name} · ${state.course.holes.length} hull`
            : '18 hull uten bane eller handicapslag.';
    }
    async function loadCourses() {
        feedback('courseFeedback', 'Henter baner …');
        state.courses = await request(api.courses());
        feedback('courseFeedback', state.courses.length ? '' : 'Ingen baner er registrert. Du kan spille uten bane.');
    }
    function searchClub() {
        const query = $('clubInput').value.trim().toLowerCase();
        state.course = null; renderSetup();
        $('clubResults').replaceChildren(); $('courseNameTiles').replaceChildren(); $('teeTiles').replaceChildren();
        if (!query) return;
        const clubs = [...new Set(state.courses.map(c => c.club_name))].filter(c => c.toLowerCase().includes(query)).sort();
        if (!clubs.length) empty('clubResults', 'Ingen klubber funnet.');
        for (const club of clubs) $('clubResults').appendChild(button(club, () => {
            $('clubInput').value = club; $('clubResults').replaceChildren(); $('courseNameTiles').replaceChildren();
            const names = [...new Set(state.courses.filter(c => c.club_name === club).map(c => c.course_name))].sort();
            for (const name of names) $('courseNameTiles').appendChild(button(name, event => {
                state.course = null; renderSetup(); $('teeTiles').replaceChildren();
                for (const el of $('courseNameTiles').querySelectorAll('button')) el.classList.toggle('selected', el === event.currentTarget);
                for (const tee of state.courses.filter(c => c.club_name === club && c.course_name === name)) {
                    $('teeTiles').appendChild(button(`Tee ${tee.tee_name}`, e => {
                        if (!Array.isArray(tee.holes) || !tee.holes.length) { feedback('courseFeedback', 'Denne banen mangler hulldata.', true); return; }
                        state.course = tee; feedback('courseFeedback'); renderSetup();
                        for (const el of $('teeTiles').querySelectorAll('button')) el.classList.toggle('selected', el === e.currentTarget);
                    }));
                }
            }));
        }));
    }
    async function startMatch() {
        if (!state.opponent) throw new Error('Velg en venn først.');
        const courseId = state.course ? String(state.course.id) : null;
        let attempt = readJournal('start');
        if (!attempt || attempt.opponent !== state.opponent.id || attempt.course !== courseId) {
            attempt = { id: win.crypto.randomUUID(), opponent: state.opponent.id, course: courseId };
            writeJournal('start', attempt);
        }
        feedback('setupFeedback', 'Oppretter kampen …');
        const match = await request(api.startMatch(attempt.id, attempt.opponent, attempt.course));
        writeJournal('start', null); state.match = match;
        go(`match/${match.id}`);
    }
    function renderMatchLists() {
        $('matchList').replaceChildren(); $('profileHistory').replaceChildren();
        const ordered = [...state.matches].sort((a,b) => b.created_at.localeCompare(a.created_at));
        if (!ordered.length) empty('matchList', 'Ingen kamper ennå. Start en kamp fra vennelisten.');
        for (const match of ordered) {
            const makeCard = () => {
                const link = doc.createElement('a'); link.className = 'history-card'; link.href = `#match/${match.id}`;
                link.append(text('h3', `Mot ${opponentName(match, state.user.id)}`),
                    text('p', `${outcome(match, state.user.id)} · ${match.final_result || (match.status === 'active' ? statusFor(match, match.player1_id === state.user.id ? 1 : 2) : 'Uten resultat')}`, 'result-label'),
                    text('p', date(match.finished_at || match.created_at), 'hint'));
                return link;
            };
            $('matchList').appendChild(makeCard());
            if (match.status === 'finished') $('profileHistory').appendChild(makeCard());
        }
        if (!state.matches.some(m => m.status === 'finished')) empty('profileHistory', 'Ferdigspilte kamper vises her.');
        const stats = statistics(state.matches, state.user.id);
        $('profileStats').replaceChildren();
        for (const [key, label] of [['played','Spilt'],['wins','Seiere'],['losses','Tap'],['draws','Delt']]) {
            const card = doc.createElement('div'); card.append(text('strong', stats[key]), text('span', label)); $('profileStats').appendChild(card);
        }
    }
    async function loadMatches() {
        empty('matchList', 'Henter kamper …'); empty('profileHistory', 'Henter historikk …');
        state.matches = await request(api.matches()); renderMatchLists();
    }
    async function loadMatch(id) {
        if (!/^[a-f0-9-]{36}$/i.test(id)) throw new Error('Ugyldig kamplenke.');
        const read = ++matchRead;
        $('scoreForm').hidden = true; $('cancelMatchButton').hidden = true;
        $('matchResult').hidden = true; $('holeResults').replaceChildren(); $('matchHeading').textContent = 'Henter kamp …';
        const [match, holes] = await request(Promise.all([api.match(id), api.holes(id)]));
        if (read !== matchRead) return;
        state.match = match; state.holes = holes;
        renderMatch();
    }
    function renderMatch() {
        const m = state.match, h = state.holes.find(h => h.hole === m.current_hole);
        $('matchHeading').textContent = m.status === 'active' ? 'Matchplay' : 'Kamp avsluttet';
        $('matchCourse').textContent = m.course_snapshot
            ? `${m.course_snapshot.club_name} · ${m.course_snapshot.course_name} · Tee ${m.course_snapshot.tee_name}` : '18 hull · Uten handicapslag';
        const played = state.holes.filter(h => h.score1 !== null).length;
        $('roundProgress').max = m.total_holes; $('roundProgress').value = played;
        $('matchProgress').textContent = `${played} av ${m.total_holes} hull spilt`;
        $('scoreForm').hidden = m.status !== 'active'; $('cancelMatchButton').hidden = m.status !== 'active';
        $('matchResult').hidden = m.status === 'active';
        if (m.status !== 'active') {
            $('matchResult').replaceChildren(text('h2', m.status === 'cancelled' ? 'Kampen ble avbrutt' : `${outcome(m, state.user.id)} · ${m.final_result}`),
                text('p', m.status === 'finished' ? 'Resultatet er lagret for begge spillere.' : 'Kampen teller ikke i statistikken.'));
        }
        if (m.status === 'active' && h) {
            $('holeTitle').textContent = `Hull ${h.hole}${h.par ? ` · Par ${h.par} · SI ${h.stroke_index}` : ''}`;
            $('scoringPlayers').replaceChildren();
            const pending = readJournal('hole');
            for (const side of [1,2]) {
                const box = doc.createElement('div'); box.className = 'score-box';
                const header = doc.createElement('div'); header.className = 'section-heading';
                header.append(text('h3', m[`player${side}_name`]), text('strong', statusFor(m, side), 'result-label'));
                const label = text('label', `Antall slag for ${m[`player${side}_name`]}`); label.htmlFor = `score${side}`;
                const input = doc.createElement('input'); input.id = `score${side}`; input.type = 'number'; input.inputMode = 'numeric';
                input.min = '1'; input.max = '30'; input.step = '1'; input.required = true;
                input.value = pending?.match === m.id && pending.hole === h.hole ? pending[`score${side}`] : (h.par || 4);
                const controls = doc.createElement('div'); controls.className = 'score-stepper';
                for (const delta of [-1,1]) {
                    const control = button(delta === -1 ? '−' : '+', () => {
                        input.value = Math.max(1, Math.min(30, (Number(input.value) || 1) + delta));
                    });
                    control.setAttribute('aria-label', `${delta < 0 ? 'Ett slag mindre' : 'Ett slag mer'} for ${m[`player${side}_name`]}`);
                    if (delta === -1) controls.appendChild(control); else controls.append(input, control);
                }
                box.append(header, text('p', `HCP ${number(m[`handicap${side}`])} · ${h[`strokes${side}`]} handicapslag på hullet`, 'hint'), label, controls);
                $('scoringPlayers').appendChild(box);
            }
            if (pending?.match === m.id && pending.hole === h.hole) feedback('scoreFeedback', 'Et scoreutkast er gjenopprettet. Bekreft for å prøve lagringen igjen.');
            else if (pending?.match === m.id && state.holes.some(row => row.hole === pending.hole && row.score1 !== null)) writeJournal('hole', null);
        }
        $('holeResults').replaceChildren();
        for (const row of state.holes.filter(h => h.score1 !== null)) {
            const card = doc.createElement('article'); card.className = 'hole-card';
            card.append(text('h3', `Hull ${row.hole}`), text('p', `${m.player1_name}: ${row.score1} · ${m.player2_name}: ${row.score2}`),
                text('p', row.winner_id ? `${row.winner_id === m.player1_id ? m.player1_name : m.player2_name} vant hullet` : 'Delt hull', 'hint'));
            $('holeResults').appendChild(card);
        }
        if (!played) empty('holeResults', 'Første hull venter. Registrer score over.');
    }
    async function submitScore() {
        const locationAtSave = win.location.hash;
        const m = state.match;
        if (!m || m.status !== 'active') return;
        const score1 = Number($('score1').value), score2 = Number($('score2').value);
        if (![score1,score2].every(n => Number.isInteger(n) && n >= 1 && n <= 30)) throw new Error('Velg en score mellom 1 og 30 for begge spillere.');
        const pending = { match: m.id, hole: m.current_hole, score1, score2 };
        writeJournal('hole', pending);
        feedback('scoreFeedback', 'Lagrer hullet …');
        const controls = [...$('scoreForm').querySelectorAll('input'), ...$('scoreForm').querySelectorAll('button'), $('refreshMatch'), $('cancelMatchButton')];
        const disabled = controls.map(control => control.disabled);
        controls.forEach(control => { control.disabled = true; });
        try {
            const match = await request(api.submitHole(m.id, m.current_hole, score1, score2));
            writeJournal('hole', null);
            if (win.location.hash !== locationAtSave) return;
            // Load the committed card instead of trusting optimistic client totals.
            await loadMatch(match.id);
            feedback('scoreFeedback', match.status === 'finished' ? 'Kampen og resultatet er lagret.' : 'Hullet er lagret.');
        } finally {
            controls.forEach((control, index) => { control.disabled = disabled[index]; });
        }
    }
    async function init() {
        form('authForm', 'authFeedback', async () => {
            const email = $('authEmail').value.trim(), password = $('authPassword').value;
            const redirect = win.location.origin + win.location.pathname;
            const result = state.signup ? await request(api.signup(email, password, redirect)) : await request(api.login(email, password));
            $('authPassword').value = '';
            if (result.session) await handleSession(result.session);
            else feedback('authFeedback', 'Sjekk e-posten din og bekreft kontoen. Deretter kan du logge inn.');
        });
        $('authModeButton').addEventListener('click', () => {
            state.signup = !state.signup;
            $('authTitle').textContent = state.signup ? 'Bli med i klubbhuset.' : 'Klar for en runde?';
            $('authSubmit').textContent = state.signup ? 'Opprett konto' : 'Logg inn';
            $('authModeButton').textContent = state.signup ? 'Har du konto? Logg inn' : 'Ny her? Opprett konto';
            $('authPassword').autocomplete = state.signup ? 'new-password' : 'current-password';
            $('authPassword').minLength = state.signup ? 8 : 1;
            feedback('authFeedback');
        });
        $('googleButton').addEventListener('click', () => work($('googleButton'), 'authFeedback', () => request(api.google(win.location.origin + win.location.pathname))));
        $('logoutButton').addEventListener('click', () => work($('logoutButton'), 'appMessage', async () => {
            await api.logout(); await handleSession(null); win.history.replaceState(null, '', '#home');
        }));
        form('onboardingForm', 'onboardingFeedback', async () => {
            const fields = profileFields($('newUsername').value, $('newDisplayName').value, $('newHandicap').value);
            try { state.profile = await request(api.createProfile(state.user.id, fields)); }
            catch (error) {
                // A previous insert may have committed even if its response was lost.
                if (error.code !== '23505') throw error;
                const existing = await request(api.profile(state.user.id));
                if (!existing) throw error;
                state.profile = existing;
            }
            state.phase = 'ready'; go('home');
        });
        form('profileForm', 'profileFeedback', async () => {
            const fields = profileFields(state.profile.username, $('displayName').value, $('handicap').value);
            state.profile = await request(api.editProfile(state.user.id, fields)); feedback('profileFeedback', 'Profilen er oppdatert.');
        });
        form('friendSearchForm', 'friendsFeedback', searchFriend);
        $('refreshFriends').addEventListener('click', () => work($('refreshFriends'), 'friendsFeedback', loadFriends));
        $('refreshMatches').addEventListener('click', () => work($('refreshMatches'), 'matchesFeedback', loadMatches));
        $('refreshHistory').addEventListener('click', () => work($('refreshHistory'), 'historyFeedback', loadMatches));
        $('retryCourses').addEventListener('click', () => work($('retryCourses'), 'courseFeedback', loadCourses));
        $('clubInput').addEventListener('input', searchClub);
        $('clearCourse').addEventListener('click', () => { state.course = null; $('clubInput').value = ''; for (const id of ['clubResults','courseNameTiles','teeTiles']) $(id).replaceChildren(); renderSetup(); });
        $('startMatchButton').addEventListener('click', () => work($('startMatchButton'), 'setupFeedback', startMatch));
        $('refreshMatch').addEventListener('click', () => work($('refreshMatch'), 'scoreFeedback', () => loadMatch(win.location.hash.slice(7))));
        form('scoreForm', 'scoreFeedback', submitScore);
        $('cancelMatchButton').addEventListener('click', () => work($('cancelMatchButton'), 'scoreFeedback', async () => {
            if (!win.confirm('Avslutte kampen uten resultat? Den vil ikke telle i statistikken.')) return;
            await request(api.cancelMatch(state.match.id)); await loadMatch(state.match.id);
        }));
        win.addEventListener('hashchange', () => { route(); $('main').scrollIntoView({ block: 'start' }); });
        const { data } = client.auth.onAuthStateChange((_event, session) => {
            // Keep Supabase calls out of the Auth callback's internal lock.
            const event = ++authEvent;
            win.setTimeout(() => { if (event === authEvent) void handleSession(session); }, 0);
        });
        subscription = data.subscription;
        const initialEpoch = epoch;
        try {
            const session = await api.session();
            if (initialEpoch === epoch) await handleSession(session);
        }
        catch (error) { state.phase = 'auth'; show('auth'); feedback('authFeedback', errorMessage(error), true); }
    }
    return { init, state, handleSession, route, loadFriends, searchFriend, chooseOpponent, startMatch, loadMatches,
        loadMatch, submitScore, destroy: () => { epoch++; subscription?.unsubscribe(); } };
}
