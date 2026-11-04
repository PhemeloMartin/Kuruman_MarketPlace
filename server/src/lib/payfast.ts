import crypto from "crypto";
import dns from "dns/promises";
import { canonicalSiteUrl, cleanSiteUrl } from "./seo";

// Payfast (sandbox) integration, following Payfast's documented "custom integration":
//   1. We build a signed form and the customer's browser posts it to Payfast.
//   2. The customer pays on Payfast's own page - we never see card or bank details.
//   3. Payfast's server sends an ITN (Instant Transaction Notification) to our notify_url.
//   4. We verify the ITN: signature, merchant, source IP, amount, and a server-to-server
//      "validate" call - and only then treat the money as real (spec 5.5, BR-07, BR-08).

export interface PayfastConfig {
  merchantId: string;
  merchantKey: string;
  passphrase: string;
  processUrl: string;
  validateUrl: string;
  publicAppUrl: string; // where the customer's browser comes back to (return/cancel)
  notifyUrl: string; // must be reachable by Payfast's servers
  verifySourceIp: boolean;
  verifyWithServer: boolean;
}

export function payfastConfig(): PayfastConfig | null {
  const e = process.env;
  if (!e.PAYFAST_MERCHANT_ID || !e.PAYFAST_MERCHANT_KEY) return null;
  const sandbox = e.PAYFAST_SANDBOX !== "false";
  const host = sandbox ? "https://sandbox.payfast.co.za" : "https://www.payfast.co.za";
  return {
    merchantId: e.PAYFAST_MERCHANT_ID,
    merchantKey: e.PAYFAST_MERCHANT_KEY,
    passphrase: e.PAYFAST_PASSPHRASE ?? "",
    processUrl: `${host}/eng/process`,
    validateUrl: `${host}/eng/query/validate`,
    // Where Payfast sends the customer back: PUBLIC_APP_URL cleaned up, else the site's main address.
    publicAppUrl: cleanSiteUrl(e.PUBLIC_APP_URL) ?? canonicalSiteUrl(),
    notifyUrl: e.PAYFAST_NOTIFY_URL ?? `http://localhost:${e.PORT ?? 4000}/api/payments/payfast/notify`,
    // Both checks are ON unless explicitly switched off for local contract tests.
    verifySourceIp: e.PAYFAST_VERIFY_SOURCE_IP !== "false",
    verifyWithServer: e.PAYFAST_VERIFY_WITH_SERVER !== "false",
  };
}

// Payfast signs values encoded the way PHP's urlencode() does: spaces become "+",
// and only letters, digits and - _ . stay as they are.
export function payfastEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%20/g, "+");
}

// The signature is an MD5 of "key=value&key=value...&passphrase=..." in the fields' own order,
// leaving out empty values and the signature itself.
export function payfastSignature(fields: [string, string][], passphrase: string): string {
  const parts = fields
    .filter(([k, v]) => k !== "signature" && v !== "")
    .map(([k, v]) => `${k}=${payfastEncode(v.trim())}`);
  if (passphrase) parts.push(`passphrase=${payfastEncode(passphrase.trim())}`);
  return crypto.createHash("md5").update(parts.join("&")).digest("hex");
}

// ITN signature, as in Payfast's ITN example: every field Payfast sent, in its order,
// up to (not including) "signature" - empty values included.
export function itnSignature(fields: [string, string][], passphrase: string): string {
  const parts: string[] = [];
  for (const [k, v] of fields) {
    if (k === "signature") break;
    parts.push(`${k}=${payfastEncode(v)}`);
  }
  if (passphrase) parts.push(`passphrase=${payfastEncode(passphrase.trim())}`);
  return crypto.createHash("md5").update(parts.join("&")).digest("hex");
}

export function centsToAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, "0")}`;
}

// "75.00" -> 7500, without floating-point maths. Returns null if it isn't a money amount.
export function amountToCents(amount: string): number | null {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  return m ? Number(m[1]) * 100 + Number((m[2] ?? "0").padEnd(2, "0")) : null;
}

// The form the customer's browser posts to Payfast. Field ORDER matters for the signature.
export function buildCheckout(
  cfg: PayfastConfig,
  attempt: { reference: string; amountCents: number; orderNumber: string; orderId: number }
) {
  const fields: [string, string][] = [
    ["merchant_id", cfg.merchantId],
    ["merchant_key", cfg.merchantKey],
    ["return_url", `${cfg.publicAppUrl}/orders?payment=returned`],
    ["cancel_url", `${cfg.publicAppUrl}/orders?payment=cancelled`],
    ["notify_url", cfg.notifyUrl],
    ["m_payment_id", attempt.reference],
    ["amount", centsToAmount(attempt.amountCents)],
    ["item_name", `KurumanMarketPlace order ${attempt.orderNumber}`],
  ];
  fields.push(["signature", payfastSignature(fields, cfg.passphrase)]);
  return { action: cfg.processUrl, fields: Object.fromEntries(fields) };
}

// Payfast's servers: their documented host names (the check in Payfast's own sample code) and the IP
// ranges Payfast publishes for its notifications. The ITN must come from one of these addresses.
const PAYFAST_HOSTS = ["www.payfast.co.za", "sandbox.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"];
const PAYFAST_RANGES = ["197.97.145.144/28", "41.74.179.192/27", "102.216.36.0/28", "102.216.36.128/28", "144.126.193.139/32"];

// Is this IPv4 address inside a range like 197.97.145.144/28 (the first 28 bits must match)?
function inRange(ip: string, cidr: string): boolean {
  const asNumber = (a: string) => a.split(".").reduce((n, part) => n * 256 + Number(part), 0);
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) return false;
  const [base, bits] = cidr.split("/");
  const block = 2 ** (32 - Number(bits));
  return Math.floor(asNumber(ip) / block) === Math.floor(asNumber(base) / block);
}

export async function isPayfastIp(ip: string): Promise<boolean> {
  const clean = ip.trim().replace(/^::ffff:/, "");
  if (PAYFAST_RANGES.some((r) => inRange(clean, r))) return true;
  const lists = await Promise.all(PAYFAST_HOSTS.map((h) => dns.resolve4(h).catch(() => [] as string[])));
  return lists.flat().includes(clean);
}

// Did a request come from Payfast? Behind a hosting proxy (Render, Cloudflare) the sender's address can be
// any entry of the X-Forwarded-For list, so all of them are checked. Those entries could be typed in by
// anyone, which is why the signature and Payfast's own confirmation are always checked as well.
export async function fromPayfast(addresses: string[]): Promise<boolean> {
  for (const a of addresses.filter(Boolean)) if (await isPayfastIp(a)) return true;
  return false;
}

// Server-to-server confirmation: we post the same data back and Payfast answers "VALID".
export async function confirmWithPayfast(cfg: PayfastConfig, fields: [string, string][]): Promise<boolean> {
  const body = fields
    .filter(([k]) => k !== "signature")
    .map(([k, v]) => `${k}=${payfastEncode(v)}`)
    .join("&");
  try {
    const res = await fetch(cfg.validateUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(5000),
    });
    return (await res.text()).trim() === "VALID";
  } catch {
    return false;
  }
}

// Parses an x-www-form-urlencoded body while KEEPING the field order Payfast used.
export function parseFormInOrder(raw: string): [string, string][] {
  return raw
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      const decode = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
      return [decode(i < 0 ? pair : pair.slice(0, i)), decode(i < 0 ? "" : pair.slice(i + 1))] as [string, string];
    });
}
