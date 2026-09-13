import { supabase } from './supabase.js';

let players = [];

let selectedPlayers = [];

let courses = [];
let selectedCourse = null;
let selectedClub = null;
let selectedCourseName = null;

let match = {
    active: false,
    player1: null,
    player2: null,
    holes: 18,
    currentHole: 1,
    score1: 0,
    score2: 0,
    results: [],
    course: null,
    strokesReceiver: 0,
    strokeDiff: 0
};

let selectedScore1 = null;
let selectedScore2 = null;
let submitTimer = null;
let renderTimer = null;
let holeLocked = false;
let playersLoaded = false;
let coursesLoaded = false;
let currentView = 'oversikt';
let celebrationReturnFocus = null;


// -------------------------
// SPILLERE
// -------------------------

async function addPlayer() {
    const nameInput = document.getElementById('playerName');
    const hcpInput = document.getElementById('playerHcp');
    const button = document.getElementById('addPlayerButton');
    const name = nameInput.value.trim();
    const rawHcp = hcpInput.value.trim();
    const hcp = rawHcp === '' ? null : Number(rawHcp);
    if (!name || (hcp !== null && (!Number.isFinite(hcp) || hcp < -10 || hcp > 54))) {
        setFeedback('playerFeedback', 'Skriv inn navn og et gyldig handicap mellom −10 og 54.', true);
        return;
    }
    if (button.disabled) return;
    button.disabled = true;
    setFeedback('playerFeedback', 'Lagrer spilleren …');
    try {
        const { data, error } = await supabase.from('players')
            .insert([{ name, hcp }]).select().single();
        if (error) throw error;
        players.push(data);
        nameInput.value = '';
        hcpInput.value = '';
        updatePlayers();
        setFeedback('playerFeedback', `${name} er lagt til.`);
    } catch (error) {
        console.error(error);
        setFeedback('playerFeedback', 'Kunne ikke lagre spilleren. Prøv igjen.', true);
    } finally {
        button.disabled = false;
    }
}


async function loadPlayers() {
    try {
        const { data, error } = await supabase.from('players').select('*').order('id', { ascending: true });
        if (error) throw error;
        players = data || [];
        playersLoaded = true;
        updatePlayers();
    } catch (error) {
        console.error(error);
        document.getElementById('players').innerHTML = '<p class="empty-state">Spillerne kunne ikke lastes. <button class="secondary" onclick="retryPlayers()">Prøv igjen</button></p>';
        setFeedback('playerFeedback', 'Sjekk forbindelsen og prøv igjen.', true);
    }
}


// -------------------------
// BANER
// -------------------------

async function loadCourses() {
    try {
        const { data, error } = await supabase.from('courses').select('*')
            .order('club_name', { ascending: true }).order('course_name', { ascending: true }).order('tee_name', { ascending: true });
        if (error) throw error;
        courses = data || [];
        coursesLoaded = true;
        setFeedback('courseFeedback', courses.length ? '' : 'Ingen baner er registrert ennå. Du kan spille uten bane.');
        updateDashboard();
        if (document.getElementById('clubInput').value && !selectedCourse) onClubInput();
    } catch (error) {
        console.error(error);
        const feedback = document.getElementById('courseFeedback');
        feedback.classList.add('error');
        feedback.innerHTML = 'Banene kunne ikke lastes. <button class="secondary" onclick="retryCourses()">Prøv igjen</button>';
    }
}


