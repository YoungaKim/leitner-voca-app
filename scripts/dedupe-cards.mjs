#!/usr/bin/env node
// 일회성 정리 — 같은 문장이 서로 다른 카드 id로 중복 저장된 것을 정리한다.
// (원인: 예전 StudySessionPage가 저수지 승격 시 랜덤 uuid를 붙여, 같은 저수지 항목이
//  두 기기에서 각각 승격되면 카드가 둘 남았다. 코드는 uuidv5(pool.id)로 수정됨.)
//
// 사용법:
//   SUPABASE_URL=https://xxxx.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=eyJ... \
//   node scripts/dedupe-cards.mjs            # 미리보기(삭제 안 함)
//   node scripts/dedupe-cards.mjs --apply    # 실제 삭제
//
// 삭제 후 각 기기에서 로그아웃 → 재로그인 하면 로컬 캐시가 정리된 클라우드로 새로 채워진다.
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes("--apply");

if (!url || !key) {
  console.error("SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY 환경변수가 필요합니다.");
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });

const { data: cards, error } = await db
  .from("cards")
  .select("id, user_id, source_id, prompt_ko, answer_en, box, correct_streak, updated_at");
if (error) throw error;

// 그룹 키: source_id 우선, 없으면 문장 내용.
const groupKey = (c) =>
  `${c.user_id}::${c.source_id ?? `${c.prompt_ko}${c.answer_en}`}`;

// 남길 카드 우선순위: 박스 높은 것 → correct_streak 높은 것 → 최근 updated_at.
const better = (a, b) =>
  b.box - a.box ||
  (b.correct_streak ?? 0) - (a.correct_streak ?? 0) ||
  String(b.updated_at).localeCompare(String(a.updated_at));

const groups = new Map();
for (const c of cards) {
  const k = groupKey(c);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(c);
}

const toDelete = [];
for (const [, list] of groups) {
  if (list.length < 2) continue;
  list.sort(better);
  const keep = list[0];
  for (const loser of list.slice(1)) {
    toDelete.push(loser);
    console.log(
      `[중복] "${keep.answer_en}" — 유지 box${keep.box}(${keep.id.slice(0, 8)}) / 삭제 box${loser.box}(${loser.id.slice(0, 8)})`
    );
  }
}

console.log(`\n중복 그룹에서 삭제 대상 ${toDelete.length}개 (전체 카드 ${cards.length}개).`);

if (!APPLY) {
  console.log("미리보기입니다. 실제로 지우려면 --apply 를 붙여 다시 실행하세요.");
  process.exit(0);
}

for (let i = 0; i < toDelete.length; i += 100) {
  const ids = toDelete.slice(i, i + 100).map((c) => c.id);
  const { error: delErr } = await db.from("cards").delete().in("id", ids);
  if (delErr) throw delErr;
  console.log(`삭제 ${Math.min(i + 100, toDelete.length)}/${toDelete.length}`);
}
console.log("완료. 각 기기에서 로그아웃 → 재로그인 하세요.");
