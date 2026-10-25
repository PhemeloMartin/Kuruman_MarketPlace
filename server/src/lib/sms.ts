// Sends text messages (SMS).
//
// No SMS gateway is connected yet. Until one is, messages are written to the server log instead,
// and - in demo mode only - the sign-in code is also shown on screen, so the demo works without
// paying for SMS. Connecting a gateway later only changes sendSms() below.
//
// SMS_DEMO_SHOW_CODES=true  -> the API returns the code to the browser ("Demo: your code is 123456").
// Only for a demo with made-up accounts: anyone could sign in to any number while it is on.
// It is on by default on a laptop (development) and off by default once hosted (production).

export const SMS_DEMO_SHOW_CODES =
  process.env.SMS_DEMO_SHOW_CODES !== undefined
    ? process.env.SMS_DEMO_SHOW_CODES === "true"
    : process.env.NODE_ENV !== "production";

export async function sendSms(to: string, text: string): Promise<void> {
  // The phone number is masked in the log: logs get copied and screenshotted.
  console.log(`[SMS to ${to.slice(0, 5)}****${to.slice(-2)}] ${text}`);
}