function onClubInput() {
    const value = document.getElementById('clubInput').value.trim().toLowerCase();
    const resultsDiv = document.getElementById('clubResults');
    resultsDiv.innerHTML = '';

    selectedClub = null;
    selectedCourseName = null;
    selectedCourse = null;
    document.getElementById('setupHoles').textContent = '18';

    document.getElementById('courseConfirm').style.display = 'none';

    const courseNameTiles = document.getElementById('courseNameTiles');
    const teeTiles = document.getElementById('teeTiles');
    courseNameTiles.style.display = 'none';
    courseNameTiles.innerHTML = '';
    teeTiles.style.display = 'none';
    teeTiles.innerHTML = '';

    if (!value) {
        resultsDiv.style.display = 'none';
        return;
    }

    const clubs = [...new Set(courses.map(c => c.club_name))]
        .filter(club => club.toLowerCase().includes(value))
        .sort();

    if (clubs.length === 0) {
        resultsDiv.innerHTML = '<div class="course-result">Ingen klubber funnet.</div>';
        resultsDiv.style.display = 'block';
        return;
    }

    clubs.forEach(club => {
        const div = document.createElement('button');
        div.type = 'button';
        div.className = 'course-result';
        div.textContent = club;
        div.onclick = () => chooseClub(club);
        resultsDiv.appendChild(div);
    });

    resultsDiv.style.display = 'block';
}


function chooseClub(club) {
    selectedClub = club;
    document.getElementById('clubInput').value = club;
    document.getElementById('clubResults').innerHTML = '';
    document.getElementById('clubResults').style.display = 'none';
    renderCourseNameTiles();
}


function renderCourseNameTiles() {
    const courseNameTiles = document.getElementById('courseNameTiles');
    courseNameTiles.innerHTML = '';

    const names = [...new Set(
        courses.filter(c => c.club_name === selectedClub).map(c => c.course_name)
    )].sort();

    names.forEach(name => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tile-button';
        btn.textContent = name;
        btn.onclick = () => selectCourseName(name, btn);
        courseNameTiles.appendChild(btn);
    });

    courseNameTiles.style.display = 'flex';
    courseNameTiles.classList.remove('select-appear');
    void courseNameTiles.offsetWidth;
    courseNameTiles.classList.add('select-appear');
}


function selectCourseName(name, btn) {
    selectedCourseName = name;
    selectedCourse = null;
    document.getElementById('setupHoles').textContent = '18';
    document.getElementById('courseConfirm').style.display = 'none';

    document.querySelectorAll('#courseNameTiles .tile-button')
        .forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    renderTeeTiles();
}


function renderTeeTiles() {
    const teeTiles = document.getElementById('teeTiles');
    teeTiles.innerHTML = '';

    const tees = courses.filter(
        c => c.club_name === selectedClub && c.course_name === selectedCourseName
    );

    tees.forEach(c => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'tile-button';
        btn.textContent = `Tee ${c.tee_name}`;
        btn.onclick = () => selectTee(c, btn);
        teeTiles.appendChild(btn);
    });

    teeTiles.style.display = 'flex';
    teeTiles.classList.remove('select-appear');
    void teeTiles.offsetWidth;
    teeTiles.classList.add('select-appear');
}


function selectTee(course, btn) {
    if (!Array.isArray(course.holes) || !course.holes.length) {
        setFeedback('courseFeedback', 'Denne banen mangler hulldata. Velg en annen tee eller spill uten bane.', true);
        return;
    }
    setFeedback('courseFeedback', '');
    selectedCourse = course;
    document.getElementById('setupHoles').textContent = course.holes.length;

    document.querySelectorAll('#teeTiles .tile-button')
        .forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');

    const courseConfirm = document.getElementById('courseConfirm');
    document.getElementById('courseConfirmText').textContent =
        `${course.club_name} — ${course.course_name} — Tee ${course.tee_name}`;

    courseConfirm.style.display = 'block';
    courseConfirm.classList.remove('select-appear');
    void courseConfirm.offsetWidth;
    courseConfirm.classList.add('select-appear');
}


// -------------------------
// MIDLERTIDIG LAGRING (REFRESH-SIKKER MATCH)
// -------------------------

const MATCH_STORAGE_KEY = 'activeGolfMatch';
const MATCH_EXPIRY_HOURS = 6;

function saveMatchState() {
    try {
        localStorage.setItem(MATCH_STORAGE_KEY, JSON.stringify({ savedAt: Date.now(), match }));
    } catch (error) {
        showNotice('Kampen kan ikke lagres i denne nettleseren. Hold siden åpen mens du spiller.');
    }
}

