import crypto from "crypto";

// Twilio, for free calls over mobile data. Two small pieces of Twilio's protocol, written out here
// instead of adding Twilio's whole library, so each step can be explained:
//   1. an ACCESS TOKEN (a signed JWT) that lets this person's browser place ONE kind of call - to our
//      "TwiML app" - for 10 minutes;
//   2. checking the SIGNATURE on Twilio's request to /api/calls/twiml, so only Twilio can ask us to
//      connect a call.
//
// Settings (all from the Twilio console, kept in Render, never in git):
//   TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_API_KEY_SID, TWILIO_API_KEY_SECRET,
//   TWILIO_TWIML_APP_SID, TWILIO_CALLER_ID (the Twilio phone number calls come from).

export function twilioConfigured(): boolean {
  return [
    "TWILIO_ACCOUNT_SID",
    "TWILIO_AUTH_TOKEN",
    "TWILIO_API_KEY_SID",
    "TWILIO_API_KEY_SECRET",
    "TWILIO_TWIML_APP_SID",
    "TWILIO_CALLER_ID",
  ].every((k) => Boolean(process.env[k]));
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

// A Twilio Voice access token: a JWT signed (HMAC-SHA256) with our API key secret.
export function voiceAccessToken(identity: string, ttlSeconds = 600): string {
  const keySid = process.env.TWILIO_API_KEY_SID!;
  const now = Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "HS256", cty: "twilio-fpa;v=1" };
  const payload = {
    jti: `${keySid}-${now}`,
    iss: keySid,
    sub: process.env.TWILIO_ACCOUNT_SID,
    iat: now,
    exp: now + ttlSeconds,
    grants: {
      identity,
      voice: { outgoing: { application_sid: process.env.TWILIO_TWIML_APP_SID }, incoming: { allow: false } },
    },
  };
  const unsigned = `${b64url(JSON.stringify(header))}.${b64url(JSON.stringify(payload))}`;
  const signature = crypto.createHmac("sha256", process.env.TWILIO_API_KEY_SECRET!).update(unsigned).digest("base64url");
  return `${unsigned}.${signature}`;
}

// Twilio signs each request: HMAC-SHA1 (with our auth token) of the full URL followed by every POST
// parameter, sorted by name, written as name+value. We compute the same and compare in constant time.
export function validTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join("");
  const expected = crypto.createHmac("sha1", process.env.TWILIO_AUTH_TOKEN ?? "").update(data).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature ?? "");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const xml = (text: string) => text.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

// TwiML: Twilio's instructions for the call. Dial the number, from our Twilio number, for at most maxSeconds.
export function dialTwiml(to: string, maxSeconds: number): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?><Response>' +
    `<Dial callerId="${xml(process.env.TWILIO_CALLER_ID ?? "")}" timeLimit="${maxSeconds}"><Number>${xml(to)}</Number></Dial>` +
    "</Response>"
  );
}

export function sayTwiml(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${xml(message)}</Say><Hangup/></Response>`;
}
