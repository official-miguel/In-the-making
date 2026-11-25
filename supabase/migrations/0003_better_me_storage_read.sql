-- Better Me: let the app look up files in its bucket.
-- Supabase Storage checks SELECT permission before it deletes a file, so without this policy
-- "remove for everyone" deleted the book's row but left its PDF behind in storage.
-- The bucket is a public shared library, so reading is open to everyone (same as the public URL).

create policy "betterme: anyone can read library PDFs"
  on storage.objects for select to anon, authenticated
  using (bucket_id = 'betterme-books');