function clearMatchState() {
    try { localStorage.removeItem(MATCH_STORAGE_KEY); } catch (error) { /* Storage can be disabled. */ }
}

function tryRestoreMatch() {
    let state;
    try {
        const raw = localStorage.getItem(MATCH_STORAGE_KEY);
        if (!raw) return;
        state = JSON.parse(raw);
        const saved = state?.match;
        if (!Number.isFinite(state?.savedAt) || Date.now() - state.savedAt > MATCH_EXPIRY_HOURS * 3600000 ||
            !saved?.active || !saved.player1 || !saved.player2 || !Array.isArray(saved.results) ||
            !Number.isInteger(saved.holes) || saved.holes < 1 || !Number.isInteger(saved.currentHole) ||
            saved.currentHole < 1 || saved.currentHole > saved.holes ||
            (saved.course && (!Array.isArray(saved.course.holes) || !saved.course.holes.length))) {
            clearMatchState();
            return;
        }
        match = saved;
    } catch (error) {
        clearMatchState();
        return;
    }
    document.getElementById('namePlayer1').textContent = match.player1.name;
    document.getElementById('namePlayer2').textContent = match.player2.name;
    document.getElementById('strokesBanner').style.display = 'none';
    showView('matchplay');
    updateMatch();
}


// -------------------------
// VELG SPILLERE TIL MATCH
// -------------------------

function selectPlayer(index) {

    if (selectedPlayers.includes(index)) {

        selectedPlayers =
            selectedPlayers.filter(i => i !== index);

    } else {

        if (selectedPlayers.length >= 2) {
            alert("Du kan bare velge to spillere til en Matchplay.");
            return;
        }

        selectedPlayers.push(index);
    }

    updatePlayers();
}


function updateMatchButton() {
    const ready = selectedPlayers.length === 2;
    document.getElementById('createMatchButton').disabled = !ready;
    document.getElementById('selectionCount').textContent = `${selectedPlayers.length} av 2 valgt`;
    document.getElementById('selectionHint').textContent = ready
        ? 'Spillerne er klare. Velg bane og start matchen.' : 'Velg to spillere for å starte.';
}


function updatePlayers() {
    const container = document.getElementById('players');
    container.replaceChildren();
    if (!players.length) container.innerHTML = '<p class="empty-state">Klubbhuset venter på sine første spillere.<br>Legg til en spiller over for å komme i gang.</p>';
    players.forEach((player, index) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'player';
        const selected = selectedPlayers.includes(index);
        button.classList.toggle('selected', selected);
        button.setAttribute('aria-pressed', String(selected));
        button.setAttribute('aria-label', `${player.name}, handicap ${player.hcp ?? 'ikke registrert'}`);
        const avatar = document.createElement('span');
        avatar.className = 'avatar';
        avatar.setAttribute('aria-hidden', 'true');
        avatar.textContent = initials(player.name);
        const name = document.createElement('span');
        name.className = 'player-info';
        name.textContent = player.name;
        const hcp = document.createElement('span');
        hcp.className = 'player-hcp';
        hcp.textContent = formatHcp(player.hcp);
        const check = document.createElement('span');
        check.className = 'selection-mark';
        check.textContent = '✓';
        check.setAttribute('aria-hidden', 'true');
        button.append(avatar, name, hcp, check);
        button.onclick = () => selectPlayer(index);
        container.appendChild(button);
    });
    updateMatchButton();
    updateDashboard();
}


// -------------------------
// OPPRETT MATCH
// -------------------------

