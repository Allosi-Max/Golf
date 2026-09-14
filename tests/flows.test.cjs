const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {Element,parse}=require('./dom.cjs');
const uuid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const profiles=[{id:uuid(1),username:'ada',display_name:'Ada Berg',handicap:10},{id:uuid(2),username:'jon',display_name:'Jon Moen',handicap:19}];
const fixtureMatch={id:uuid(100),player1_id:uuid(1),player2_id:uuid(2),player1_name:'Ada Berg',player2_name:'Jon Moen',handicap1:10,handicap2:19,total_holes:18,current_hole:1,holes_won1:0,holes_won2:0,status:'active',winner_id:null,final_result:null,created_at:'2026-09-14T10:00:00Z',finished_at:null,course_snapshot:null};
const holes=()=>Array.from({length:18},(_,i)=>({match_id:uuid(100),hole:i+1,par:null,stroke_index:null,strokes1:0,strokes2:0,score1:null,score2:null,winner_id:null}));
const flush=()=>new Promise(r=>setTimeout(r,5));
async function setup(options={}){
 const {createApp}=await import('../js/app.js');
 const doc=new Element('document');parse(fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),doc);
 doc.getElementById=id=>doc.querySelector('#'+id);doc.createElement=tag=>new Element(tag);doc.body=doc.querySelector('body');
 const calls=[],storage=new Map();let authCallback;let session=options.signedOut?null:{user:{id:uuid(1)}};
 const db={profiles:structuredClone(options.profiles||profiles),friendships:[{user_low:uuid(1),user_high:uuid(2),created_at:'2026-01-01'}],friend_requests:[],courses:[],matches:[],match_holes:holes()};
 const client={auth:{
  getSession:async()=>({data:{session},error:null}),
  onAuthStateChange:fn=>{authCallback=fn;return{data:{subscription:{unsubscribe(){}}}};},
  signInWithPassword:async args=>{calls.push(['login',args]);return{data:{session:{user:{id:uuid(1)}}},error:options.loginError?{message:'Invalid login credentials'}:null};},
  signUp:async args=>{calls.push(['signup',args]);return{data:{session:null},error:null};},
  signInWithOAuth:async args=>{calls.push(['google',args]);return{data:{},error:null};},
  signOut:async()=>{calls.push(['logout']);session=null;return{data:null,error:null};}
 },from(table){
  calls.push(['from',table]);let filters=[],single=false,write=null,range=null;
  const q={select(){return q;},order(){return q;},range(a,b){range=[a,b];return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},in(k,v){filters.push(r=>v.includes(r[k]));return q;},single(){single=true;return q;},maybeSingle(){single=true;return q;},
   insert(row){write=['insert',row];return q;},update(row){write=['update',row];return q;},
   async then(resolve,reject){try{
    if(options.defer && table==='profiles'&&!write)await options.defer;
    let rows=db[table].filter(r=>filters.every(f=>f(r)));
    if(write){calls.push([table,...write]);if(write[0]==='insert'){db[table].push({...write[1]});rows=[db[table].at(-1)];}else rows.forEach(r=>Object.assign(r,write[1]));}
    if(range)rows=rows.slice(range[0],range[1]+1);
    return resolve({data:structuredClone(single?(rows[0]||null):rows),error:null});
   }catch(e){return reject(e);}}
  };return q;
 },rpc:async(name,args)=>{
  calls.push(['rpc',name,args]);
  if(options.rpcError)return{data:null,error:{message:options.rpcError}};
  if(name==='start_match'){const m={...fixtureMatch,id:args.p_match_id};db.matches=[m];db.match_holes=holes().map(h=>({...h,match_id:m.id}));return{data:m,error:null};}
  if(name==='submit_match_hole'){
   const m=db.matches.find(m=>m.id===args.p_match_id),h=db.match_holes.find(h=>h.hole===args.p_hole);
   h.score1=args.p_score1;h.score2=args.p_score2;h.winner_id=m.player1_id;
   Object.assign(m,options.finished?{status:'finished',winner_id:m.player1_id,final_result:'10&8',finished_at:'2026-09-14T12:00:00Z',current_hole:11,holes_won1:10}:{current_hole:m.current_hole+1,holes_won1:m.holes_won1+1});
   return{data:structuredClone(m),error:null};
  }
  if(name==='send_friend_request'){db.friend_requests.push({id:uuid(50),sender_id:uuid(1),recipient_id:uuid(2),status:'pending'});return{data:db.friend_requests.at(-1),error:null};}
  if(name==='respond_friend_request'){db.friend_requests.find(r=>r.id===args.p_request_id).status=args.p_accept?'accepted':'declined';return{data:{},error:null};}
  return{data:{},error:null};
 }};
 const win={location:{hash:'#home',origin:'https://golf.example',pathname:'/index.html'},history:{replaceState(a,b,hash){win.location.hash=hash;}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},crypto:{randomUUID:()=>uuid(100)},setTimeout,addEventListener(){},confirm:()=>true};
 const app=createApp(client,{document:doc,window:win});const ready=app.init();if(!options.defer)await ready;
 return{app,doc,win,db,calls,storage,ready,options,el:id=>doc.getElementById(id),async submit(id){doc.getElementById(id).listeners.submit({preventDefault(){}});await flush();},async click(id){await doc.getElementById(id).listeners.click();await flush();},emit:async session=>{authCallback('SIGNED_IN',session);await flush();}};
}
test('signed-out gate makes no profile/data requests and guards private routes',async()=>{
 const a=await setup({signedOut:true});assert.equal(a.el('authView').hidden,false);assert.equal(a.calls.filter(c=>c[0]==='from').length,0);
 a.win.location.hash='#friends';a.app.route();assert.equal(a.el('authView').hidden,false);assert.equal(a.el('friendsView').hidden,true);
});
test('email login uses Supabase and clears password after success',async()=>{
 const a=await setup({signedOut:true});a.el('authEmail').value='ada@example.test';a.el('authPassword').value='test-only-password';await a.submit('authForm');
 assert.equal(a.calls.find(c=>c[0]==='login')[1].email,'ada@example.test');assert.equal(a.el('authPassword').value,'');assert.equal(a.app.state.phase,'ready');
});
test('failed login shows an error and signup handles email confirmation',async()=>{
 const a=await setup({signedOut:true,loginError:true});a.el('authEmail').value='ada@example.test';a.el('authPassword').value='test-only-password';await a.submit('authForm');
 assert.match(a.el('authFeedback').textContent,/Feil e-post/);await a.click('authModeButton');await a.submit('authForm');
 assert.match(a.el('authFeedback').textContent,/bekreft kontoen/);assert.equal(a.app.state.phase,'auth');
});
test('Google uses Supabase OAuth and correct return URL',async()=>{
 const a=await setup({signedOut:true});await a.click('googleButton');
 assert.deepEqual(a.calls.find(c=>c[0]==='google')[1],{provider:'google',options:{redirectTo:'https://golf.example/index.html'}});
});
test('missing profile is mandatory before friends or scoring',async()=>{
 const a=await setup({profiles:[]});assert.equal(a.app.state.phase,'onboarding');a.win.location.hash='#friends';a.app.route();assert.equal(a.el('onboardingView').hidden,false);
 a.el('newUsername').value='ADA';a.el('newDisplayName').value='Ada Berg';a.el('newHandicap').value='18.5';await a.submit('onboardingForm');
 const created=a.calls.find(c=>c[0]==='profiles'&&c[1]==='insert')[2];assert.equal(created.id,uuid(1));assert.equal(created.username,'ada');assert.equal(a.app.state.phase,'ready');
});
test('profile editing only sends display name and handicap',async()=>{
 const a=await setup();a.el('displayName').value='Ada New';a.el('handicap').value='8.5';await a.submit('profileForm');
 assert.deepEqual(a.calls.find(c=>c[0]==='profiles'&&c[1]==='update')[2],{display_name:'Ada New',handicap:8.5});
});
test('self search has no send button; friends can start setup with both handicaps',async()=>{
 const a=await setup();await a.app.loadFriends();a.el('friendUsername').value='ada';await a.app.searchFriend();
 assert.match(a.el('searchResults').textContent,/din profil/);assert.equal(a.el('searchResults').querySelectorAll('button').length,0);
 await a.app.chooseOpponent(profiles[1]);assert.match(a.el('setupPlayers').textContent,/Ada Berg/);assert.match(a.el('setupPlayers').textContent,/19/);assert.equal(a.el('setupView').hidden,false);
});
test('incoming requests expose accept/decline and send calls server RPC',async()=>{
 const a=await setup();a.db.friendships=[];await a.app.loadFriends();a.el('friendUsername').value='jon';await a.app.searchFriend();
 await a.el('searchResults').querySelector('button').listeners.click();assert.equal(a.calls.filter(c=>c[1]==='send_friend_request').length,1);
 a.db.friend_requests=[{id:uuid(50),sender_id:uuid(2),recipient_id:uuid(1),status:'pending'}];await a.app.loadFriends();
 const actions=a.el('incomingRequests').querySelectorAll('button');assert.equal(actions.length,2);await actions[0].listeners.click();assert.equal(a.calls.find(c=>c[1]==='respond_friend_request')[2].p_accept,true);
});
test('start retries keep the same ID; score retries preserve input and do not advance locally',async()=>{
 const a=await setup({rpcError:'Failed to fetch'});await a.app.chooseOpponent(profiles[1]);await a.click('startMatchButton');await a.click('startMatchButton');
 const calls=a.calls.filter(c=>c[1]==='start_match');assert.equal(calls[0][2].p_match_id,calls[1][2].p_match_id);
 assert.match(a.el('setupFeedback').textContent,/forbindelsen/);a.options.rpcError=null;await a.click('startMatchButton');await flush();
 a.options.rpcError='Failed to fetch';a.el('score1').value='3';a.el('score2').value='5';await a.submit('scoreForm');
 assert.equal(a.app.state.match.current_hole,1);assert.equal(a.el('score1').value,'3');assert.ok(a.storage.has(`golf.accounts.${uuid(1)}.hole`));
 a.options.rpcError=null;await a.submit('scoreForm');assert.equal(a.app.state.match.current_hole,2);assert.equal(a.storage.has(`golf.accounts.${uuid(1)}.hole`),false);
});
test('server final result renders history and statistics',async()=>{
 const a=await setup({finished:true});a.db.matches=[structuredClone(fixtureMatch)];await a.app.loadMatch(uuid(100));a.el('score1').value='4';a.el('score2').value='5';await a.app.submitScore();
 assert.equal(a.el('scoreForm').hidden,true);assert.match(a.el('matchResult').textContent,/10&8/);await a.app.loadMatches();
 assert.match(a.el('profileHistory').textContent,/Seier/);assert.match(a.el('profileHistory').textContent,/Jon Moen/);assert.match(a.el('profileStats').textContent,/1Spilt/);
});
test('logout clears private state and blocks stale in-flight profile responses',async()=>{
 const a=await setup();await a.app.loadFriends();await a.click('logoutButton');assert.equal(a.app.state.profile,null);assert.equal(a.el('friendList').textContent,'');assert.equal(a.el('appNav').hidden,true);
 let release;const deferred=new Promise(r=>release=r);const b=await setup({defer:deferred});await b.app.handleSession(null);release();await b.ready;
 assert.equal(b.app.state.profile,null);assert.equal(b.app.state.phase,'auth');assert.equal(b.el('homeView').hidden,true);
});
test('profile validation and results distinguish draws and cancelled rounds',async()=>{
 const {profileFields,statistics,statusFor}=await import('../js/match.js');assert.throws(()=>profileFields('ab','Ada','10'));
 assert.throws(()=>profileFields('ada','Ada',''));assert.throws(()=>profileFields('ada','Ada','99'));assert.throws(()=>profileFields('ada','Ada','1.23'));
 assert.equal(profileFields('ADA',' Ada ','0').username,'ada');assert.equal(statusFor({...fixtureMatch,holes_won1:3},2),'3 NED');
 assert.deepEqual(statistics([{...fixtureMatch,status:'finished',winner_id:null},{...fixtureMatch,status:'cancelled'}],uuid(1)),{played:1,wins:0,losses:0,draws:1});
});
