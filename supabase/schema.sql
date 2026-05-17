-- 입결 뷰어 Supabase 스키마.
-- 적용: Supabase Dashboard → SQL Editor에 붙여넣기, 또는 supabase CLI로 migrate.

-- ─── 학교 마스터 ──────────────────────────────────────────────────────────
create table if not exists schools (
  shl_idf_cd      text primary key,
  school_name     text not null,
  sido_code       text not null,
  sido_name       text not null,
  sd_schul_code   text,
  kind            text not null check (kind in ('초등학교','중학교','고등학교','기타')),
  address         text,
  sigungu         text,
  -- "수원시 영통구" 같이 합쳐진 sigungu에서 분리한 첫/둘째 토큰
  si              text,
  gu              text,
  lat             double precision,
  lng             double precision,
  updated_at      timestamptz not null default now()
);

create index if not exists schools_kind_sido_idx on schools (kind, sido_name);
create index if not exists schools_sigungu_idx  on schools using gin (to_tsvector('simple', coalesce(sigungu, '')));
create index if not exists schools_name_idx     on schools (school_name);

-- ─── 연도별 진로 ───────────────────────────────────────────────────────────
create table if not exists careers (
  shl_idf_cd      text not null references schools(shl_idf_cd) on delete cascade,
  year            int  not null,
  -- 합계 row
  graduates                 int not null default 0,
  general_high              int not null default 0,
  vocational_high           int not null default 0,
  science_high              int not null default 0,
  foreign_intl_high         int not null default 0,
  arts_sports_high          int not null default 0,
  meister_high              int not null default 0,
  special_purpose_subtotal  int not null default 0,
  private_autonomous        int not null default 0,
  public_autonomous         int not null default 0,
  autonomous_subtotal       int not null default 0,
  other                     int not null default 0,
  advanced_total            int not null default 0,
  employed                  int not null default 0,
  alt_education             int not null default 0,
  unemployed                int not null default 0,
  -- 남/여 분리 (JSON으로 저장 — 단순)
  male            jsonb,
  female          jsonb,
  rate_pct        jsonb,
  fetched_at      timestamptz not null default now(),
  primary key (shl_idf_cd, year)
);

create index if not exists careers_year_idx on careers (year desc);
create index if not exists careers_elite_idx on careers (
  ((science_high + foreign_intl_high + arts_sports_high + meister_high + private_autonomous + public_autonomous)::float / nullif(graduates, 0)) desc
);

-- ─── batch 실행 이력 ───────────────────────────────────────────────────────
create table if not exists batch_runs (
  id           bigserial primary key,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  status       text not null check (status in ('running','success','failed')),
  records      int,
  error        text
);

-- ─── RLS (Row Level Security) — public read only ─────────────────────────
alter table schools enable row level security;
alter table careers enable row level security;
alter table batch_runs enable row level security;

-- 모두 읽기 가능 (학교알리미 공시 데이터 — 공공누리 제3유형)
create policy "schools public read"   on schools   for select using (true);
create policy "careers public read"   on careers   for select using (true);
-- batch_runs는 운영 정보 — 인증된 service_role만 (RLS default deny + service_role bypass)

-- ─── PostgREST grants ─────────────────────────────────────────────────────
-- "Automatically expose new tables" 설정이 OFF여서 명시적 grant 필요.
grant select on schools, careers to anon, authenticated;
grant all    on schools, careers, batch_runs to service_role;
grant usage, select on all sequences in schema public to service_role;

-- ─── 방문자 카운터 ────────────────────────────────────────────────────────
-- singleton 합계 + 영구 unique 방문자 (IP sha256 단방향 해시, salt 적용)
create table if not exists site_stats (
  id              integer primary key default 1 check (id = 1),
  total_views     bigint not null default 0,
  total_visitors  bigint not null default 0,
  updated_at      timestamptz not null default now()
);
insert into site_stats (id) values (1) on conflict do nothing;

create table if not exists unique_visitors (
  ip_hash    text primary key,
  first_seen timestamptz not null default now()
);

-- atomic 방문 기록: 첫 방문(신규 hash)이면 visitors++, 항상 views++.
-- 반환: (현재 views, 현재 visitors)
create or replace function record_visit(visitor_hash text)
returns table(views bigint, visitors bigint)
language plpgsql
security definer
as $$
declare
  inserted boolean := false;
