const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const migration=name=>fs.readFileSync(path.join(__dirname,'../supabase/migrations',name),'utf8');
// SI deliberately differs from hole number; JSON order is also reversed.
const indices=[12,5,17,1,11,2,3,4,6,7,8,9,10,13,14,15,16,18];
const ones=n=>Array(n).fill(1);
const zeros=n=>Array(n).fill(0);

test('individual Stroke Index allowances and authoritative net scoring',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;
 grant execute on function auth.uid() to anon,authenticated;
 create table courses(id integer primary key,club_name text,course_name text,tee_name text,holes jsonb,slope_rating numeric default 113,course_rating numeric default 72,par_total numeric default 72);
 insert into auth.users values('${id(1)}'),('${id(2)}');`);
 const course=indices.map((si,i)=>({hole:i+1,par:4,stroke_index:si})).reverse();
 await db.query('insert into courses(id,club_name,course_name,tee_name,holes) values(1,$1,$2,$3,$4)',['Club','18 holes','48',JSON.stringify(course)]);
 await db.query('insert into courses(id,club_name,course_name,tee_name,holes) values(2,$1,$2,$3,$4)',['Club','Odd SI nine','48',JSON.stringify(Array.from({length:9},(_,i)=>({hole:i+1,par:4,stroke_index:i*2+1})))]);
 await db.exec(migration('202609140001_accounts.sql'));
 await db.exec(`insert into profiles(id,username,display_name,handicap) values('${id(1)}','player_a','Player A',10),('${id(2)}','player_b','Player B',15);
 insert into friendships(user_low,user_high) values('${id(1)}','${id(2)}');`);
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id(1)]);
 const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
 let serial=100, rated=false;
 async function start(a,b,courseId='1',slope=113,cr=72,par=72){
  await db.exec('reset role');
  await db.query('update profiles set handicap=$1 where id=$2',[a,id(1)]);
  await db.query('update profiles set handicap=$1 where id=$2',[b,id(2)]);
  if(rated && courseId) await db.query('update courses set slope_rating=$1,course_rating=$2,par_total=$3 where id::text=$4',[slope,cr,par,courseId]);
  await db.exec('set role authenticated');
  return one('select * from start_match($1,$2,$3)',[id(++serial),id(2),courseId]);
 }
 const rows=async m=>(await db.query('select * from match_holes where match_id=$1 order by stroke_index',[m.id])).rows;
 const old=await start(10,15);
 await one('select * from submit_match_hole($1,1,4,4)',[old.id]);
 const oldRows=await rows(old);
 const oldMatch=await one('select * from matches where id=$1',[old.id]);
 await db.exec('reset role');
 await db.exec(migration('202609170001_individual_si_allowances.sql'));
 await db.exec(migration('202609170002_course_handicap.sql'));
 await db.exec(migration('202609170003_stored_tee_ratings.sql'));rated=true;
 await db.exec('set role authenticated');
 await t.test('upgrade preserves existing allocations, scores and match identity',async()=>{
  assert.deepEqual(await rows(old),oldRows);
  assert.deepEqual(await one('select * from matches where id=$1',[old.id]),{...oldMatch,course_handicap1:null,course_handicap2:null,playing_handicap1:null,playing_handicap2:null,handicap_allowance:null});
  assert.equal((await one('select * from start_match($1,$2,$3)',[old.id,id(2),'1'])).id,old.id);
  assert.deepEqual(await rows(old),oldRows);
 });
 await t.test('Course Handicap: ratings, decimals, final rounding and independent Playing Handicap snapshots',async()=>{
  const {courseHandicap,teeSettings}=await import('../js/course-handicap.js');
  const cases=[
   [12.2,17.2,113,75,72,15,20],
   [12.2,17.2,139,73.3,71,17,23],
   [12.2,17.2,130,72,72,14,20],
   [12.2,17.2,130,72.49,72,15,20], // Rounding before the CR adjustment would wrongly give A 14.
   [12.2,17.2,100,70,72,9,13],
   [12.2,17.2,113,72.3,72,13,18],
   [12.2,17.2,113,72.29,72,12,17],
   [-2.5,0,113,72,72,-3,0]
  ];
  for(const [a,b,slope,cr,par,ch1,ch2] of cases){
   const m=await start(a,b,'1',slope,cr,par);
   assert.deepEqual([m.handicap1,m.handicap2].map(Number),[a,b]);
   assert.deepEqual([m.course_handicap1,m.course_handicap2],[ch1,ch2]);
   assert.deepEqual([m.playing_handicap1,m.playing_handicap2],[ch1,ch2]);
   assert.equal(m.handicap_allowance,100);
   assert.equal(m.course_snapshot.slope_rating,slope);assert.equal(m.course_snapshot.course_rating,cr);assert.equal(m.course_snapshot.par,par);
   assert.equal(courseHandicap(a,teeSettings(slope,cr,par)),ch1);assert.equal(courseHandicap(b,teeSettings(slope,cr,par)),ch2);
   if(ch1===15 && ch2===20) assert.deepEqual((await rows(m)).filter(h=>h.strokes2>h.strokes1).map(h=>h.stroke_index),[1,2,16,17,18]);
  }
 });
 await t.test('missing and invalid ratings are rejected; retry cannot replace saved ratings',async()=>{
  for(const values of [[null,72,72],[54,72,72],[156,72,72],[113,null,72],[113,72,null],[113,72,0],[113,72,72.5]]){
   await assert.rejects(()=>start(12.2,17.2,'1',...values));
  }
  const m=await start(12.2,17.2,'1',113,75,72);
  await db.exec('reset role');
  await db.query('update courses set slope_rating=155,course_rating=80,par_total=70 where id=1');
  await db.exec('set role authenticated');
  const retry=await one('select * from start_match($1,$2,$3)',[m.id,id(2),'1']);
  assert.deepEqual(retry,m);
  assert.deepEqual(m.course_snapshot.holes,course);assert.equal(m.course_snapshot.tee_id,'1');
  await assert.rejects(()=>one('select * from start_match($1,$2,$3,$4,$5,$6)',[id(++serial),id(2),'1',113,75,72]),/does not exist/);
 });
 await t.test('provided Haga tee uses par_total and exact hole SI; later course edits cannot alter snapshot',async()=>{
  const si=[11,17,13,15,7,3,9,1,5,4,8,16,10,2,14,12,18,6];
  const pars=[5,3,4,4,5,4,3,4,4,4,4,4,4,4,3,4,3,5];
  const source=si.map((stroke_index,i)=>({hole:i+1,par:pars[i],stroke_index}));
  await db.exec('reset role');
  await db.query('insert into courses(id,club_name,course_name,tee_name,holes,slope_rating,course_rating,par_total) values(10,$1,$2,$3,$4,139,73.3,71)', ['Haga Golf','Blå-Rød','61',JSON.stringify(source)]);
  const m=await start(12.2,17.2,'10',139,73.3,71),saved=await rows(m);
  assert.deepEqual([m.course_handicap1,m.course_handicap2,m.playing_handicap1,m.playing_handicap2],[17,23,17,23]);
  assert.deepEqual(m.course_snapshot.holes,source);assert.equal(m.course_snapshot.par_total,71);
  for(const h of saved){assert.equal(h.stroke_index,si[h.hole-1]);assert.equal(h.par,pars[h.hole-1]);}
  const example=await start(12.2,17.2,'10',113,75,72);
  assert.deepEqual((await rows(example)).filter(h=>h.strokes2>h.strokes1).map(h=>h.hole).sort((a,b)=>a-b),[2,8,12,14,17]);
  await db.exec('reset role');await db.query("update courses set holes='[]',course_rating=80 where id=10");await db.exec('set role authenticated');
  assert.deepEqual(await one('select * from matches where id=$1',[m.id]),m);assert.deepEqual(await rows(m),saved);
 });
 const cases=[
  {a:15,b:20,aa:[...ones(15),...zeros(3)],bb:[2,2,...ones(16)],extra:[1,2,16,17,18]},
  {a:10,b:15,aa:[...ones(10),...zeros(8)],bb:[...ones(15),...zeros(3)],extra:[11,12,13,14,15]},
  {a:5,b:10,aa:[...ones(5),...zeros(13)],bb:[...ones(10),...zeros(8)],extra:[6,7,8,9,10]},
  {a:10,b:20,aa:[...ones(10),...zeros(8)],bb:[2,2,...ones(16)],extra:[1,2,11,12,13,14,15,16,17,18]}
 ];
 for(const c of cases)await t.test(`${c.a} vs ${c.b}: full allowances and exact effective advantage holes`,async()=>{
  const m=await start(c.a,c.b),r=await rows(m);
  assert.deepEqual(r.map(h=>h.strokes1),c.aa);
  assert.deepEqual(r.map(h=>h.strokes2),c.bb);
  assert.deepEqual(r.filter(h=>h.strokes2-h.strokes1===1).map(h=>h.stroke_index),c.extra);
  assert.ok(r.every(h=>h.strokes2-h.strokes1===(c.extra.includes(h.stroke_index)?1:0)));
  if(c.a===15 && c.b===20) {
   assert.deepEqual(r.filter(h=>h.strokes1===h.strokes2).map(h=>h.stroke_index),Array.from({length:13},(_,i)=>i+3));
   assert.notDeepEqual(r.filter(h=>h.strokes2>h.strokes1).map(h=>h.stroke_index),[1,2,3,4,5]);
  }
  // Every stored SI is still attached to its original hole, not its sorted position.
  for(const h of r)assert.equal(h.stroke_index,indices[h.hole-1]);
 });
 for(const [hcp,expected] of [[0,zeros(18)],[18,ones(18)],[20,[2,2,...ones(16)]],[25,[...Array(7).fill(2),...ones(11)]],[36,Array(18).fill(2)],[54,Array(18).fill(3)]]){
  await t.test(`${hcp} strokes allocates the correct amount independently on every SI`,async()=>{
   const r=await rows(await start(hcp,hcp));
   assert.deepEqual(r.map(h=>h.strokes1),expected);assert.deepEqual(r.map(h=>h.strokes2),expected);
   assert.equal(r.reduce((sum,h)=>sum+h.strokes1,0),hcp);
  });
 }
 await t.test('swapping players swaps allowances without changing the SI mapping',async()=>{
  const r=await rows(await start(15,10));
  assert.deepEqual(r.filter(h=>h.strokes1-h.strokes2===1).map(h=>h.stroke_index),[11,12,13,14,15]);
 });
 await t.test('9-hole subsets use stored SI, not a new ranking or a 9-hole divisor',async()=>{
  const r=await rows(await start(10,15,'2'));
  assert.deepEqual(r.map(h=>h.stroke_index),[1,3,5,7,9,11,13,15,17]);
  assert.deepEqual(r.map(h=>h.strokes1),[1,1,1,1,1,0,0,0,0]);
  assert.deepEqual(r.map(h=>h.strokes2),[1,1,1,1,1,1,1,1,0]);
 });
 await t.test('net scores use both full allowances: B win, common-stroke tie, no-stroke tie, A win, adjusted tie',async()=>{
  const m=await start(10,15);
  const gross=[[4,4],[4,4],[4,4],[4,5],[4,5]];
  const expectedWinners=[id(2),null,null,id(1),null];
  const expectedNets=[[4,3],[3,3],[4,4],[3,4],[4,4]];
  for(let i=0;i<gross.length;i++){
   await one('select * from submit_match_hole($1,$2,$3,$4)',[m.id,i+1,...gross[i]]);
   const row=await one('select * from match_holes where match_id=$1 and hole=$2',[m.id,i+1]);
   assert.deepEqual([row.score1-row.strokes1,row.score2-row.strokes2],expectedNets[i]);
   assert.equal(row.winner_id,expectedWinners[i]);
  }
  const saved=await one('select * from matches where id=$1',[m.id]);
  assert.equal(saved.holes_won1,1);assert.equal(saved.holes_won2,1);assert.equal(saved.status,'active');
 });
 await t.test('15 vs 20 net scoring uses each actual hole SI: ties, B advantage and gross offset',async()=>{
  const m=await start(15,20);
  // Actual opening SI sequence: 12, 5, 17, 1, 11, 2.
  for(const [hole,a,b,winner] of [[1,4,4,null],[2,4,4,null],[3,4,4,id(2)],[4,4,5,null],[5,3,4,id(1)],[6,4,4,id(2)]]){
   await one('select * from submit_match_hole($1,$2,$3,$4)',[m.id,hole,a,b]);
   const row=await one('select * from match_holes where match_id=$1 and hole=$2',[m.id,hole]);
   assert.equal(row.stroke_index,indices[hole-1]);assert.equal(row.winner_id,winner);
  }
 });
 await t.test('10 vs 20: SI 12 and 17 favor B, SI 5 cancels, SI 1 can tie despite unequal gross scores',async()=>{
  const m=await start(10,20);
  for(const [hole,a,b,winner] of [[1,4,4,id(2)],[2,4,4,null],[3,4,4,id(2)],[4,4,5,null]]){
   await one('select * from submit_match_hole($1,$2,$3,$4)',[m.id,hole,a,b]);
   assert.equal((await one('select * from match_holes where match_id=$1 and hole=$2',[m.id,hole])).winner_id,winner);
  }
 });
 await t.test('round each decimal handicap separately; preserve negative profile support',async()=>{
  const r=await rows(await start(10.4,10.6));
  assert.deepEqual(r.filter(h=>h.strokes2>h.strokes1).map(h=>h.stroke_index),[11]);
  const plus=await rows(await start(-2,0));
  assert.deepEqual(plus.map(h=>h.strokes1),[...zeros(16),-1,-1]);
  assert.deepEqual(plus.map(h=>h.strokes2),zeros(18));
 });
 await t.test('no-course mode still gives neither player any strokes',async()=>{
  const m=await start(10,20,null),r=await rows(m);
  assert.equal(r.length,18);assert.ok(r.every(h=>h.stroke_index===null&&h.strokes1===0&&h.strokes2===0));
 });
 await t.test('invalid SI is rejected instead of being silently ranked into a valid hole',async()=>{
  await db.exec('reset role');
  await db.query('insert into courses(id,club_name,course_name,tee_name,holes) values(3,$1,$2,$3,$4)',['Club','Invalid','48',JSON.stringify([{hole:1,par:4,stroke_index:19}])]);
  await assert.rejects(()=>start(10,15,'3'),/INVALID_COURSE/);
 });
});
