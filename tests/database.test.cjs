const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('migration, scoring and RLS in local PostgreSQL',async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create schema auth;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 grant usage on schema public,auth to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;
 create table players(id integer primary key,name text,hcp numeric);insert into players values(1,'Legacy',18);
 create table courses(id bigint primary key,club_name text,course_name text,tee_name text,holes jsonb,slope_rating numeric default 113,course_rating numeric default 72,par_total numeric default 72);
 insert into auth.users values('${uuid(1)}'),('${uuid(2)}'),('${uuid(3)}'),('${uuid(4)}');`);
 await db.query('insert into courses(id,club_name,course_name,tee_name,holes) values(1,$1,$2,$3,$4)',['Club','Nine','48',JSON.stringify(Array.from({length:9},(_,i)=>({hole:i+1,par:4,stroke_index:i*2+1})))]);
 const migrations=path.join(__dirname,'../supabase/migrations');
 for(const file of fs.readdirSync(migrations).filter(f=>f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync(path.join(migrations,file),'utf8'));
 const one=async(q,p=[]) =>(await db.query(q,p)).rows[0];
 const as=async(id,role='authenticated')=>{await db.exec(`reset role;set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id?uuid(id):'']);};
 const start=id=>one('select * from start_match($1,$2,$3)',[uuid(id),uuid(2),'1']);
 let req,m;
 await t.test('legacy data kept; missing profile blocks match creation',async()=>{
  assert.equal((await one('select count(*)::int n from players')).n,1);await as(1);
  await assert.rejects(()=>start(100),/PROFILE_REQUIRED/);
  for(const [id,name,hcp] of [[1,'ada',10],[2,'jon',19],[3,'liv',20]]){await as(id);await db.query('insert into profiles(id,username,display_name,handicap) values($1,$2,$2,$3)',[uuid(id),name,hcp]);}
 });
 await t.test('own profile only; immutable username; unique usernames',async()=>{
  await as(1);assert.equal((await db.query('update profiles set display_name=$1 where id=$2 returning *',['Hack',uuid(2)])).rows.length,0);
  await assert.rejects(()=>db.query('update profiles set username=$1 where id=$2',['hack',uuid(1)]),/permission denied/);
  await assert.rejects(()=>db.query('insert into profiles(id,username,display_name,handicap) values($1,$2,$2,10)',[uuid(4),'forged']),/row-level security/);
  await as(4);await assert.rejects(()=>db.query('insert into profiles(id,username,display_name,handicap) values($1,$2,$2,10)',[uuid(4),'ada']),/unique constraint/);
  await as(1);assert.equal((await one('update profiles set display_name=$1 where id=$2 returning display_name',['Ada Berg',uuid(1)])).display_name,'Ada Berg');
 });
 await t.test('anonymous cannot read account tables or call mutations',async()=>{
  await as(null,'anon');for(const table of ['profiles','friend_requests','friendships','matches','match_holes','players'])await assert.rejects(()=>db.query(`select * from ${table}`),/permission denied/);
  await assert.rejects(()=>one("select * from send_friend_request('jon')"),/permission denied/);
 });
 await t.test('self, duplicate and reversed requests rejected or idempotent',async()=>{
  await as(1);await assert.rejects(()=>one("select * from send_friend_request('ada')"),/CANNOT_ADD_SELF/);
  req=await one("select * from send_friend_request('JON')");assert.equal((await one("select * from send_friend_request('jon')")).id,req.id);
  await as(2);await assert.rejects(()=>one("select * from send_friend_request('ada')"),/INCOMING_REQUEST_EXISTS/);
  await as(3);assert.equal((await db.query('select * from friend_requests')).rows.length,0);await assert.rejects(()=>one('select * from respond_friend_request($1,true)',[req.id]),/NOT_ALLOWED/);
 });
 await t.test('only recipient accepts; no forged friendships',async()=>{
  await as(1);await assert.rejects(()=>one('select * from respond_friend_request($1,true)',[req.id]),/NOT_ALLOWED/);
  await assert.rejects(()=>db.query('insert into friendships values($1,$2,now())',[uuid(1),uuid(2)]),/permission denied/);
  await as(2);assert.equal((await one('select * from respond_friend_request($1,true)',[req.id])).status,'accepted');
  assert.equal((await db.query('select * from friendships')).rows.length,1);assert.equal((await one('select * from respond_friend_request($1,true)',[req.id])).status,'accepted');
 });
 await t.test('decline creates no friendship; request can be sent again',async()=>{
  await as(3);const r=await one("select * from send_friend_request('ada')");await as(1);await one('select * from respond_friend_request($1,false)',[r.id]);
  assert.equal((await db.query('select * from friendships')).rows.length,1);await as(3);assert.equal((await one("select * from send_friend_request('ada')")).status,'pending');
 });
 await t.test('matches require friendship and creation retries reuse ID',async()=>{
  await as(3);await assert.rejects(()=>start(100),/FRIEND_REQUIRED/);await as(1);m=await start(100);
  assert.equal(m.total_holes,9);assert.equal(m.player1_name,'Ada Berg');assert.equal((await start(100)).id,m.id);
  assert.equal((await db.query('select * from matches')).rows.length,1);assert.equal((await db.query('select * from match_holes')).rows.length,9);
 });
 await t.test('outsiders cannot read/write matches; direct result forgery blocked',async()=>{
  await as(3);assert.equal((await db.query('select * from matches')).rows.length,0);assert.equal((await db.query('select * from match_holes')).rows.length,0);
  await assert.rejects(()=>one('select * from submit_match_hole($1,1,4,5)',[m.id]),/NOT_ALLOWED/);await assert.rejects(()=>one('select * from cancel_match($1)',[m.id]),/NOT_ALLOWED/);
  await as(1);await assert.rejects(()=>db.query("update matches set status='finished' where id=$1",[m.id]),/permission denied/);
  await assert.rejects(()=>db.query('update match_holes set score1=1 where match_id=$1',[m.id]),/permission denied/);
 });
 await t.test('snapshot handicaps, net ties, duplicate and conflicting scores',async()=>{
  await as(2);await db.query('update profiles set handicap=0 where id=$1',[uuid(2)]);
  assert.equal((await one('select * from match_holes where match_id=$1 and hole=1',[m.id])).strokes2,2);
  const after=await one('select * from submit_match_hole($1,1,4,5)',[m.id]);assert.equal(after.holes_won1,0);assert.equal(after.holes_won2,0);
  assert.equal((await one('select * from submit_match_hole($1,1,4,5)',[m.id])).current_hole,2);
  await assert.rejects(()=>one('select * from submit_match_hole($1,1,4,6)',[m.id]),/SCORE_CONFLICT/);
  await assert.rejects(()=>one('select * from submit_match_hole($1,3,4,6)',[m.id]),/STALE_HOLE/);
  await db.query('update profiles set handicap=19 where id=$1',[uuid(2)]);
 });
 await t.test('3 UP with 2 left ends 3&2 and stores winner/date for both users',async()=>{
  await as(1);await db.query('update profiles set handicap=0 where id=$1',[uuid(1)]);
  await as(2);await db.query('update profiles set handicap=0 where id=$1',[uuid(2)]);
  await as(1);const match=await start(101);let r;
  for(let h=1;h<=7;h++)r=await one('select * from submit_match_hole($1,$2,$3,$4)',[match.id,h,h===5||h===6?6:4,h===5||h===6?4:6]);
  assert.equal(r.status,'finished');assert.equal(r.final_result,'3&2');assert.equal(r.winner_id,uuid(1));assert.ok(r.finished_at);
  assert.equal((await one('select * from submit_match_hole($1,7,4,6)',[match.id])).final_result,'3&2');
  await assert.rejects(()=>one('select * from submit_match_hole($1,8,4,6)',[match.id]),/MATCH_FINISHED/);
  await as(2);assert.equal((await one('select * from matches where id=$1',[match.id])).winner_id,uuid(1));
 });
 await t.test('18-hole no-course fallback and drawn result',async()=>{
  await as(1);const match=await one('select * from start_match($1,$2,null)',[uuid(102),uuid(2)]);let r;assert.equal(match.total_holes,18);
  for(let h=1;h<=18;h++)r=await one('select * from submit_match_hole($1,$2,4,4)',[match.id,h]);
  assert.equal(r.final_result,'AS');assert.equal(r.winner_id,null);assert.equal(r.status,'finished');
 });
 await t.test('cancelled matches retained but not scoreable',async()=>{
  await as(1);const match=await start(103);assert.equal((await one('select * from cancel_match($1)',[match.id])).status,'cancelled');
  await assert.rejects(()=>one('select * from submit_match_hole($1,1,4,5)',[match.id]),/MATCH_FINISHED/);
 });
 await t.test('RLS on all five tables and fixed function search paths',async()=>{
  await db.exec('reset role');assert.equal((await one("select count(*)::int n from pg_class where relname in ('profiles','friend_requests','friendships','matches','match_holes') and relrowsecurity")).n,5);
  const f=await db.query("select proconfig from pg_proc where proname in ('send_friend_request','respond_friend_request','start_match','submit_match_hole','cancel_match')");assert.equal(f.rows.length,5);
  for(const r of f.rows)assert.ok(r.proconfig.some(v=>v.startsWith('search_path=')));
 });
});
