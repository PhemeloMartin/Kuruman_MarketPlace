// Sends text messages (SMS) through BulkSMS (https://www.bulksms.com), when its API token is set:
//   BULKSMS_TOKEN_ID and BULKSMS_TOKEN_SECRET (BulkSMS -> Settings -> API Tokens; kept in Render, never in git).
// Without them - on a laptop, in tests - messages are only written to the server log.
//
// The demo accounts' made-up numbers (071 000 0xxx) never get a real SMS: there is nobody there, and it
// would waste credit. Their messages are logged (and shown on the demo phone page) instead.
//
// SMS_DEMO_SHOW_CODES=true  -> the API returns the code to the browser ("Demo: your code is 123456").
// Only for a demo with made-up accounts: anyone could sign in to any number while it is on.
// It is on by default on a laptop (development) and off by default once hosted (production).

const DEMO_NUMBER = /^\+2771000\d{4}$/;

export const SMS_DEMO_SHOW_CODES =
  process.env.SMS_DEMO_SHOW_CODES !== undefined
    ? process.env.SMS_DEMO_SHOW_CODES === "true"
    : process.env.NODE_ENV !== "production";

export async function sendSms(to: string, text: string): Promise<void> {
  const id = process.env.BULKSMS_TOKEN_ID;
  const secret = process.env.BULKSMS_TOKEN_SECRET;
  if (!id || !secret || DEMO_NUMBER.test(to)) {
    // The phone number is masked in the log: logs get copied and screenshotted.
    console.log(`[SMS to ${to.slice(0, 5)}****${to.slice(-2)}] ${text}`);
    return;
  }
  const res = await fetch("https://api.bulksms.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
    },
    body: JSON.stringify({ to, body: text }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Never log the message itself (it may hold a sign-in code); the status is enough to investigate.
    throw new Error(`SMS gateway refused the message (status ${res.status})`);
  }
}
