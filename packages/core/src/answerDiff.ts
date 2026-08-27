// DESIGN §1.3a — 오답 시 설명용 규칙 기반 word-diff. LLM 호출 없이 순수 함수로 계산한다.
// 사용자가 입력한 문장과 정답 문장을 단어 단위로 비교해, 각 단어가 일치/누락/추가 중 무엇인지 표시한다.

export type DiffWordStatus = "match" | "missing" | "extra";

export interface DiffWord {
  word: string;
  status: DiffWordStatus;
}

function splitWords(text: string): string[] {
  return text.trim().length > 0 ? text.trim().split(/\s+/) : [];
}

/** 두 단어를 "같은 단어"로 볼지 비교 — 대소문자·꼬리 구두점 차이는 무시(관사는 여기선 구분해서 보여줌). */
function sameWord(a: string, b: string): boolean {
  const strip = (w: string) => w.toLowerCase().replace(/[.,!?;:]+$/g, "");
  return strip(a) === strip(b);
}

/**
 * userText(입력)와 answerEn(정답)을 단어 단위로 정렬해 diff를 만든다.
 * LCS(최장 공통 부분수열) 기반 — answerEn 기준으로 "missing"(정답엔 있지만 입력엔 없음)과
 * "extra"(입력엔 있지만 정답엔 없음)를 순서대로 나열해, 정답 문장의 어순을 그대로 유지해 보여준다.
 */
export function diffWords(userText: string, answerEn: string): DiffWord[] {
  const user = splitWords(userText);
  const answer = splitWords(answerEn);

  const n = user.length;
  const m = answer.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      lcs[i][j] = sameWord(user[i - 1], answer[j - 1]) ? lcs[i - 1][j - 1] + 1 : Math.max(lcs[i - 1][j], lcs[i][j - 1]);
    }
  }

  const result: DiffWord[] = [];
  let i = n;
  let j = m;
  const rev: DiffWord[] = [];
  while (i > 0 && j > 0) {
    if (sameWord(user[i - 1], answer[j - 1])) {
      rev.push({ word: answer[j - 1], status: "match" });
      i--;
      j--;
    } else if (lcs[i - 1][j] >= lcs[i][j - 1]) {
      rev.push({ word: user[i - 1], status: "extra" });
      i--;
    } else {
      rev.push({ word: answer[j - 1], status: "missing" });
      j--;
    }
  }
  while (i > 0) {
    rev.push({ word: user[i - 1], status: "extra" });
    i--;
  }
  while (j > 0) {
    rev.push({ word: answer[j - 1], status: "missing" });
    j--;
  }
  for (let k = rev.length - 1; k >= 0; k--) result.push(rev[k]);
  return result;
}
