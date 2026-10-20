// Turns an error into one readable line for the setup scripts. Some network errors (e.g. when
// neither the IPv4 nor the IPv6 address of a server can be reached) have an EMPTY message and
// keep the real reasons in `errors` or `code` - so we print those too.
export function describeError(err: unknown): string {
  const e = err as { message?: string; code?: string; errors?: { message?: string; code?: string }[] };
  const parts = [e?.message, e?.code, ...(e?.errors ?? []).map((x) => x.message || x.code)].filter(Boolean);
  return parts.length ? parts.join(" | ") : String(err);
}
