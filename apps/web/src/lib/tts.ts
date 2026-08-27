// DESIGN §4 발음(TTS, Phase 2) — PC 웹은 브라우저 내장 Web Speech API를 쓴다(무료·키 불필요·서버 호출 없음).
// 이 앱은 Chrome 전용 지원(DESIGN §4.0)이라 폴리필/브라우저별 분기 없이 표준 API를 그대로 쓴다.
//
// Chrome은 음성 목록(getVoices)을 비동기로 로드한다 — 페이지 로드 직후 바로 speak()를 부르면
// 목록이 아직 비어있어 브라우저가 아무 기본값(대개 로봇 같은 로컬 음성)으로 재생해버린다.
// 그래서 목록이 채워질 때까지 기다렸다가, 그 중 자연스러운 영어 음성을 골라 쓴다.

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesReadyPromise: Promise<SpeechSynthesisVoice[]> | null = null;

function loadVoices(): Promise<SpeechSynthesisVoice[]> {
  if (voicesReadyPromise) return voicesReadyPromise;
  voicesReadyPromise = new Promise((resolve) => {
    const existing = window.speechSynthesis.getVoices();
    if (existing.length > 0) {
      resolve(existing);
      return;
    }
    // Chrome은 목록이 준비되면 voiceschanged를 쏜다. 그마저도 안 오는 환경 대비 타임아웃 폴백.
    const onVoicesChanged = () => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    };
    window.speechSynthesis.addEventListener("voiceschanged", onVoicesChanged);
    setTimeout(() => {
      window.speechSynthesis.removeEventListener("voiceschanged", onVoicesChanged);
      resolve(window.speechSynthesis.getVoices());
    }, 1000);
  });
  return voicesReadyPromise;
}

/** 영어 음성 중 자연스러운 걸 우선순위로 고른다 — Google 클라우드 음성 > 이름에 Natural/Neural 포함 > 그 외 en-US > en-* 아무거나. */
function pickBestEnglishVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const en = voices.filter((v) => v.lang?.toLowerCase().startsWith("en"));
  if (en.length === 0) return null;
  const byPriority =
    en.find((v) => v.name.includes("Google US English")) ??
    en.find((v) => /natural|neural/i.test(v.name)) ??
    en.find((v) => v.name.includes("Google") && v.lang.toLowerCase() === "en-us") ??
    en.find((v) => v.lang.toLowerCase() === "en-us") ??
    en[0];
  return byPriority;
}

/** 영어 문장을 브라우저 TTS로 읽어준다. speechSynthesis가 없는 환경(예: 구형 브라우저)에서는 조용히 무시. */
export async function speakEnglish(text: string): Promise<void> {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel(); // 이전 발화가 남아있으면 끊고 새로 재생(카드 넘길 때 겹침 방지).

  if (!cachedVoice) {
    const voices = await loadVoices();
    cachedVoice = pickBestEnglishVoice(voices);
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  if (cachedVoice) utterance.voice = cachedVoice;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

export function isTtsSupported(): boolean {
  return typeof window !== "undefined" && !!window.speechSynthesis;
}