function createMatch() {

    if (selectedPlayers.length !== 2) {
        return;
    }

    document.getElementById("playersSection").style.display = "none";
    document.getElementById("courseSection").style.display = "none";

    document.getElementById("matchResultPanel").style.display = "none";
    document.getElementById("holeNumber").style.display = "";
    document.getElementById("scoreboardArea").style.display = "";

    resetHoleInput();
    match.active = true;
    match.player1 = players[selectedPlayers[0]];
    match.player2 = players[selectedPlayers[1]];
    match.currentHole = 1;
    match.score1 = 0;
    match.score2 = 0;
    match.results = [];

    match.course = selectedCourse;
    match.holes = match.course ? match.course.holes.length : 18;

    if (match.course) {
        const hcp1 = match.player1.hcp ?? 0;
        const hcp2 = match.player2.hcp ?? 0;
        const diff = Math.round(Math.abs(hcp1 - hcp2));

        match.strokesReceiver = hcp1 > hcp2 ? 1 : (hcp2 > hcp1 ? 2 : 0);
        match.strokeDiff = diff;
    } else {
        match.strokesReceiver = 0;
        match.strokeDiff = 0;
    }

    document.getElementById("matchSection").style.display = "block";

    document.getElementById("namePlayer1").textContent =
        match.player1.name;

    document.getElementById("namePlayer2").textContent =
        match.player2.name;

    showView('matchplay');
    showStrokesBanner();

    createScoreButtons();

    updateMatch();

    document.getElementById("matchSection")
        .scrollIntoView({ behavior: "smooth" });

    saveMatchState();
    updateDashboard();
}


// -------------------------
// HCP-SLAG PER HULL
// -------------------------

function strokesOnHole(holeNumber) {
    if (!match.course || match.strokeDiff === 0) {
        return 0;
    }

    const totalHoles = match.course.holes.length;

    // Ranger hullene etter stroke index (1 = vanskeligst), uavhengig av om
    // banen bruker 1–18 (kombinasjoner) eller 1,3,5...17 (enkle 9-hulls-løyfer)
    const sortedByDifficulty = [...match.course.holes]
        .sort((a, b) => a.stroke_index - b.stroke_index);

    const rank = sortedByDifficulty.findIndex(h => h.hole === holeNumber) + 1;

    if (rank === 0) {
        return 0;
    }

    const base = Math.floor(match.strokeDiff / totalHoles);
    const extra = (rank <= (match.strokeDiff % totalHoles)) ? 1 : 0;

    return base + extra;
}


// -------------------------
// SLAG-BANNER
// -------------------------

function showStrokesBanner() {
    const banner = document.getElementById("strokesBanner");
    banner.classList.remove("fade-out");

    if (!match.course) {
        banner.style.display = "none";
        return;
    }

    banner.style.display = "flex";

    const strokes1 = match.strokesReceiver === 1 ? match.strokeDiff : 0;
    const strokes2 = match.strokesReceiver === 2 ? match.strokeDiff : 0;

    document.getElementById("strokeChipName1").textContent = match.player1.name;
    document.getElementById("strokeChipName2").textContent = match.player2.name;

    document.getElementById("strokeChip1").classList.toggle("receiving", strokes1 > 0);
    document.getElementById("strokeChip2").classList.toggle("receiving", strokes2 > 0);

    animateCount("strokeChipValue1", strokes1);
    animateCount("strokeChipValue2", strokes2);
}


function hideStrokesBanner() {
    const banner = document.getElementById("strokesBanner");

    if (banner.style.display === "none" || banner.classList.contains("fade-out")) {
        return;
    }

    banner.classList.add("fade-out");

    setTimeout(() => {
        banner.style.display = "none";
        banner.classList.remove("fade-out");
    }, 400);
}


function animateCount(elementId, target) {
    const el = document.getElementById(elementId);
    el.textContent = "0";

    if (target === 0) {
        return;
    }

    let current = 0;
    const stepTime = Math.max(30, 600 / target);

    const interval = setInterval(() => {
        current++;
        el.textContent = current;
        if (current >= target) {
            clearInterval(interval);
        }
    }, stepTime);
}


// -------------------------
// SCORE-KNAPPER
// -------------------------

function getScoreRange(par) {
    if (par === 3) return { min: 2, max: 6 };
    if (par === 4) return { min: 2, max: 8 };
    if (par === 5) return { min: 3, max: 8 };
    return { min: 1, max: 10 };
}


