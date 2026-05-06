export type TemplateVars = {
  customer_name?: string;
  event_name?: string;
  event_date?: string;
  venue?: string;
  section?: string;
  seats?: string;
  quantity?: string | number;
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

Thank you so much for your purchase. Here are your ticket details:

Event: {{event_name}}
Venue: {{venue}}
Date: {{event_date}}
Section: {{section}}
{{seats}}
Quantity: {{quantity}}

If you have any questions please don't hesitate to get in touch.

Thanks`;

const STORAGE_KEY = "client_email_template";

export function loadTemplate(): { subject: string; body: string } {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) return JSON.parse(stored) as { subject: string; body: string };
  } catch { /* ignore */ }
  return { subject: DEFAULT_SUBJECT, body: DEFAULT_BODY };
}

export function saveTemplate(subject: string, body: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ subject, body }));
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
