// 날짜는 로컬 타임존 자정 기준 ISO 문자열(YYYY-MM-DD)로 다룬다. UTC 변환에 의한 하루 밀림을 피하기 위해
// Date 객체 대신 문자열 산술로 처리한다.

export function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateStr(d);
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function daysBetween(fromStr: string, toStr: string): number {
  const from = new Date(`${fromStr}T00:00:00`);
  const to = new Date(`${toStr}T00:00:00`);
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

export function today(): string {
  return toDateStr(new Date());
}
