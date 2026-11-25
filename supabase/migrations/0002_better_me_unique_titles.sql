-- Better Me: a book can only be in the shared library once.
-- Same file  -> blocked by the unique file_hash (0001).
-- Same title -> blocked here, ignoring case, spaces and punctuation
--               ("Habits_of-Attention" = "Habits of Attention").
-- The app uses the same rule (src/lib/titles.ts, titleKey) to warn before uploading;
-- this index is the guarantee when two people add the same book at the same moment.

alter table public.betterme_books
  add column if not exists title_key text
  generated always as (lower(regexp_replace(title, '[^[:alnum:]]+', '', 'g'))) stored;

create unique index if not exists betterme_books_title_key_unique
  on public.betterme_books (title_key)
  where title_key <> '';
