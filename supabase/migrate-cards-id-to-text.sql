-- 일회성 마이그레이션 — cards.id, review_log.card_id 를 uuid → text 로 변경.
-- 배경: 저수지 항목을 카드로 승격할 때 카드 id = pool.id(시트 id·문장 해시)를 그대로 쓰도록
-- 통일했다. 그래야 웹/안드로이드/여러 기기가 같은 문장을 각각 승격해도 id가 같아 동기화
-- 병합이 하나로 합친다. pool.id 는 uuid 형식이 아닐 수 있어(예: "042", "h1a2b3c") 컬럼을
-- text 로 넓힌다. 기존 uuid 값들은 text 로 그대로 캐스팅되므로 데이터 손실 없음.
--
-- Supabase 대시보드 > SQL Editor 에서 실행. (FK 제약은 없어 별도 drop/recreate 불필요.)

alter table cards        alter column id      type text using id::text;
alter table review_log   alter column card_id type text using card_id::text;
