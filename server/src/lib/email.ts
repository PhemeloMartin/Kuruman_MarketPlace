// Sends email through Resend (https://resend.com), when its API key is set:
//   RESEND_API_KEY - Resend -> API Keys (kept in Render, never in git)
//   ADMIN_EMAIL    - where notices for the site's admin go (e.g. a new seller application)
//   EMAIL_FROM     - optional sender. Until the site's own domain is verified in Resend, Resend's test
//                    sender "onboarding@resend.dev" can only send to the Resend account's own address,
//                    which is fine for ADMIN_EMAIL.
// Resend is called over HTTPS, like BulkSMS: free Render services can't send email the old way (SMTP).
// Without the key - on a laptop, in tests - the email is only written to the server log.

const DEFAULT_FROM = "KurumanMarketPlace <onboarding@resend.dev>";

export async function sendEmail(to: string, subject: string, text: string): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (!key || !to) {
    console.log(`[Email to ${to ? to.replace(/^(.).*(@.*)$/, "$1***$2") : "(no address)"}] ${subject}`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ from: process.env.EMAIL_FROM || DEFAULT_FROM, to: [to], subject, text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Email service refused the message (status ${res.status})`);
}

// A notice for the site's admin. Never throws: the action that caused it (e.g. an application) has
// already been saved, and support also sees it in the console.
export async function emailAdmin(subject: string, text: string): Promise<void> {
  await sendEmail(process.env.ADMIN_EMAIL ?? "", subject, text).catch((err) => console.error("Admin email not sent:", err.message));
}
