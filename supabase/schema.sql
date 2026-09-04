-- 2a. 클라우드 저장 연동 — DESIGN §2.1 스키마 그대로.
-- Supabase 대시보드 > SQL Editor 에서 이 파일 전체를 붙여넣고 실행하면 된다.
-- 모든 테이블에 user_id + RLS: "본인 행만 select/insert/update/delete".

create extension if not exists "uuid-ossp";

-- decks ---------------------------------------------------------------
create table if not exists decks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  exam_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- cards  (핵심 동기화 대상: box/nextReviewDate가 자주 바뀜) -----------
-- id는 text — 저수지(new_pool) 항목을 카드로 승격할 때 카드 id = pool.id(시트 id 또는
-- 문장 내용 해시)를 그대로 쓴다. 이래야 웹/안드로이드/여러 기기가 같은 문장을 각각 승격해도
-- id가 같아 동기화 병합(mergeByUpdatedAt)이 하나로 합친다. (수기 추가 카드는 uuid 문자열.)
create table if not exists cards (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  source_id text,
  prompt_ko text not null,
  answer_en text not null,
  chunk_note text,
  audio_url text,
  box int not null,
  next_review_date date,
  last_reviewed_at timestamptz,
  correct_streak int not null default 0,
  lapse_count int not null default 0,
  introduced_at timestamptz not null default now(),
  tags text[] not null default '{}',
  updated_at timestamptz not null default now() -- LWW 충돌 해결 기준(§3.7)
);

-- new_pool  (신규 저수지, id = 원천 시트 id 그대로 사용) --------------
create table if not exists new_pool (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  prompt_ko text not null,
  answer_en text not null,
  chunk_note text,
  level text,
  topic text,
  status text not null default 'pending',
  imported_at timestamptz not null default now()
);

-- settings  (사용자당 1행, Settings 타입을 그대로 컬럼화) -------------
create table if not exists settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  intervals int[] not null default '{1,2,4,8,16,32}',
  daily_goal int not null default 30,
  review_cap int not null default 60,
  new_cap int not null default 8,
  max_active_cards int not null default 150,
  lapse_mode text not null default 'soft',
  hint_free_level int not null default 1,
  notify_time text,
  recovery_ease boolean not null default false,
  content_source_url text,
  auto_sync_enabled boolean not null default false,
  refill_threshold_days int not null default 3,
  tts_auto_play boolean not null default false,
  preferred_ai_model text not null default 'claude', -- DESIGN §6, '선생님한테 질문' 기능에서 사용할 모델(claude|gemini|gpt)
  ai_api_keys jsonb not null default '{}'::jsonb, -- DESIGN §6, 모델별 사용자 API 키 { claude?, gemini?, gpt? }. RLS로 본인 행만 접근.
  updated_at timestamptz not null default now()
);

-- 기존 프로젝트 마이그레이션(테이블이 이미 있을 때 컬럼만 추가)
alter table settings add column if not exists ai_api_keys jsonb not null default '{}'::jsonb;

-- sync_state  (사용자당 1행) -------------------------------------------
create table if not exists sync_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  source_url text,
  imported_ids text[] not null default '{}',
  last_sync_at timestamptz,
  last_sync_result text
);

-- review_log  (append-only, 통계/복구용 — LWW 충돌 무관) --------------
create table if not exists review_log (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id text not null, -- cards.id 와 동일 타입(text)

  date date not null,
  result text not null,
  box_before int not null,
  box_after int not null,
  hint_level int not null,
  input_method text, -- DESIGN §1.3a, 자기채점/텍스트 입력 중 무엇으로 채점됐는지(선택, grade|text)
  created_at timestamptz not null default now()
);

create index if not exists cards_user_idx on cards(user_id);
create index if not exists new_pool_user_idx on new_pool(user_id);
create index if not exists review_log_user_idx on review_log(user_id);

-- RLS -------------------------------------------------------------------
alter table decks enable row level security;
alter table cards enable row level security;
alter table new_pool enable row level security;
alter table settings enable row level security;
alter table sync_state enable row level security;
alter table review_log enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['decks', 'cards', 'new_pool', 'settings', 'sync_state', 'review_log']
  loop
    execute format(
      'create policy "own rows only" on %I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)',
      t
    );
  end loop;
end $$;

-- review_log는 append-only 권장(§2.1 하단 주석) — update/delete를 막고 싶으면
-- 위 공용 정책 대신 select+insert만 허용하는 정책으로 review_log를 따로 교체해도 된다.
