// Runs the actual application script with a minimal DOM and isolated Supabase/storage doubles.
// No network requests or production database writes. Run: node --test GOLF/tests/flows.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'script.js'), 'utf8').replace(/^import .*;\n/, '');

class Element {
    constructor(tag = 'div') {
        this.tagName = tag; this.children = []; this.style = {}; this.dataset = {}; this.attributes = {};
        this.value = ''; this.hidden = false; this.disabled = false; this.listeners = {}; this.className = ''; this._text = '';
        this.classList = {
            contains: name => this.className.split(/\s+/).includes(name),
            add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/), ...names])].join(' ').trim(); },
            remove: (...names) => { this.className = this.className.split(/\s+/).filter(n => !names.includes(n)).join(' '); },
            toggle: (name, force) => { const on = force ?? !this.classList.contains(name); this.classList[on ? 'add' : 'remove'](name); return on; }
        };
    }
    get textContent() { return this._text + this.children.map(c => c.textContent).join(''); }
    set textContent(value) { this._text = String(value); this.children = []; this._html = ''; }
    set innerHTML(value) { this._html = value; this._text = ''; this.children = []; parse(value, this); }
    get innerHTML() { return this._html || ''; }
    append(...children) { children.forEach(c => this.appendChild(c)); }
    appendChild(child) { child.parent = this; this.children.push(child); return child; }
    replaceChildren(...children) { this._text = ''; this.children = []; this.append(...children); }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this); }
    setAttribute(key, value) { this.attributes[key] = String(value); if (key === 'class') this.className = value; if (key === 'id') this.id = value; if (key.startsWith('data-')) this.dataset[key.slice(5)] = value; }
    removeAttribute(key) { delete this.attributes[key]; }
    addEventListener(event, fn) { this.listeners[event] = fn; }
    querySelectorAll(selector) {
        const parts = selector.split(' ');
        const match = (el, part) => part[0] === '#' ? el.id === part.slice(1) : part[0] === '.' ? el.classList.contains(part.slice(1)) : part === '[data-view]' ? !!el.dataset.view : el.tagName === part;
        const nodes = [];
        const walk = node => node.children.forEach(child => { nodes.push(child); walk(child); }); walk(this);
        return nodes.filter(node => {
            if (!match(node, parts.at(-1))) return false;
            let ancestor = node.parent;
            for (let i = parts.length - 2; i >= 0; i--) {
                while (ancestor && !match(ancestor, parts[i])) ancestor = ancestor.parent;
                if (!ancestor) return false;
                ancestor = ancestor.parent;
            }
            return true;
        });
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    insertRow() { return this.appendChild(new Element('tr')); }
    insertCell() { return this.appendChild(new Element('td')); }
    createTHead() { return this.appendChild(new Element('thead')); }
    createTBody() { return this.appendChild(new Element('tbody')); }
    scrollIntoView() {}
    focus() {}
    showModal() { this.open = true; }
    close() { this.open = false; }
}
function parse(markup, root) {
    const stack = [root];
    const voids = new Set(['meta','link','input','br','hr','img']);
    for (const token of markup.matchAll(/<!--[\s\S]*?-->|<\/?([\w-]+)\b([^>]*)>|([^<]+)/g)) {
        if (!token[1]) { if (token[3]) stack.at(-1)._text += token[3]; continue; }
        const tag = token[1];
        if (token[0].startsWith('</')) { if (stack.length > 1) stack.pop(); continue; }
        const el = new Element(tag);
        for (const attr of token[2].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) el.setAttribute(attr[1], attr[2] ?? '');
        el.hidden = Object.hasOwn(el.attributes, 'hidden');
        el.disabled = Object.hasOwn(el.attributes, 'disabled');
        stack.at(-1).appendChild(el);
        if (!voids.has(tag)) stack.push(el);
    }
}
const fixturePlayers = [{ id: 1, name: 'Ada Berg', hcp: 10 }, { id: 2, name: 'Jon Moen', hcp: 19 }, { id: 3, name: 'Liv Sol', hcp: null }];
const fixtureCourse = { club_name: 'Test Golfklubb', course_name: 'Skogen', tee_name: '48', holes: Array.from({length:9}, (_,i) => ({hole:i+1, par:4, stroke_index:i*2+1})) };
async function app(options = {}) {
    const document = new Element('document'); parse(html, document);
    document.getElementById = id => document.querySelector('#' + id);
    document.createElement = tag => new Element(tag);
    const storage = new Map(options.storage || []), timers = new Map(), writes = [];
    let serial = 0, clock = 0;
    const data = { players: structuredClone(fixturePlayers), courses: [structuredClone(fixtureCourse)] };
    const fail = options.fail || {};
    const supabase = { from(table) {
        let insert;
        const query = {
            select() { return query; }, order() { return query; }, single() { return query; },
            insert(rows) { insert = rows[0]; writes.push({table, row:insert}); return query; },
            then(resolve, reject) {
                let response;
                if (fail[table]) response = {error: new Error('test failure'), data:null};
                else if (insert) { const row = {id:4,...insert}; data[table].push(row); response = {data:row,error:null}; }
                else response = {data:structuredClone(data[table]),error:null};
                return Promise.resolve(response).then(resolve,reject);
            }
        }; return query;
    }};
    const context = vm.createContext({ document, supabase, console:{error(){}},
        localStorage: {getItem:key=>storage.get(key) ?? null, setItem:(key,value)=> {if(options.storageBlocked) throw Error(); storage.set(key,value);}, removeItem:key=>storage.delete(key)},
        location: {hash:''}, history:{replaceState(_a,_b,hash){context.location.hash=hash;}},
        alert:()=>{}, confirm:()=>options.confirm !== false,
        setTimeout:(fn,delay)=>{const id=++serial;timers.set(id,{fn,at:clock+delay});return id;},
        clearTimeout:id=>timers.delete(id), setInterval:()=>0, clearInterval:()=>{},
    });
    context.window = context; context.addEventListener = ()=>{};
    vm.runInContext(script, context);
    await new Promise(resolve => setImmediate(resolve));
    const run = expression => vm.runInContext(expression, context);
    const tick = ms => {
        const end = clock+ms;
        while (true) {
            const next = [...timers].sort((a,b)=>a[1].at-b[1].at).find(([,t])=>t.at<=end);
            if (!next) break;
            clock = next[1].at; timers.delete(next[0]); next[1].fn();
        }
        clock=end;
    };
    return {run,tick,storage,writes,fail,document,el:id=>document.getElementById(id),
        start(course = false) {run(`selectPlayer(0); selectPlayer(1); ${course ? "selectTee(courses[0], document.createElement('button'));" : ''} createMatch();`);tick(200);},
        hole(a,b) {run(`selectScore(1,${a},document.createElement('button'));selectScore(2,${b},document.createElement('button'));`);tick(550);}
    };
}
test('every static JavaScript element reference exists exactly once in the HTML', () => {
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
    assert.equal(new Set(ids).size, ids.length);
    for (const [,id] of script.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) assert.ok(ids.includes(id), id);
});
test('dashboard uses real loaded values; handicap statistics and navigation work', async () => {
    const a=await app();
    assert.equal(a.el('playerCount').textContent,'3');
    assert.equal(a.el('averageHcp').textContent,'14,5');
    assert.equal(a.el('courseCount').textContent,'1');
    a.run("showView('statistikk')");
    assert.equal(a.el('statisticsSection').hidden,false);
    assert.equal(a.el('setupGrid').hidden,true);
    assert.match(a.el('handicapTable').textContent,/Ada Berg/);
    a.run("showView('spillere')");
    assert.equal(a.el('courseColumn').hidden,true);
});
test('registration keeps Supabase insert contract and renders names as text', async () => {
    const a=await app();
    a.el('playerName').value='<img src=x onerror=alert(1)>';
    a.el('playerHcp').value='0';
    await a.run('addPlayer()');
    assert.equal(a.writes.length,1);
    assert.equal(a.writes[0].table,'players');
    assert.equal(a.writes[0].row.hcp,0);
    assert.equal(a.el('players').querySelectorAll('img').length,0);
    assert.match(a.el('players').textContent,/<img/);
    assert.equal(a.el('playerCount').textContent,'4');
});
test('failed reads/inserts have retryable feedback and never invent data',async()=>{
    const a=await app({fail:{players:true,courses:true}});
    assert.match(a.el('players').textContent,/Prøv igjen/);
    assert.match(a.el('courseFeedback').textContent,/Prøv igjen/);
    a.el('playerName').value='Test'; await a.run('addPlayer()');
    assert.match(a.el('playerFeedback').textContent,/Kunne ikke lagre/);
    assert.equal(a.el('addPlayerButton').disabled,false);
    a.fail.players=false; await a.run('loadPlayers()');
    assert.equal(a.el('playerCount').textContent,'3');
});
test('club search → course → tee preserves nine-hole handicap distribution',async()=>{
    const a=await app();
    a.el('clubInput').value='test';a.run('onClubInput()');
    assert.equal(a.el('clubResults').children.length,1);
    a.el('clubResults').children[0].onclick();
    a.el('courseNameTiles').children[0].onclick();
    a.el('teeTiles').children[0].onclick();
    assert.equal(a.el('setupHoles').textContent,'9');
    a.start();
    assert.equal(a.run('match.holes'),9);
    assert.equal(a.run('match.strokesReceiver'),2);
    assert.equal(a.run('strokesOnHole(1)'),1);
    a.hole(4,5);assert.equal(a.run('match.results[0].winner'),'Delt');
});
test('rapid repeated score clicks submit exactly one hole',async()=>{
    const a=await app();a.start();
    a.run("selectScore(1,4,document.createElement('button'));selectScore(2,5,document.createElement('button'));selectScore(2,6,document.createElement('button'));selectScore(1,3,document.createElement('button'));");
    a.tick(1000);
    assert.equal(a.run('match.results.length'),1);
    assert.equal(a.run('match.results[0].score2'),5);
    assert.equal(a.run('match.currentHole'),2);
    a.run('submitHole()');assert.equal(a.run('match.results.length'),1);
});
test('active match survives refresh; expired/malformed state is discarded',async()=>{
    const a=await app();a.start();a.hole(4,5);
    const restored=await app({storage:[...a.storage]});
    assert.equal(restored.run('match.currentHole'),2);
    assert.equal(restored.el('matchSection').style.display,'block');
    assert.match(restored.el('holeResults').textContent,/Ada Berg/);
    const state=JSON.parse(a.storage.get('activeGolfMatch'));state.savedAt=Date.now()-7*3600000;
    const expired=await app({storage:[['activeGolfMatch',JSON.stringify(state)]]});
    assert.equal(expired.storage.has('activeGolfMatch'),false);
    const malformed=await app({storage:[['activeGolfMatch','null']]});
    assert.equal(malformed.storage.has('activeGolfMatch'),false);
});
test('early victory shows final result, clears save and prevents further scores',async()=>{
    const a=await app();a.start();
    for(let i=0;i<10;i++)a.hole(4,5);
    assert.equal(a.run('match.active'),false);
    assert.match(a.el('matchResultText').textContent,/10&8/);
    assert.equal(a.el('celebrationOverlay').open,true);
    assert.equal(a.storage.has('activeGolfMatch'),false);
    a.hole(3,4);assert.equal(a.run('match.results.length'),10);
    a.run('closeCelebration()');assert.equal(a.el('celebrationOverlay').open,false);
    a.run('backToPlayers()');a.start();a.hole(5,4);
    assert.equal(a.run('match.results.length'),1);
    assert.equal(a.run('match.score2'),1);
});
test('18 tied holes finish All Square',async()=>{
    const a=await app();a.start();for(let i=0;i<18;i++)a.hole(4,4);
    assert.equal(a.run('match.active'),false);
    assert.match(a.el('matchResultText').textContent,/All Square/);
    assert.equal(a.el('roundProgressText').textContent,'18 av 18 hull spilt');
});
test('navigation preserves active match; canceling exit preserves state',async()=>{
    const a=await app({confirm:false});a.start();a.hole(4,5);
    a.run("showView('oversikt');showView('spillere');showView('matchplay');backToPlayers()");
    assert.equal(a.run('match.active'),true);
    assert.equal(a.run('match.currentHole'),2);
    assert.equal(a.el('matchSection').style.display,'block');
});
test('ending during pending submission cancels old callbacks and selections',async()=>{
    const a=await app();a.start();
    a.run("selectScore(1,4,document.createElement('button'));selectScore(2,5,document.createElement('button'));backToPlayers()");
    a.start();a.tick(1000);assert.equal(a.run('match.results.length'),0);
});
test('blocked local storage leaves scoring usable with a visible notice',async()=>{
    const a=await app({storageBlocked:true});a.start();a.hole(4,5);
    assert.equal(a.run('match.currentHole'),2);
    assert.equal(a.el('appNotice').hidden,false);
});
test('mobile home is an overview, with four working navigation destinations',async()=>{
    const a=await app();
    assert.equal(a.el('setupGrid').hidden,true);
    assert.equal(a.el('homeContent').hidden,false);
    const links=a.document.querySelectorAll('[data-view]');
    assert.equal(links.length,4);
    for(const link of links){
        a.run(`showView('${link.dataset.view}')`);
        assert.equal(link.attributes['aria-current'],'page');
        assert.equal(links.filter(l=>l.classList.contains('active')).length,1);
    }
});
test('form submit prevents navigation and submits one player record',async()=>{
    const a=await app();let prevented=false;
    a.el('playerName').value='Mia Dal';a.el('playerHcp').value='';
    a.el('playerForm').listeners.submit({preventDefault(){prevented=true;}});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(prevented,true);assert.equal(a.writes.length,1);
    assert.equal(a.writes[0].row.hcp,null);
    a.el('playerName').value='Bad handicap';a.el('playerHcp').value='999';
    await a.run('addPlayer()');assert.equal(a.writes.length,1);
});
test('home match card and player statistics reflect the current match only',async()=>{
    const a=await app();a.start();a.hole(4,5);
    a.run("showView('oversikt')");
    assert.match(a.el('recentMatch').textContent,/Ada Berg/);
    assert.match(a.el('recentMatch').textContent,/Pågår/);
    a.run("showView('spillere')");
    assert.match(a.el('players').textContent,/1 hull vunnet i denne kampen/);
    assert.match(a.el('players').textContent,/Kamphistorikk ikke registrert/);
});
test('mobile result cells carry labels and handicap chart counts valid players',async()=>{
    const a=await app();a.start();a.hole(4,5);
    const cells=a.el('holeResults').querySelectorAll('td');
    assert.equal(cells[0].attributes['data-label'],'Hull');
    assert.equal(cells[1].attributes['data-label'],'Ada Berg');
    assert.equal(cells[2].attributes['data-label'],'Jon Moen');
    assert.equal(a.el('hcpChart').children.length,4);
    assert.match(a.el('hcpChart').children[1].attributes['aria-label'],/2 spillere/);
});
test('new-match quick action after a completed round opens a fresh setup',async()=>{
    const a=await app();a.start();for(let i=0;i<10;i++)a.hole(4,5);
    a.run("showView('oversikt')");
    assert.match(a.el('recentMatch').textContent,/Ferdigspilt/);
    a.el('primaryAction').listeners.click();
    assert.equal(a.run('match.player1'),null);
    assert.equal(a.el('setupGrid').hidden,false);
});
test('a partial score cannot bleed into a new match',async()=>{
    const a=await app();a.start();
    a.run("selectScore(1,4,document.createElement('button'));backToPlayers()");
    a.start();a.run("selectScore(2,5,document.createElement('button'))");a.tick(1000);
    assert.equal(a.run('match.results.length'),0);
});
