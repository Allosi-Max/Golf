-- Apply after 202609140001_accounts.sql. Changes NEW matches only.
-- Existing matches and their stored hole allowances/results are not rewritten.
-- Net-score comparison in submit_match_hole already subtracts each allowance.
begin;

-- Profiles already allow handicaps down to -10. Signed allowances let those
-- players give strokes back without clamping or changing the profile system.
-- Keep historical positive allowances valid (including old 9-hole allocations).
alter table public.match_holes drop constraint match_holes_strokes1_check;
alter table public.match_holes drop constraint match_holes_strokes2_check;
alter table public.match_holes add constraint match_holes_strokes1_check check(strokes1 >= -1);
alter table public.match_holes add constraint match_holes_strokes2_check check(strokes2 >= -1);

create or replace function public.start_match(p_match_id uuid,p_opponent_id uuid,p_course_id text default null)
returns public.matches language plpgsql security definer set search_path = '' as $$
declare
    me uuid := auth.uid(); p1 public.profiles; p2 public.profiles; m public.matches;
    course jsonb; holes jsonb; total integer := 18;
    full1 integer; full2 integer; base1 integer; base2 integer;
    h record; si integer; allowance1 integer; allowance2 integer;
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
                or (x->>'par')::integer not between 1 and 8 or (x->>'stroke_index')::integer not between 1 and 18)
            then raise exception 'INVALID_COURSE'; end if;
        -- Full allowance for EACH player, on an 18-SI scale. Never rank the
        -- selected subset or redistribute the difference to its hardest holes.
        full1 := round(p1.handicap);
        full2 := round(p2.handicap);
        base1 := floor(full1::numeric / 18);
        base2 := floor(full2::numeric / 18);
    else
        select jsonb_agg(jsonb_build_object('hole',n)) into holes from generate_series(1,18) n;
    end if;
    insert into public.matches(id,player1_id,player2_id,player1_name,player2_name,handicap1,handicap2,course_snapshot,total_holes)
        values(p_match_id,me,p_opponent_id,p1.display_name,p2.display_name,p1.handicap,p2.handicap,
            case when course is null then null else jsonb_build_object('id',p_course_id,'club_name',course->>'club_name',
                'course_name',course->>'course_name','tee_name',course->>'tee_name') end,total) returning * into m;
    for h in select x from jsonb_array_elements(holes) x loop
        si := (h.x->>'stroke_index')::integer;
        if course is null then
            -- Preserve the existing no-course/no-handicap mode.
            allowance1 := 0; allowance2 := 0;
        else
            -- For nonnegative allowances: floor(H / 18) + (SI <= H % 18).
            -- Floor-based remainder also preserves signed plus-handicaps:
            -- e.g. -2 returns one stroke on SI 17 and 18 (allowance -1).
            allowance1 := base1 + case when si <= full1 - 18 * base1 then 1 else 0 end;
            allowance2 := base2 + case when si <= full2 - 18 * base2 then 1 else 0 end;
        end if;
        insert into public.match_holes(match_id,hole,par,stroke_index,strokes1,strokes2)
            values(m.id,(h.x->>'hole')::integer,(h.x->>'par')::integer,(h.x->>'stroke_index')::integer,
                allowance1,allowance2);
    end loop;
    return m;
end $$;

-- CREATE OR REPLACE preserves existing grants; keep the RPC boundary explicit.
revoke all on function public.start_match(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.start_match(uuid,uuid,text) to authenticated;
commit;