function createScoreButtons() {

    const buttons1 =
        document.getElementById("scoreButtons1");

    const buttons2 =
        document.getElementById("scoreButtons2");

    buttons1.innerHTML = "";
    buttons2.innerHTML = "";

    let range = { min: 1, max: 10 };

    if (match.course) {
        const holeData = match.course.holes.find(h => h.hole === match.currentHole);
        if (holeData) {
            range = getScoreRange(holeData.par);
        }
    }

    for (let score = range.min; score <= range.max; score++) {

        buttons1.innerHTML += `
            <button
                class="score-button"
                onclick="selectScore(1, ${score}, this)">
                ${score}
            </button>
        `;

        buttons2.innerHTML += `
            <button
                class="score-button"
                onclick="selectScore(2, ${score}, this)">
                ${score}
            </button>
        `;
    }
}


function selectScore(player, score, button) {

    if (!match.active || holeLocked) return;
    if (player === 1) {
        selectedScore1 = score;
        document.querySelectorAll("#scoreButtons1 .score-button")
            .forEach(btn => btn.classList.remove("selected"));
    } else {
        selectedScore2 = score;
        document.querySelectorAll("#scoreButtons2 .score-button")
            .forEach(btn => btn.classList.remove("selected"));
    }

    button.classList.add("selected");

    if (selectedScore1 !== null && selectedScore2 !== null) {
        holeLocked = true;
        document.querySelectorAll('.score-button').forEach(btn => { btn.disabled = true; });
        submitTimer = setTimeout(submitHole, 350);
    }
}


// -------------------------
// REGISTRER HULL
// -------------------------

function submitHole() {
    clearTimeout(submitTimer);
    submitTimer = null;
    if (!match.active || selectedScore1 === null || selectedScore2 === null) return;

    let netScore1 = selectedScore1;
    let netScore2 = selectedScore2;

    if (match.strokesReceiver === 1) {
        netScore1 -= strokesOnHole(match.currentHole);
    } else if (match.strokesReceiver === 2) {
        netScore2 -= strokesOnHole(match.currentHole);
    }

    let winner = "Delt";

    if (netScore1 < netScore2) {

        match.score1++;
        winner = match.player1.name;

    } else if (netScore2 < netScore1) {

        match.score2++;
        winner = match.player2.name;
    }

    match.results.push({
        hole: match.currentHole,
        score1: selectedScore1,
        score2: selectedScore2,
        winner: winner
    });

    match.currentHole++;

    selectedScore1 = null;
    selectedScore2 = null;

    updateMatch();
    saveMatchState();

    // Hvor mange hull er igjen?
    const holesRemaining =
        match.holes - match.currentHole + 1;

    // Sjekk om en spiller har vunnet matchen
    const lead =
        Math.abs(match.score1 - match.score2);

    if (lead > holesRemaining) {
        finishMatch(holesRemaining);
        return;
    }

    // Hvis alle hull er spilt
    if (match.currentHole > match.holes) {
        finishMatch(0);
    }
}


// -------------------------
// OPPDATER MATCH
// -------------------------

