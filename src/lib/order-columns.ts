// Columns the Orders, Analytics and Inventory list views actually render.
//
// Deliberately excludes `email_html` (the full HTML of the original
// confirmation email). Those pages used to `select("*")`, which pulled every
// order's stored email — often tens of KB each, held in Postgres TOAST
// storage — on every page load, purely so the Orders detail panel could
// decide whether to show a "Download PDF" button. That was the single
// largest avoidable read in the app. The detail panel now checks for the
// email on demand for the one order being viewed.
//
// Keep this in sync with the `Order` types in those pages: TypeScript will
// not catch a missing column here, it will just arrive as undefined.
export const ORDER_LIST_COLUMNS =
  "id, booking_ref, event_name, venue, event_date, purchased_at, account_email, section, row, seat_from, seat_to, qty_bought, total_cost, sold_total, listing_status, source_type, created_at";
