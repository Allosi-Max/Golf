-- Golf League accounts. Run ONCE in Supabase SQL Editor as the database owner.
-- Transactional and deliberately fails if any new table already exists: inspect
-- existing schemas rather than silently changing or dropping user data.
-- Existing courses and legacy players are preserved; no account IDs are guessed.
begin;

create table public.profiles (
    id uuid primary key references auth.users(id) on delete cascade,
    username text not null unique check (username ~ '^[a-z0-9_]{3,24}$'),
    display_name text not null check (char_length(btrim(display_name)) between 1 and 80),
    handicap numeric(3,1) not null check (handicap between -10 and 54),
    created_at timestamptz not null default now()
);
create table public.friend_requests (
    id uuid primary key default gen_random_uuid(),
    sender_id uuid not null references public.profiles(id) on delete cascade,
    recipient_id uuid not null references public.profiles(id) on delete cascade,
    status text not null default 'pending' check (status in ('pending','accepted','declined')),
    created_at timestamptz not null default now(),
    responded_at timestamptz,
    check (sender_id <> recipient_id)
);
create unique index friend_requests_pair on public.friend_requests
    (least(sender_id,recipient_id), greatest(sender_id,recipient_id));
create index friend_requests_recipient on public.friend_requests(recipient_id,status);
create index friend_requests_sender on public.friend_requests(sender_id,status);
create table public.friendships (
    user_low uuid not null references public.profiles(id) on delete cascade,
    user_high uuid not null references public.profiles(id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key(user_low,user_high), check(user_low < user_high)
);
create index friendships_high on public.friendships(user_high);

create table public.matches (
    id uuid primary key,
    player1_id uuid not null references public.profiles(id),
    player2_id uuid not null references public.profiles(id),
    player1_name text not null,
    player2_name text not null,
    handicap1 numeric(3,1) not null,
    handicap2 numeric(3,1) not null,
    course_snapshot jsonb,
    total_holes integer not null check(total_holes between 1 and 36),
    current_hole integer not null default 1,
    holes_won1 integer not null default 0 check(holes_won1 >= 0),
    holes_won2 integer not null default 0 check(holes_won2 >= 0),
    status text not null default 'active' check(status in ('active','finished','cancelled')),
    winner_id uuid references public.profiles(id),
    final_result text,
    created_at timestamptz not null default now(),
    finished_at timestamptz,
    check(player1_id <> player2_id),
    check(winner_id is null or winner_id in (player1_id,player2_id)),
    check(current_hole between 1 and total_holes + 1)
);
create index matches_player1_date on public.matches(player1_id,created_at desc);
create index matches_player2_date on public.matches(player2_id,created_at desc);
create table public.match_holes (
    match_id uuid not null references public.matches(id) on delete cascade,
    hole integer not null check(hole between 1 and 36),
    par integer check(par between 1 and 8),
    stroke_index integer,
    strokes1 integer not null default 0 check(strokes1 >= 0),
    strokes2 integer not null default 0 check(strokes2 >= 0),
    score1 integer check(score1 between 1 and 30),
    score2 integer check(score2 between 1 and 30),
    winner_id uuid references public.profiles(id),
    recorded_by uuid references public.profiles(id),
    recorded_at timestamptz,
    primary key(match_id,hole),
    check((score1 is null) = (score2 is null))
);

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.friendships enable row level security;
alter table public.matches enable row level security;
alter table public.match_holes enable row level security;

-- Authenticated users can find usernames; no email/password is stored here.
create policy profiles_read on public.profiles for select to authenticated using(true);
create policy profiles_create_own on public.profiles for insert to authenticated
    with check(id = (select auth.uid()));
create policy profiles_edit_own on public.profiles for update to authenticated
    using(id = (select auth.uid())) with check(id = (select auth.uid()));
create policy requests_participants on public.friend_requests for select to authenticated
    using((select auth.uid()) in (sender_id,recipient_id));
create policy friends_participants on public.friendships for select to authenticated
    using((select auth.uid()) in (user_low,user_high));
create policy matches_participants on public.matches for select to authenticated
    using((select auth.uid()) in (player1_id,player2_id));
create policy holes_participants on public.match_holes for select to authenticated
    using(exists(select 1 from public.matches m where m.id = match_id
        and (select auth.uid()) in (m.player1_id,m.player2_id)));

-- No direct writes to friend or match tables. Mutations below validate the caller,
-- lock the relevant rows, and derive all results on the server.
revoke all on public.profiles, public.friend_requests, public.friendships,
    public.matches, public.match_holes from public, anon, authenticated;
grant select on public.profiles, public.friend_requests, public.friendships,
    public.matches, public.match_holes to authenticated;
grant insert(id,username,display_name,handicap) on public.profiles to authenticated;
grant update(display_name,handicap) on public.profiles to authenticated;

create function public.send_friend_request(p_username text) returns public.friend_requests
language plpgsql security definer set search_path = '' as $$
declare me uuid := auth.uid(); target uuid; req public.friend_requests;
begin
    if me is null or not exists(select 1 from public.profiles where id=me) then
        raise exception 'PROFILE_REQUIRED'; end if;
    select id into target from public.profiles where username=lower(btrim(p_username));
    if target is null then raise exception 'USER_NOT_FOUND'; end if;
    if target=me then raise exception 'CANNOT_ADD_SELF'; end if;
    perform pg_advisory_xact_lock(hashtextextended(least(me,target)::text || greatest(me,target)::text,0));
    if exists(select 1 from public.friendships where user_low=least(me,target) and user_high=greatest(me,target)) then
        raise exception 'ALREADY_FRIENDS'; end if;
    select * into req from public.friend_requests
        where least(sender_id,recipient_id)=least(me,target) and greatest(sender_id,recipient_id)=greatest(me,target) for update;
    if found and req.status='pending' then
        if req.sender_id<>me then raise exception 'INCOMING_REQUEST_EXISTS'; end if;
        return req;
    end if;
    if req.id is not null then
        update public.friend_requests set sender_id=me,recipient_id=target,status='pending',
            created_at=now(),responded_at=null where id=req.id returning * into req;
    else
        insert into public.friend_requests(sender_id,recipient_id) values(me,target) returning * into req;
    end if;
    return req;
end $$;

create function public.respond_friend_request(p_request_id uuid,p_accept boolean) returns public.friend_requests
language plpgsql security definer set search_path = '' as $$
declare req public.friend_requests; me uuid := auth.uid();
begin
    if me is null or p_accept is null then raise exception 'NOT_ALLOWED'; end if;
    select * into req from public.friend_requests where id=p_request_id for update;
    if not found or req.recipient_id<>me then raise exception 'NOT_ALLOWED'; end if;
    if req.status<>'pending' then
        if req.status=(case when p_accept then 'accepted' else 'declined' end) then return req; end if;
        raise exception 'REQUEST_ALREADY_HANDLED';
    end if;
    if p_accept then
        insert into public.friendships(user_low,user_high)
            values(least(req.sender_id,req.recipient_id),greatest(req.sender_id,req.recipient_id)) on conflict do nothing;
    end if;
    update public.friend_requests set status=case when p_accept then 'accepted' else 'declined' end,
        responded_at=now() where id=req.id returning * into req;
    return req;
end $$;

create function public.start_match(p_match_id uuid,p_opponent_id uuid,p_course_id text default null)
returns public.matches language plpgsql security definer set search_path = '' as $$
declare
    me uuid := auth.uid(); p1 public.profiles; p2 public.profiles; m public.matches;
    course jsonb; holes jsonb; total integer := 18; diff integer := 0; receiver integer := 0;
    h record; allowance integer;
begin
    if me is null or p_match_id is null or p_opponent_id is null or me=p_opponent_id then raise exception 'NOT_ALLOWED'; end if;
    -- Client-generated id is an idempotency key, not authority over participants.
    perform pg_advisory_xact_lock(hashtextextended(p_match_id::text,0));
    select * into m from public.matches where id=p_match_id;
    if found then
        if m.player1_id<>me or m.player2_id<>p_opponent_id then raise exception 'NOT_ALLOWED'; end if;
        return m;
    end if;
    select * into p1 from public.profiles where id=me;
    select * into p2 from public.profiles where id=p_opponent_id;
    if p1.id is null or p2.id is null then raise exception 'PROFILE_REQUIRED'; end if;
    if not exists(select 1 from public.friendships where user_low=least(me,p_opponent_id) and user_high=greatest(me,p_opponent_id)) then
        raise exception 'FRIEND_REQUIRED'; end if;
    if p_course_id is not null then
        -- Existing course IDs may be integers or UUIDs. No schema change is needed.
        execute 'select to_jsonb(c) from public.courses c where c.id::text=$1' into course using p_course_id;
        if course is null then raise exception 'COURSE_NOT_FOUND'; end if;
        holes := course->'holes';
        if jsonb_typeof(holes) is distinct from 'array' then raise exception 'INVALID_COURSE'; end if;
        total := jsonb_array_length(holes);
        if total not between 1 and 36 then raise exception 'INVALID_COURSE'; end if;
        if exists(select 1 from jsonb_array_elements(holes) x where
            coalesce(x->>'hole','') !~ '^[0-9]+$' or coalesce(x->>'par','') !~ '^[0-9]+$'
            or coalesce(x->>'stroke_index','') !~ '^[0-9]+$') then raise exception 'INVALID_COURSE'; end if;
        if (select count(distinct (x->>'hole')::integer) from jsonb_array_elements(holes) x) <> total
            or exists(select 1 from jsonb_array_elements(holes) x where (x->>'hole')::integer not between 1 and total
                or (x->>'par')::integer not between 1 and 8 or (x->>'stroke_index')::integer not between 1 and 36)
            then raise exception 'INVALID_COURSE'; end if;
        diff := round(abs(p1.handicap-p2.handicap));
        receiver := case when p1.handicap>p2.handicap then 1 when p2.handicap>p1.handicap then 2 else 0 end;
    else
        select jsonb_agg(jsonb_build_object('hole',n)) into holes from generate_series(1,18) n;
    end if;
    insert into public.matches(id,player1_id,player2_id,player1_name,player2_name,handicap1,handicap2,course_snapshot,total_holes)
        values(p_match_id,me,p_opponent_id,p1.display_name,p2.display_name,p1.handicap,p2.handicap,
            case when course is null then null else jsonb_build_object('id',p_course_id,'club_name',course->>'club_name',
                'course_name',course->>'course_name','tee_name',course->>'tee_name') end,total) returning * into m;
    for h in select x, row_number() over(order by (x->>'stroke_index')::integer nulls last,(x->>'hole')::integer) as rank
        from jsonb_array_elements(holes) x loop
        allowance := diff / total + case when h.rank <= diff % total then 1 else 0 end;
        insert into public.match_holes(match_id,hole,par,stroke_index,strokes1,strokes2)
            values(m.id,(h.x->>'hole')::integer,(h.x->>'par')::integer,(h.x->>'stroke_index')::integer,
                case when receiver=1 then allowance else 0 end,case when receiver=2 then allowance else 0 end);
    end loop;
    return m;
end $$;

create function public.submit_match_hole(p_match_id uuid,p_hole integer,p_score1 integer,p_score2 integer)
returns public.matches language plpgsql security definer set search_path = '' as $$
declare m public.matches; h public.match_holes; me uuid := auth.uid(); win uuid;
    w1 integer; w2 integer; lead integer; remaining integer; done boolean;
begin
    if me is null then raise exception 'NOT_ALLOWED'; end if;
    if p_score1 is null or p_score2 is null or p_score1 not between 1 and 30 or p_score2 not between 1 and 30 then
        raise exception 'INVALID_SCORE'; end if;
    select * into m from public.matches where id=p_match_id for update;
    if not found or me not in (m.player1_id,m.player2_id) then raise exception 'NOT_ALLOWED'; end if;
    select * into h from public.match_holes where match_id=m.id and hole=p_hole;
    if not found then raise exception 'INVALID_HOLE'; end if;
    -- Retrying a response lost over the network must not count the hole twice.
    if h.score1 is not null then
        if h.score1=p_score1 and h.score2=p_score2 then return m; end if;
        raise exception 'SCORE_CONFLICT';
    end if;
    if m.status<>'active' then raise exception 'MATCH_FINISHED'; end if;
    if p_hole<>m.current_hole then raise exception 'STALE_HOLE'; end if;
    win := case when p_score1-h.strokes1 < p_score2-h.strokes2 then m.player1_id
        when p_score2-h.strokes2 < p_score1-h.strokes1 then m.player2_id else null end;
    update public.match_holes set score1=p_score1,score2=p_score2,winner_id=win,recorded_by=me,recorded_at=now()
        where match_id=m.id and hole=p_hole;
    w1 := m.holes_won1 + case when win=m.player1_id then 1 else 0 end;
    w2 := m.holes_won2 + case when win=m.player2_id then 1 else 0 end;
    lead := abs(w1-w2); remaining := m.total_holes-p_hole;
    done := lead>remaining or remaining=0;
    update public.matches set holes_won1=w1,holes_won2=w2,current_hole=p_hole+1,
        status=case when done then 'finished' else 'active' end,
        winner_id=case when done and w1>w2 then m.player1_id when done and w2>w1 then m.player2_id else null end,
        final_result=case when not done then null when lead=0 then 'AS'
            when remaining>0 then lead::text || '&' || remaining::text else lead::text || ' UP' end,
        finished_at=case when done then now() else null end where id=m.id returning * into m;
    return m;
end $$;

create function public.cancel_match(p_match_id uuid) returns public.matches
language plpgsql security definer set search_path = '' as $$
declare m public.matches; me uuid := auth.uid();
begin
    select * into m from public.matches where id=p_match_id for update;
    if me is null or not found or me not in (m.player1_id,m.player2_id) then raise exception 'NOT_ALLOWED'; end if;
    if m.status='active' then
        update public.matches set status='cancelled',finished_at=now() where id=m.id returning * into m;
    end if;
    return m;
end $$;

revoke all on function public.send_friend_request(text) from public,anon,authenticated;
revoke all on function public.respond_friend_request(uuid,boolean) from public,anon,authenticated;
revoke all on function public.start_match(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.submit_match_hole(uuid,integer,integer,integer) from public,anon,authenticated;
revoke all on function public.cancel_match(uuid) from public,anon,authenticated;
grant execute on function public.send_friend_request(text), public.respond_friend_request(uuid,boolean),
    public.start_match(uuid,uuid,text), public.submit_match_hole(uuid,integer,integer,integer), public.cancel_match(uuid) to authenticated;

-- Retire anonymous player access without deleting data. Course editing remains
-- an administrator task; the app only reads the existing course catalog.
do $$ begin
    if to_regclass('public.players') is not null then
        execute 'revoke all on public.players from public,anon,authenticated';
    end if;
    if to_regclass('public.courses') is not null then
        execute 'alter table public.courses enable row level security';
        execute 'revoke all on public.courses from public,anon,authenticated';
        execute 'grant select on public.courses to authenticated';
        execute 'create policy golf_accounts_course_read on public.courses for select to authenticated using(true)';
    end if;
end $$;
commit;
