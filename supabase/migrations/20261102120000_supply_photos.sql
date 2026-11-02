-- A picture for each supply, so everyone can see what to count and load.
-- The file lives in the private photos bucket in the business's folder:
-- <company id>/supplies/<file>. Admins and managers set it (same as editing
-- the supply), and everyone in the business can see it. Photo cleanup only
-- clears waste and count photos, so these stay.
alter table public.supplies add column photo_path text
  check (photo_path is null or (split_part(photo_path, '/', 1) = company_id::text and length(photo_path) <= 200));
