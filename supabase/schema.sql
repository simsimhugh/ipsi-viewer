-- 학군 뷰어 Supabase 스키마.
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