function updateMatch() {
    clearTimeout(renderTimer);
    if (match.currentHole > 1) hideStrokesBanner();
    const holeContent = document.getElementById('holeContent');
    const applyHoleContent = () => {
        const holeNumberEl = document.getElementById('holeNumber');
        const holeData = match.course?.holes.find(h => h.hole === match.currentHole);
        holeNumberEl.textContent = holeData
            ? `Hull ${match.currentHole} · Par ${holeData.par} · SI ${holeData.stroke_index}`
            : `Hull ${match.currentHole}`;
        const strokes = strokesOnHole(match.currentHole);
        document.getElementById('strokeBadge1').textContent = match.strokesReceiver === 1 && strokes ? `+${strokes}` : '';
        document.getElementById('strokeBadge2').textContent = match.strokesReceiver === 2 && strokes ? `+${strokes}` : '';
        updateStatus();
        updateResults();
        if (match.active) createScoreButtons();
        holeLocked = false;
        holeContent.classList.remove('fade-out-hole');
        holeContent.classList.add('fade-in-hole');
        updateDashboard();
        document.getElementById('matchCourseLabel').textContent = match.course
            ? `${match.course.club_name} · ${match.course.course_name} · Tee ${match.course.tee_name}`
            : '18 hull · Uten handicapslag';
        document.getElementById('roundProgressBar').style.width = `${Math.min(100, match.results.length / match.holes * 100)}%`;
        document.getElementById('roundProgressText').textContent = `${match.results.length} av ${match.holes} hull spilt`;
        document.getElementById('matchStateLabel').textContent = match.active ? 'Kamp pågår' : 'Ferdigspilt';
    };
    if (holeContent.dataset.rendered === 'true') {
        holeLocked = true;
        holeContent.classList.remove('fade-in-hole');
        holeContent.classList.add('fade-out-hole');
        renderTimer = setTimeout(applyHoleContent, 200);
    } else {
        holeContent.dataset.rendered = 'true';
        applyHoleContent();
    }
}


function updateStatus() {
    const status1 = document.getElementById("statusPlayer1");
    const status2 = document.getElementById("statusPlayer2");
    const diff = match.score1 - match.score2;

    if (diff === 0) {
        status1.textContent = "AS";
        status2.textContent = "AS";
    } else if (diff > 0) {
        status1.textContent = `${diff} UP`;
        status2.textContent = `${diff} NED`;
    } else {
        status1.textContent = `${Math.abs(diff)} NED`;
        status2.textContent = `${Math.abs(diff)} UP`;
    }
}


// -------------------------
// RESULTATER
// -------------------------

function updateResults() {
    const container = document.getElementById('holeResults');
    if (!match.results.length) {
        container.innerHTML = '<p class="empty-state">Første hull venter. Velg en score for hver spiller.</p>';
        return;
    }
    renderTable(container, ['Hull', match.player1.name, match.player2.name, 'Vinner'],
        match.results.map(result => [result.hole, result.score1, result.score2, result.winner]));
}


// -------------------------
// FERDIG MATCH
// -------------------------

function finishMatch(holesRemaining) {
    match.active = false;
    updateDashboard();

    const lead = Math.abs(match.score1 - match.score2);
    let resultMain;
    let resultSub = `Resultat: ${match.score1} - ${match.score2}`;

    if (lead === 0) {
        resultMain = "Delt match — All Square";
    } else {
        const winner = match.score1 > match.score2 ? match.player1 : match.player2;
        resultMain = holesRemaining > 0
            ? `${winner.name} vinner ${lead}&${holesRemaining}`
            : `${winner.name} vinner ${lead} UP`;
    }

    document.getElementById("holeNumber").style.display = "none";
    document.getElementById("scoreboardArea").style.display = "none";

    const panel = document.getElementById("matchResultPanel");
    document.getElementById("matchResultText").textContent = resultMain;
    document.getElementById("matchResultSub").textContent = resultSub;
    panel.style.display = "block";

    document.getElementById("celebrationWinner").textContent =
        lead === 0 ? "Delt match! 🤝" : `${resultMain} 🎉`;

    document.getElementById("celebrationScore").textContent = resultSub;

    launchConfetti();

    celebrationReturnFocus = document.activeElement;
    document.getElementById('celebrationOverlay').showModal();

    clearMatchState();
}


function launchConfetti() {
    const overlay = document.getElementById("celebrationOverlay");

    overlay.querySelectorAll(".confetti-piece").forEach(el => el.remove());

    const colors = ["#16a34a", "#facc15", "#3b82f6", "#ef4444", "#a855f7"];

    for (let i = 0; i < 40; i++) {
        const piece = document.createElement("div");
        piece.className = "confetti-piece";
        piece.style.left = Math.random() * 100 + "%";
        piece.style.background = colors[Math.floor(Math.random() * colors.length)];
        piece.style.animationDelay = (Math.random() * 0.5) + "s";
        piece.style.animationDuration = (2 + Math.random() * 1.5) + "s";
        overlay.appendChild(piece);
    }
}


