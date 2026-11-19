// Decides whether the SMS poller's end-of-cycle UPDATE would only rewrite the
// values already stored. Used by app/api/cron/sms-codes to avoid a redundant
// write every ~3s per account (Supabase Disk IO). See the call site.

export type CursorState = {
  lastSeenAt: string | null;
  signatures: string[] | null;
  error: string | null;
};

// Timestamps are compared as instants, never raw strings: Postgres returns
// "+00:00" while JS produces "Z" for the same moment.
function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  return new Date(a).getTime() === new Date(b).getTime();
}

function sameList(a: string[] | null, b: string[] | null): boolean {
  const left = a ?? [];
  const right = b ?? [];
  return left.length === right.length && left.every((v, i) => v === right[i]);
}

export function isNoopCursorUpdate(args: {
  isFirstPoll: boolean;
  newMessageCount: number;
  previous: CursorState;
  next: CursorState;
}): boolean {
  const { isFirstPoll, newMessageCount, previous, next } = args;
  return (
    !isFirstPoll &&
    newMessageCount === 0 &&
    sameInstant(previous.lastSeenAt, next.lastSeenAt) &&
    sameList(previous.signatures, next.signatures) &&
    (previous.error ?? null) === (next.error ?? null)
  );
}
