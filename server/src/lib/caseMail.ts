import { pool } from "../db";
import { sendEmail } from "./email";
import { canonicalSiteUrl } from "./seo";

// Contact with someone who applied to sell or deliver, kept with their application as a trail (case_messages):
// every email the site sends them - by itself or written by support - and changes they make, such as a
// new ID document. They answer by replying: the reply goes to the admin's own inbox (Reply-To), so the
// conversation carries on there. Documents are never sent by email: someone who sent a wrong one uploads
// a new one on their Profile.

const site = () => canonicalSiteUrl();

// Emails the applicant (the address they gave when applying) and records it. Never throws: whatever
// caused it is already saved; a failed email shows as "failed" in the trail so support can follow up.
export async function emailApplicant(caseId: number, subject: string, message: string, sentBy: number | null): Promise<boolean> {
  const c = await pool.query(
    "SELECT c.details->>'email' AS email, split_part(u.display_name, ' ', 1) AS first_name FROM support_cases c JOIN users u ON u.id = c.requester_id WHERE c.id = $1",
    [caseId]
  );
  const to = c.rows[0]?.email;
  if (!to) return false;
  // Support may start with their own greeting ("Hello Lesego, ..."): then don't add a second one.
  const greeted = /^(hello|hi|dear|good (morning|afternoon|evening)|dumela|goeie|molo)\b/i.test(message.trim());
  const body = `${greeted ? "" : `Hello ${c.rows[0].first_name},\n\n`}${message}\n\nTo answer, simply reply to this email.\n\nKurumanMarketPlace\n${site()}`;
  let status = "sent";
  try {
    await sendEmail(to, subject, body);
  } catch (err) {
    status = "failed";
    console.error("Email to applicant not sent:", (err as Error).message);
  }
  await pool.query(
    "INSERT INTO case_messages (case_id, kind, sent_by, to_email, subject, body, status) VALUES ($1, 'email', $2, $3, $4, $5, $6)",
    [caseId, sentBy, to, subject, body, status]
  );
  return status === "sent";
}

// Something the applicant did, for the trail (e.g. "uploaded a new ID document").
export async function noteOnCase(caseId: number, text: string, by: number | null): Promise<void> {
  await pool.query("INSERT INTO case_messages (case_id, kind, sent_by, body) VALUES ($1, 'note', $2, $3)", [caseId, by, text]);
}

// What someone applied for, for the emails: `sell as "Lesego's Sewing"` or `deliver in Seoding`.
export function applicationWhat(caseType: string, details: Record<string, string>): string {
  return caseType === "seller_application" ? `sell as "${details.businessName}"` : `deliver in ${details.area}`;
}

// The three emails the site sends by itself, to sellers and couriers who applied.
export const applicantEmails = {
  received: (what: string, seller: boolean) => ({
    subject: `We received your application to ${seller ? "sell" : "deliver"} on KurumanMarketPlace`,
    message:
      `Thank you for applying to ${what} on KurumanMarketPlace.\n\n` +
      `We'll check your details and documents, usually within 2 working days, and we may phone you. ` +
      `You can see where your application is under Profile: ${site()}/profile\n\n` +
      `Sent a wrong or unclear document? Upload a new one under Profile. Please don't send documents by email.`,
  }),
  approved: (what: string, seller: boolean) => ({
    subject: seller ? "You can now sell on KurumanMarketPlace" : "You can now deliver on KurumanMarketPlace",
    message:
      `Good news: your application to ${what} was approved.\n\n` +
      (seller
        ? `Sign in with your phone number and open My shop to add your products: ${site()}/seller`
        : `Sign in with your phone number and open Deliveries to see open jobs: ${site()}/courier`),
  }),
  rejected: (what: string, reason: string) => ({
    subject: "About your application on KurumanMarketPlace",
    message:
      `Your application to ${what} wasn't approved this time.\n\nThe reason: ${reason}\n\n` +
      `You can apply again under Profile once it's sorted out: ${site()}/profile`,
  }),
};
