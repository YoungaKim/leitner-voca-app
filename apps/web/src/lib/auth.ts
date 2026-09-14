// 2a. Supabase Auth(구글 로그인) 상태 — zustand 스토어 + 동기 접근용 currentUserId 헬퍼.
// store.ts의 각 mutation은 async 흐름 밖(클로저)에서도 "지금 로그인돼있나"를 즉시 알아야 해서
// zustand 구독 대신 모듈 전역 변수(currentUserId)를 onAuthStateChange가 갱신해두는 방식을 쓴다.
import { create } from "zustand";
import type { User } from "@supabase/supabase-js";
import { isCloudEnabled, supabase } from "./supabase";

let currentUserId: string | null = null;
export function getCurrentUserId(): string | null {
  return currentUserId;
}

interface AuthState {
  ready: boolean; // 최초 세션 확인 완료 여부
  user: User | null;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

export const useAuthStore = create<AuthState>(() => ({
  ready: !isCloudEnabled, // 클라우드 미설정이면 바로 "확인 완료(=로그인 없음)"로 취급
  user: null,

  async signInWithGoogle() {
    if (!supabase) return;
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
  },

  async signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  },
}));

/** onSignedIn: 앱이 이 세션에서 "새로 로그인됨"을 감지했을 때 1회 호출할 콜백(동기화 트리거용). */
export function initAuth(onSignedIn: (userId: string) => void) {
  if (!supabase) return;

  // getSession()이 응답하지 않으면(저장된 세션 토큰이 꼬였거나 Web Locks 경합 등)
  // ready가 영원히 false로 남아 App.tsx가 "불러오는 중..."에서 멈춘다.
  // 일정 시간 안에 응답이 없으면 "로그인 안 됨"으로 간주하고 화면을 띄운다 —
  // 실제 세션이 있었다면 이후 onAuthStateChange나 재로그인으로 바로잡힌다.
  let settled = false;
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    useAuthStore.setState({ ready: true });
  }, 5000);

  supabase.auth
    .getSession()
    .then(({ data }) => {
      if (settled) return; // 타임아웃이 먼저 발동했으면 이 결과는 버린다.
      settled = true;
      clearTimeout(timeout);
      currentUserId = data.session?.user.id ?? null;
      useAuthStore.setState({ user: data.session?.user ?? null, ready: true });
      if (currentUserId) onSignedIn(currentUserId);
    })
    .catch(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      useAuthStore.setState({ ready: true });
    });

  supabase.auth.onAuthStateChange((event, session) => {
    const wasSignedOut = currentUserId === null;
    currentUserId = session?.user.id ?? null;
    useAuthStore.setState({ user: session?.user ?? null, ready: true });
    if (event === "SIGNED_IN" && wasSignedOut && currentUserId) {
      onSignedIn(currentUserId);
    }
  });
}
