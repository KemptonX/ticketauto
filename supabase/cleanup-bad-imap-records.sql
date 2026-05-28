-- Find orders with venue set to an image/asset URL (from mailparser html-to-text bug)
-- Review these before running the UPDATE
SELECT id, booking_ref, event_name, venue, created_at
FROM orders
WHERE venue ~ 'https?://'
   OR venue ~ '\.(png|jpe?g|gif|webp|svg|ico)\b'
   OR venue ILIKE '%ico-location%'
   OR venue ILIKE '%email.axs.%'
ORDER BY created_at DESC;

-- Clear the bad venue values (set to empty string so re-scan can populate them)
UPDATE orders
SET venue = ''
WHERE venue ~ 'https?://'
   OR venue ~ '\.(png|jpe?g|gif|webp|svg|ico)\b'
   OR venue ILIKE '%ico-location%'
   OR venue ILIKE '%email.axs.%';

-- After running the UPDATE, trigger a manual scan to re-process affected emails.
-- The fixed imap-sync.ts will now correctly extract venue from the HTML body
-- using the same stripHtml() path as Gmail.
