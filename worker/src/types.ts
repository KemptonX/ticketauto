export type JobStatus =
  | "queued" | "validating" | "logging_in" | "session_checking"
  | "opening_event_page" | "verifying_event" | "clicking_sell"
  | "selecting_quantity" | "selecting_split_rule" | "filling_ticket_details"
  | "filling_features_restrictions" | "selecting_ticket_provider"
  | "filling_seat_details" | "filling_price" | "final_review"
  | "submitting_listing" | "waiting_for_confirmation"
  | "listed" | "failed" | "needs_reconnect" | "verification_required"
  | "unknown_needs_review" | "cancelled";

export interface JobDraft {
  id: string;
  marketplace: string;
  viagogoEventId: string;
  quantity: number;
  splitRule: string;
  ticketType: string;
  ticketStorageProvider: string;
  section: string;
  row: string;
  seatFrom: string;
  seatTo: string;
  pricePerTicket: number;
  currency: string;
  faceValuePerTicket: number;
  listingFeatures: string;
  comments: string;
  restrictions: string;
  limitations: string;
  aboutYouConfirmed: boolean;
  termsConfirmed: boolean;
}

export interface JobEventMatch {
  viagogoEventId: string;
  viagogoEventUrl: string;
  viagogoEventName: string;
  viagogoEventDate: string;
  tixTrackerEventDate: string;
  tixTrackerEventName: string;
  viagogoVenue: string;
}

export interface JobAccount {
  id: string;
  displayEmail: string;
  credentials: { email: string; password: string };
  sessionData: { cookies: BrowserCookie[] } | null;
}

export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface Job {
  id: string;
  userId: string;
  orderId: number;
  draft: JobDraft;
  eventMatch: JobEventMatch;
  account: JobAccount;
}

export interface JobUpdatePayload {
  status: JobStatus;
  currentStep?: string;
  errorCode?: string;
  errorMessage?: string;
  resultListingId?: string;
  resultListingUrl?: string;
  pendingVerification?: boolean;
  encryptedSession?: string;
}

export type ReportFn = (status: JobStatus, extra?: Partial<JobUpdatePayload>) => Promise<void>;
