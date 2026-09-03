// DESIGN §2 데이터 구조(초안)를 그대로 TS 타입으로 옮긴 것.
// 날짜는 로컬 저장(IndexedDB)/직렬화 편의를 위해 ISO 문자열(YYYY-MM-DD)로 다룬다.

export type LapseMode = "reset" | "soft";

export interface Deck {
  id: string;
  name: string;
  description?: string;
  examDate?: string | null; // D-day, ISO date
  createdAt: string;
  updatedAt?: string; // 2a 클라우드 동기화 LWW 기준(DESIGN §3.7). 로컬 전용일 땐 없어도 됨.
}

export interface Card {
  id: string;
  deckId: string;
  sourceId?: string; // 원천 시트 id (dedupe/추적)
  promptKo: string;
  answerEn: string;
  chunkNote?: string;
  audioUrl?: string;
  box: number; // 0=신규(기한 없음, DESIGN §1.3b), 1~6=복습, 7=졸업
  nextReviewDate: string | null; // 졸업(box=7)이면 null
  lastReviewedAt: string | null;
  correctStreak: number;
  lapseCount: number;
  introducedAt: string;
  tags: string[];
  updatedAt?: string; // 2a 클라우드 동기화 LWW 기준(DESIGN §3.7). 로컬 전용일 땐 없어도 됨.
}

export interface NewPoolItem {
  id: string; // = 원천 시트 id
  deckId: string;
  promptKo: string;
  answerEn: string;
  chunkNote?: string;
  level?: string;
  topic?: string;
  status: "pending";
  importedAt: string;
}

export interface SyncState {
  sourceUrl?: string;
  importedIds: string[];
  lastSyncAt?: string;
  lastSyncResult?: string;
}

export type ReviewResult = "correct" | "wrong";

export type InputMethod = "grade" | "text";

export interface ReviewLog {
  id: string;
  cardId: string;
  date: string;
  result: ReviewResult;
  boxBefore: number;
  boxAfter: number;
  hintLevel: number;
  inputMethod?: InputMethod; // DESIGN §1.3a — 자기채점/텍스트 입력 중 무엇으로 채점됐는지(선택, 통계용)
}

export interface Settings {
  intervals: number[]; // 기본 [1,2,4,8,16,32], 속성모드 [1,2,4,8]
  dailyGoal: number; // 기본 30 — 하루 복습 목표(완료 화면·진척도 기준). 넘겨서 더 풀어도 됨. 신규 유입 억제 기준도 겸함.
  newCap: number; // 기본 8
  maxActiveCards: number; // 기본 150 — 박스1~6 누적 상한(WIP cap), 상한 도달 시 신규 유입 중단
  lapseMode: LapseMode; // 기본 'soft'
  hintFreeLevel: number; // 기본 1
  notifyTime?: string;
  recoveryEase: boolean;
  contentSourceUrl?: string;
  contentSourceDeckId?: string; // 시트에서 흡수한 문장이 들어갈 덱. DESIGN엔 명시 안 됐지만 시트 1개=덱 1개 매핑이 필요해서 추가.
  autoSyncEnabled: boolean;
  refillThresholdDays: number; // 기본 3
  ttsAutoPlay: boolean;
  preferredAiModel: "claude" | "gemini" | "gpt"; // 기본 claude — DESIGN §6, '선생님한테 질문' 기능에서 사용할 모델
  aiApiKeys?: { claude?: string; gemini?: string; gpt?: string }; // DESIGN §6 — 모델별 사용자 API 키. 서버 공용 키 대신 이 값이 있으면 그걸로 호출.
  updatedAt?: string; // 2a 클라우드 동기화 LWW 기준(DESIGN §3.7). 로컬 전용일 땐 없어도 됨.
}

export const DEFAULT_SETTINGS: Settings = {
  intervals: [1, 2, 4, 8, 16, 32],
  dailyGoal: 30,
  newCap: 8,
  maxActiveCards: 150,
  lapseMode: "soft",
  hintFreeLevel: 1,
  recoveryEase: false,
  autoSyncEnabled: false,
  refillThresholdDays: 3,
  ttsAutoPlay: false,
  preferredAiModel: "claude",
  aiApiKeys: {},
};

export const GRADUATED_BOX = 7;
export const LEECH_LAPSE_THRESHOLD = 5;
export const NEW_CARD_BOX = 0; // DESIGN §1.3b — 신규 도입 직후, 복습 기한 없음(항상 due)