function closeCelebration() {
    document.getElementById('celebrationOverlay').close();
    if (celebrationReturnFocus?.isConnected && !celebrationReturnFocus.disabled) celebrationReturnFocus.focus();
    else document.querySelector('#matchSection .btn-small').focus();
}


// -------------------------
// TILBAKE TIL SPILLERE
// -------------------------

function backToPlayers() {
    if (match.active && !confirm('Avslutte denne matchen? Hullresultatene blir ikke lagret.')) return;
    resetHoleInput();
    match.active = false;
    match.player1 = null;
    match.player2 = null;
    match.results = [];
    document.getElementById('celebrationOverlay').close();
    document.getElementById("matchSection").style.display = "none";
    document.getElementById("playersSection").style.display = "block";
    document.getElementById("courseSection").style.display = "block";
    selectedPlayers = [];
    updatePlayers();

    document.getElementById("clubInput").value = "";
    document.getElementById("courseNameTiles").style.display = "none";
    document.getElementById("courseNameTiles").innerHTML = "";
    document.getElementById("teeTiles").style.display = "none";
    document.getElementById("teeTiles").innerHTML = "";
    document.getElementById("courseConfirm").style.display = "none";
    selectedClub = null;
    selectedCourseName = null;
    selectedCourse = null;

    delete document.getElementById("holeContent").dataset.rendered;

    document.getElementById('clubResults').style.display = 'none';
    document.getElementById('clubResults').replaceChildren();
    document.getElementById('setupHoles').textContent = '18';
    clearMatchState();
    showView('matchplay');
    updateDashboard();
}


window.addPlayer = addPlayer;
window.selectPlayer = selectPlayer;
window.updatePlayers = updatePlayers;
window.createMatch = createMatch;
window.submitHole = submitHole;
window.selectScore = selectScore;
window.backToPlayers = backToPlayers;
window.closeCelebration = closeCelebration;
window.onClubInput = onClubInput;

document.getElementById('playerForm').addEventListener('submit', event => {
    event.preventDefault();
    addPlayer();
});
window.retryPlayers = loadPlayers;
window.retryCourses = loadCourses;
window.addEventListener('hashchange', () => showView(location.hash.slice(1)));
showView(location.hash.slice(1));
loadPlayers();
loadCourses();
tryRestoreMatch();