begin
  insert into unique_visitors(ip_hash) values (visitor_hash)
  on conflict do nothing;
  inserted := found;

  update site_stats
     set total_views    = total_views + 1,
         total_visitors = total_visitors + case when inserted then 1 else 0 end,
         updated_at     = now()
   where id = 1
  returning total_views, total_visitors into views, visitors;

  return next;
end;
$$;

alter table site_stats       enable row level security;
alter table unique_visitors  enable row level security;
create policy "site_stats public read" on site_stats for select using (true);
-- unique_visitors는 RPC 통해서만 접근 — public read 없음 (개인정보 보호)

grant select  on site_stats             to anon, authenticated;
grant all     on site_stats, unique_visitors to service_role;
grant execute on function record_visit  to anon, authenticated, service_role;

-- ─── 부동산 트랙 ──────────────────────────────────────────────────────────
-- 학구 (school district polygon — SHP→GeoJSON 변환 결과)
create table if not exists school_districts (
  id          bigserial primary key,
  shl_idf_cd  text references schools(shl_idf_cd) on delete cascade,
  geom        jsonb not null,
  source      text,
  updated_at  timestamptz not null default now()
);
create index if not exists school_districts_shl_idx on school_districts(shl_idf_cd);

-- 아파트 단지 (카카오 지오코딩 + 공공데이터)
create table if not exists apartments (
  id            bigserial primary key,
  name          text not null,
  sigungu       text,
  road_address  text,
  lat           double precision,
  lng           double precision,
  built_year    int,
  households    int,
  source        text,
  updated_at    timestamptz not null default now()
);
create index if not exists apartments_geo_idx on apartments(lat, lng);
create index if not exists apartments_sigungu_idx on apartments(sigungu);

-- 실거래가 (국토부 — 매매)
create table if not exists transactions (
  id            bigserial primary key,
  apt_id        bigint references apartments(id) on delete cascade,
  area_m2       double precision,
  price_won     bigint,
  contract_date date,
  floor         int,
  source        text,
  updated_at    timestamptz not null default now()
);
create index if not exists transactions_apt_idx on transactions(apt_id);
create index if not exists transactions_date_idx on transactions(contract_date desc);

-- 전월세 (국토부 — 보증금 + 월세)
-- monthly_rent_man_won = 0 → 전세, > 0 → 월세/반전세
create table if not exists rentals (
  id                    bigserial primary key,
  apt_id                bigint references apartments(id) on delete cascade,
  area_m2               double precision,
  deposit_man_won       bigint,
  monthly_rent_man_won  bigint,
  contract_date         date,
  floor                 int,
  source                text,
  updated_at            timestamptz not null default now()
);
create index if not exists rentals_apt_idx on rentals(apt_id);
create index if not exists rentals_date_idx on rentals(contract_date desc);
create index if not exists rentals_monthly_idx on rentals(apt_id, monthly_rent_man_won, contract_date desc);

-- 아파트 ↔ 중학교 매핑 (PIP 또는 반경 기반 결과)
create table if not exists apartment_school_map (
  apt_id      bigint references apartments(id) on delete cascade,
  shl_idf_cd  text references schools(shl_idf_cd) on delete cascade,
  distance_m  double precision,
  in_district boolean,
  source      text,
  primary key (apt_id, shl_idf_cd)
);
create index if not exists asm_shl_idx on apartment_school_map(shl_idf_cd);

-- RLS
alter table school_districts       enable row level security;
alter table apartments             enable row level security;
alter table transactions           enable row level security;
alter table rentals                enable row level security;
alter table apartment_school_map   enable row level security;

create policy "school_districts public read"     on school_districts     for select using (true);
create policy "apartments public read"           on apartments           for select using (true);
create policy "transactions public read"         on transactions         for select using (true);
create policy "rentals public read"              on rentals              for select using (true);
create policy "apartment_school_map public read" on apartment_school_map for select using (true);

grant select on school_districts, apartments, transactions, rentals, apartment_school_map to anon, authenticated;
grant all    on school_districts, apartments, transactions, rentals, apartment_school_map to service_role;

-- 부동산 테이블 bigserial 시퀀스 — service_role가 INSERT 시 nextval 호출하므로 USAGE 필수.
-- (line 84의 "all sequences"는 적용 시점 기준이라 새로 만든 시퀀스에 누락될 수 있음 — 명시 보강)
grant usage, select on sequence apartments_id_seq        to service_role;
grant usage, select on sequence transactions_id_seq      to service_role;
grant usage, select on sequence rentals_id_seq           to service_role;
grant usage, select on sequence school_districts_id_seq  to service_role;

