// 오늘 틀린 카드 중 "다시 보기"(채점 미반영 재노출, DESIGN §1.5)를 아직 안 끝낸 카드 id 목록.
// 세션 중 state(retryQueue)로만 들고 있으면 세션 도중 홈으로 나갔을 때 통째로 사라져서
// "분명 틀려서 다시 봐야 할 카드가 있는데 홈은 오늘 목표 달성이라고 함" 문제가 생긴다.
// 날짜별로 localStorage에 얹어두고, 세션을 다시 열면 이어서 볼 수 있게 한다.
import { today as todayStr } from "@leitner/core";

const KEY = "retryPending";

interface Stored {
  date: string;
  ids: string[];
}

function read(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.date !== "string" || !Array.isArray(parsed.ids)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 오늘자 다시보기 대기 카드 id 목록. 날짜가 지났으면 빈 배열(자동 만료). */
export function getRetryPendingIds(): string[] {
  const stored = read();
  if (!stored || stored.date !== todayStr()) return [];
  return stored.ids;
}

export function addRetryPendingId(id: string) {
  const ids = getRetryPendingIds();
  if (ids.includes(id)) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: todayStr(), ids: [...ids, id] }));
  } catch {
    /* 비공개 모드 등 — 이번 세션 중엔 retryQueue state로만 동작, 다음 재방문 시 복원은 못함 */
  }
}

export function removeRetryPendingId(id: string) {
  const ids = getRetryPendingIds().filter((x) => x !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify({ date: todayStr(), ids }));
  } catch {
    /* no-op */
  }
}
