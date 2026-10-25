// WhatsApp links ("click to chat"). They open WhatsApp with a message already typed; nothing is sent
// until the person taps Send. Every message carries a link back to KurumanMarketPlace, so a chat
// that starts on WhatsApp leads back to ordering safely on the site.

// Share with anyone: WhatsApp asks who to send it to.
export function shareLink(text: string, url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`
}

// Chat with a seller who chose to show their WhatsApp number (stored as +27...; wa.me wants 27...).
export function chatLink(phone: string, text: string, url: string): string {
  return `https://wa.me/${phone.replace(/\D/g, '')}?text=${encodeURIComponent(`${text}\n${url}`)}`
}

export const pageUrl = (path: string) => `${window.location.origin}${path}`
