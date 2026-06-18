export type TemplateVars = {
  customer_name?: string;
  event_name?: string;
  event_date?: string;
  venue?: string;
  section?: string;
  seats?: string;
  quantity?: string | number;
};

export type EmailTemplate = {
  id: string;
  name: string;
  subject: string;
  body: string;
};

export const TEMPLATE_VARS: { key: string; label: string; description: string }[] = [
  { key: "{{customer_name}}", label: "Customer name", description: "Taken from buyer email" },
  { key: "{{event_name}}", label: "Event name", description: "Name of the event" },
  { key: "{{event_date}}", label: "Event date", description: "Date of the event" },
  { key: "{{venue}}", label: "Venue", description: "Venue / stadium" },
  { key: "{{section}}", label: "Section", description: "Seating section / block" },
  { key: "{{seats}}", label: "Seats", description: "Row and seat numbers" },
  { key: "{{quantity}}", label: "Quantity", description: "Number of tickets" },
];

export const DEFAULT_SUBJECT = "Your tickets – {{event_name}}";

export const DEFAULT_BODY = `Hi {{customer_name}},

Thank you for your purchase — it's really appreciated!

Here are your ticket details:

Event: {{event_name}}
Venue: {{venue}}
Date: {{event_date}}
Section: {{section}}
Seats: {{seats}}
Quantity: {{quantity}}

Your tickets will be transferred to you shortly. Please keep an eye on your email for the transfer notification.

If you have any questions at all, feel free to reply to this email and I'll get back to you as soon as possible.

Hope you have an amazing time!

Many thanks`;

const LEGACY_KEY = "client_email_template";
const TEMPLATES_KEY = "client_email_templates_v2";
const ACTIVE_ID_KEY = "client_email_active_id";

export function loadTemplates(): EmailTemplate[] {
  try {
    const stored = localStorage.getItem(TEMPLATES_KEY);
    if (stored) return JSON.parse(stored) as EmailTemplate[];
    // migrate old single template
    const old = localStorage.getItem(LEGACY_KEY);
    if (old) {
      const parsed = JSON.parse(old) as { subject: string; body: string };
      return [{ id: "default", name: "Default", subject: parsed.subject, body: parsed.body }];
    }
  } catch { /* ignore */ }
  return [{ id: "default", name: "Default", subject: DEFAULT_SUBJECT, body: DEFAULT_BODY }];
}

export function saveTemplates(templates: EmailTemplate[]): void {
  try {
    localStorage.setItem(TEMPLATES_KEY, JSON.stringify(templates));
  } catch { /* ignore */ }
}

export function loadActiveTemplateId(): string {
  try {
    return localStorage.getItem(ACTIVE_ID_KEY) ?? "";
  } catch { return ""; }
}

export function saveActiveTemplateId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_ID_KEY, id);
  } catch { /* ignore */ }
}

export function loadTemplate(): { subject: string; body: string } {
  try {
    const templates = loadTemplates();
    if (templates.length === 0) return { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
    const activeId = loadActiveTemplateId();
    const active = templates.find((t) => t.id === activeId) ?? templates[0];
    return { subject: active.subject, body: active.body };
  } catch { /* ignore */ }
  return { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
}

export function saveTemplate(subject: string, body: string): void {
  try {
    localStorage.setItem(LEGACY_KEY, JSON.stringify({ subject, body }));
  } catch { /* ignore */ }
}

export function interpolate(template: string, vars: TemplateVars): string {
  return template
    .replace(/\{\{customer_name\}\}/g, vars.customer_name ?? "")
    .replace(/\{\{event_name\}\}/g, vars.event_name ?? "")
    .replace(/\{\{event_date\}\}/g, vars.event_date ?? "")
    .replace(/\{\{venue\}\}/g, vars.venue ?? "")
    .replace(/\{\{section\}\}/g, vars.section ?? "")
    .replace(/\{\{seats\}\}/g, vars.seats ?? "")
    .replace(/\{\{quantity\}\}/g, String(vars.quantity ?? ""));
}