-- ─── 적재 속도 개선 (perf/realestate-fast-sync) ───────────────────────────
-- 다음 4개 블록은 SQL Editor에서 한 번만 적용. 적용 후 import / map 스크립트가
-- ON CONFLICT / RPC를 활용해 적재 시간을 50~80% 줄임.

-- (1) apartments UNIQUE — ON CONFLICT 대상 키
-- 동일 단지 키 정의: (name, coalesce(sigungu,''))
-- 기존 중복 row 제거 후 unique index 생성.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'apartments_name_sigungu_uidx'
  ) then
    -- 중복 정리: 같은 (name, sigungu)에서 가장 작은 id만 유지.
    delete from apartments a
    using (
      select min(id) as keep_id, name, coalesce(sigungu, '') as sg
      from apartments
      group by name, coalesce(sigungu, '')
      having count(*) > 1
    ) d
    where a.name = d.name
      and coalesce(a.sigungu, '') = d.sg
      and a.id <> d.keep_id;
    create unique index apartments_name_sigungu_uidx
      on apartments (name, coalesce(sigungu, ''));
  end if;
end$$;

-- (2) transactions / rentals 중복 방지 — (apt_id, area_m2, contract_date, floor, price/deposit)
-- 부분 인덱스는 ON CONFLICT 대상으로 사용하기 어려워, 전체 컬럼 unique 인덱스로.
-- contract_date / floor / area / price 모두 동일하면 동일 거래로 간주 (재적재 시 idempotent).
create unique index if not exists transactions_dedup_uidx
  on transactions (apt_id, contract_date, area_m2, floor, price_won);
create unique index if not exists rentals_dedup_uidx
  on rentals (apt_id, contract_date, area_m2, floor, deposit_man_won, monthly_rent_man_won);

-- (3) realestate_runs — (lawd_cd, deal_ym, type) 단위 적재 완료 마커
-- 동일 (lawd_cd, ym, type) 다시 import 시 skip (idempotent).
create table if not exists realestate_runs (
  lawd_cd     text not null,
  deal_ym     text not null,
  type        text not null check (type in ('trade','rent')),
  records     int not null default 0,
  inserted    int not null default 0,
  finished_at timestamptz not null default now(),
  primary key (lawd_cd, deal_ym, type)
);
alter table realestate_runs enable row level security;
grant all on realestate_runs to service_role;

-- (4) PostGIS bounding-box + Haversine 기반 반경 매핑 RPC
-- 입력: 반경 km (기본 1.0).
-- 동작: 학교 좌표 × 단지 좌표 + 위경도 박스 사전 필터 → Haversine → apartment_school_map upsert.
-- pre-filter (lat ±0.01° ≒ 1.1km, lng ±0.013° ≒ 1.1km @ 위도 37°)로
-- 5만 × 13,137 = 6.5억 비교를 수백만 수준으로 줄임.
create or replace function rpc_map_apartments_radius(p_km double precision default 1.0)
returns int
language plpgsql
security definer
as $$
declare
  inserted_count int;
  radius_m       double precision := p_km * 1000;
  lat_pad        double precision := p_km / 110.574;          -- 1° lat ≒ 110.574 km
  lng_pad        double precision := p_km / 88.0;             -- 1° lng @ 37° ≒ 88 km (안전 마진)
begin
  with cand as (
    select
      a.id as apt_id,
      s.shl_idf_cd,
      6371000 * 2 * asin(sqrt(
        sin(radians(s.lat - a.lat) / 2) ^ 2
        + cos(radians(a.lat)) * cos(radians(s.lat))
        * sin(radians(s.lng - a.lng) / 2) ^ 2
      )) as d
    from apartments a
    cross join lateral (
      select shl_idf_cd, lat, lng
      from schools
      where lat is not null and lng is not null
        and lat between a.lat - lat_pad and a.lat + lat_pad
        and lng between a.lng - lng_pad and a.lng + lng_pad
    ) s
    where a.lat is not null and a.lng is not null
  ),
  ins as (
    insert into apartment_school_map (apt_id, shl_idf_cd, distance_m, in_district, source)
    select apt_id, shl_idf_cd, round(d)::double precision, false,
           'radius:' || p_km || 'km'
    from cand
    where d <= radius_m
    on conflict (apt_id, shl_idf_cd) do update
      set distance_m = excluded.distance_m,
          source     = excluded.source
    returning 1
  )
  select count(*) into inserted_count from ins;
  return inserted_count;
end;
$$;

grant execute on function rpc_map_apartments_radius(double precision) to service_role;
