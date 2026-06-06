/**
 * paylink — pure, dependency-free helpers for the "Receive" payment-request flow.
 *
 * A pay-link is a plain shareable URL: `https://wallet.suize.io/pay?to=<name>@suize`.
 * It carries the requester's FULL handle (Sui handles are `name@suize`, email-shaped
 * — NOT `@name`) plus an optional amount + note, so anyone can open it and prefill a
 * Send to you. These are display/share strings only — NO backend, NO chain write. The
 * real money still moves through the normal Send flow (people can also just send to
 * your `name@suize` handle directly). Keep deterministic: same input -> same string.
 */

/** The canonical web origin a pay-link points at. */
const PAY_ORIGIN = 'https://wallet.suize.io/pay';

/** True when an amount/note value is present and not just whitespace. */
function present(v?: string | number): v is string | number {
  return v != null && String(v).trim() !== '';
}

/**
 * Build a shareable pay-link for a handle, with an optional amount + note.
 * - `to` is the FULL handle (`name@suize`) — left readable (its chars are URL-safe:
 *   names are [a-z0-9-] and `@` is valid in a query value).
 * - amount / note params are omitted entirely when empty.
 * - the note is encodeURIComponent-escaped.
 */
export function buildPayLink({
  handle,
  amount,
  note,
}: {
  handle: string;
  amount?: string | number;
  note?: string;
}): string {
  const params: string[] = [`to=${(handle || '').trim()}`];
  if (present(amount)) params.push(`amount=${encodeURIComponent(String(amount).trim())}`);
  if (present(note)) params.push(`note=${encodeURIComponent(String(note).trim())}`);
  return `${PAY_ORIGIN}?${params.join('&')}`;
}

/**
 * A real `mailto:` string for the "Email" action — opens the user's mail client
 * with the subject + body prefilled. The body is a short line plus the link, and
 * names the requester by their full `name@suize` handle.
 */
export function payLinkMailto(link: string, handle: string, amount?: string): string {
  const who = (handle || '').trim();
  const subject = 'Pay me on Suize';
  const ask = present(amount) ? ` ${String(amount).trim()}` : '';
  const body = `Hi — you can pay${ask ? ` me${ask}` : ' me'} on Suize${who ? ` (${who})` : ''}.\n\nYou can pay me here: ${link}`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * A short, human share string (for navigator.share text / clipboard) that includes
 * the link. Mentions the amount when one was requested.
 */
export function payLinkShareText(link: string, amount?: string): string {
  const ask = present(amount) ? ` ${String(amount).trim()}` : '';
  return `Pay me${ask} on Suize: ${link}`;
}
