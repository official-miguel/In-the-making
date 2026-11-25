-- Better Me: one shared library. Every uploaded book is visible to everyone;
-- only signed-in users can upload, and only the uploader (or a Better Me admin) can remove a book.
-- Notes, highlights, bookmarks and reading progress stay private on each device.
--
-- Everything is prefixed "betterme_" because this database is shared with another app
-- (the talantacitysports seating app has its own public.admins and public.is_admin()).
-- Nothing here creates, replaces or alters any object without that prefix.

create table if not exists public.betterme_admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);
alter table public.betterme_admins enable row level security;
-- No policies: the admin list cannot be read or changed through the API; manage it in the dashboard.

create or replace function public.betterme_is_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.betterme_admins where user_id = (select auth.uid()));
$$;
revoke execute on function public.betterme_is_admin() from public, anon;
grant execute on function public.betterme_is_admin() to authenticated;

create table if not exists public.betterme_books (
  id uuid primary key default gen_random_uuid(),
  file_hash text not null unique,          -- SHA-256 of the PDF: the same file is never stored twice
  title text not null check (char_length(title) between 1 and 300),
  author text check (author is null or char_length(author) <= 200),
  page_count int not null check (page_count > 0),
  color text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  spine_height int not null check (spine_height between 100 and 240),
  has_text boolean not null default true,
  file_name text check (file_name is null or char_length(file_name) <= 300),
  storage_path text not null,
  size_bytes bigint not null check (size_bytes > 0),
  uploaded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists betterme_books_created_at_idx on public.betterme_books (created_at);
create index if not exists betterme_books_uploaded_by_idx on public.betterme_books (uploaded_by);

alter table public.betterme_books enable row level security;

create policy "betterme: anyone can see the shared library"
  on public.betterme_books for select to anon, authenticated using (true);

create policy "betterme: signed-in users can add books"
  on public.betterme_books for insert to authenticated
  with check (uploaded_by = (select auth.uid()) and storage_path like (select auth.uid())::text || '/%');

create policy "betterme: uploader or admin can edit title and colour"
  on public.betterme_books for update to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.betterme_is_admin()))
  with check (uploaded_by = (select auth.uid()) or (select public.betterme_is_admin()));

create policy "betterme: uploader or admin can remove a book"
  on public.betterme_books for delete to authenticated
  using (uploaded_by = (select auth.uid()) or (select public.betterme_is_admin()));

-- Live updates: new books appear on every open device.
alter publication supabase_realtime add table public.betterme_books;

-- PDF files. Public read (it is a shared library); uploads go to <user id>/<file hash>.pdf.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('betterme-books', 'betterme-books', true, 52428800, array['application/pdf'])
on conflict (id) do nothing;

create policy "betterme: signed-in users upload PDFs into their own folder"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'betterme-books' and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "betterme: uploader or admin can delete their PDFs"
  on storage.objects for delete to authenticated
  using (bucket_id = 'betterme-books'
         and ((storage.foldername(name))[1] = (select auth.uid())::text or (select public.betterme_is_admin())));
