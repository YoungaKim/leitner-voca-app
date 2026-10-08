-- 운영 DB 일회성 정리 + 재발 방지.
-- 같은 한글·영문 문장에서는 box가 높은 카드를 남기고, 동률이면 correct_streak·updated_at이 높은 것을 남긴다.
-- 삭제 카드의 review_log도 함께 지운다(cards와 FK가 연결돼 있지 않음).
with ranked as (
  select
    id,
    row_number() over (
      partition by
        user_id,
        regexp_replace(trim(prompt_ko), '\\s+', ' ', 'g'),
        lower(regexp_replace(trim(answer_en), '\\s+', ' ', 'g'))
      order by box desc, correct_streak desc, updated_at desc
    ) as rn
  from cards
),
losers as (
  select id from ranked where rn > 1
),
deleted_logs as (
  delete from review_log where card_id in (select id from losers)
)
delete from cards where id in (select id from losers);

create unique index if not exists cards_user_sentence_unique_idx
  on cards (
    user_id,
    (regexp_replace(trim(prompt_ko), '\\s+', ' ', 'g')),
    (lower(regexp_replace(trim(answer_en), '\\s+', ' ', 'g')))
  );

create unique index if not exists new_pool_user_sentence_unique_idx
  on new_pool (
    user_id,
    (regexp_replace(trim(prompt_ko), '\\s+', ' ', 'g')),
    (lower(regexp_replace(trim(answer_en), '\\s+', ' ', 'g')))
  );
