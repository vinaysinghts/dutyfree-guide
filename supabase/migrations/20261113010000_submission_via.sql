-- ADR-0014: record how a price report started, so we can tell whether travel-day
-- nudges bring in photos. Only the entry point is stored: never the trip, its dates,
-- or whether the traveller has reminders on.
alter table public.price_submissions
  add column via text not null default 'manual'
    check (via in ('manual', 'nudge_card', 'nudge_notification'));

comment on column public.price_submissions.via is
  'How the report started: manual (Report a price tab), nudge_card (travel-day card in the app), nudge_notification (travel-day reminder).';