// Dashboard presentation. All figures come from the existing player/course data.
function formatHcp(value) {
    return value === null || value === undefined ? '—' : Number(value).toLocaleString('nb-NO', { maximumFractionDigits: 1 });
}
function initials(name) {
    return String(name).trim().split(/\s+/).slice(0, 2).map(part => part[0] || '').join('').toUpperCase();
}
function setFeedback(id, message, error = false) {
    const element = document.getElementById(id);
    element.textContent = message;
    element.classList.toggle('error', error);
}
function showNotice(message) {
    const element = document.getElementById('appNotice');
    element.textContent = message;
    element.hidden = false;
}
function resetHoleInput() {
    clearTimeout(submitTimer);
    clearTimeout(renderTimer);
    submitTimer = null;
    renderTimer = null;
    selectedScore1 = null;
    selectedScore2 = null;
    holeLocked = false;
}
function renderTable(container, headings, rows) {
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    headings.forEach(label => {
        const th = document.createElement('th');
        th.scope = 'col';
        th.textContent = label;
        head.appendChild(th);
    });
    const body = table.createTBody();
    rows.forEach(values => {
        const row = body.insertRow();
        values.forEach(value => { row.insertCell().textContent = value; });
    });
    container.replaceChildren(table);
}
function updateDashboard() {
    const withHcp = players.filter(p => p.hcp !== null && p.hcp !== undefined && Number.isFinite(Number(p.hcp)));
    document.getElementById('playerCount').textContent = playersLoaded ? players.length : '—';
    document.getElementById('averageHcp').textContent = withHcp.length
        ? formatHcp(withHcp.reduce((sum, p) => sum + Number(p.hcp), 0) / withHcp.length) : '—';
    document.getElementById('hcpCaption').textContent = `Handicap registrert for ${withHcp.length} spillere`;
    document.getElementById('courseCount').textContent = coursesLoaded
        ? new Set(courses.map(c => JSON.stringify([c.club_name, c.course_name]))).size : '—';
    document.getElementById('clubCount').textContent = coursesLoaded
        ? `Fordelt på ${new Set(courses.map(c => c.club_name)).size} golfklubber` : 'Henter baner …';
    document.getElementById('roundHeadline').textContent = match.active
        ? `${match.player1.name} mot ${match.player2.name}` : 'Hvem utfordrer du i dag?';
    document.getElementById('roundDescription').textContent = match.active
        ? `Hull ${match.currentHole} av ${match.holes} · Kampen din er klar til å fortsette.`
        : 'Velg to spillere og ta konkurransen ut på banen.';
    document.getElementById('roundAction').textContent = match.active ? 'Fortsett matchen ↗' : 'Sett opp en match ↗';
    document.getElementById('primaryAction').textContent = match.active ? 'Fortsett match ↗' : '＋ Ny match';
    const stats = document.getElementById('handicapTable');
    if (!playersLoaded) { stats.innerHTML = '<p class="empty-state">Laster spilleroversikten …</p>'; return; }
    if (!players.length) { stats.innerHTML = '<p class="empty-state">Legg til spillere for å se handicapoversikten.</p>'; return; }
    const sorted = [...players].sort((a,b) => (a.hcp ?? Infinity) - (b.hcp ?? Infinity));
    renderTable(stats, ['Spiller', 'Handicap', 'Status'], sorted.map(p => [p.name, formatHcp(p.hcp), p.hcp == null ? 'Handicap mangler' : 'Registrert']));
}
function showView(view) {
    const views = {
        oversikt: ['Oversikt', 'Velkommen til klubbhuset.', 'Gode runder starter med godt selskap.'],
        spillere: ['Spillere', 'Golf er bedre sammen.', 'Spillerne dine, samlet på ett sted.'],
        matchplay: ['Matchplay', 'Én mot én. Hull for hull.', 'Velg spillere, finn banen og la matchen begynne.'],
        statistikk: ['Statistikk', 'Bli kjent med feltet.', 'En oversikt over spillerne og deres registrerte handicap.']
    };
    currentView = views[view] ? view : 'oversikt';
    const [label, title, description] = views[currentView];
    document.title = `${label} · Golf League`;
    document.getElementById('breadcrumb').textContent = label;
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageDescription').textContent = description;
    document.querySelectorAll('[data-view]').forEach(link => {
        const active = link.dataset.view === currentView;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    document.getElementById('dashboardSection').hidden = !['oversikt', 'statistikk'].includes(currentView);
    document.querySelector('.dashboard-strip').hidden = currentView === 'statistikk';
    document.getElementById('statisticsSection').hidden = currentView !== 'statistikk';
    const hasMatch = !!match.player1;
    const showMatch = currentView === 'matchplay' && hasMatch;
    const showSetup = currentView === 'spillere' || ((currentView === 'oversikt' || currentView === 'matchplay') && !hasMatch);
    document.getElementById('setupGrid').hidden = !showSetup;
    document.getElementById('setupGrid').classList.toggle('players-only', currentView === 'spillere');
    document.getElementById('playersSection').style.display = '';
    document.getElementById('courseSection').style.display = '';
    document.getElementById('courseColumn').hidden = currentView === 'spillere';
    document.getElementById('matchSection').style.display = showMatch ? 'block' : 'none';
    // replaceState keeps create/restore on the same view without firing another render.
    if (location.hash !== `#${currentView}`) history.replaceState(null, '', `#${currentView}`);
}
