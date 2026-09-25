// Phase 1 languages: the Google Translate website widget (agreed in docs/PROJECT_BRIEF.md, section 3).
// This is a TEMPORARY measure. Machine translation of payment and legal wording is not final
// (spec NFR-09) - reviewed translations by fluent speakers replace this later.

export type LanguageCode = 'en' | 'tn' | 'af'

export const LANGUAGES: { code: LanguageCode; label: string; name: string }[] = [
  { code: 'en', label: 'EN', name: 'English' },
  { code: 'tn', label: 'TN', name: 'Setswana' },
  { code: 'af', label: 'AF', name: 'Afrikaans' },
]

declare global {
  interface Window {
    googleTranslateElementInit?: () => void
    google?: any
  }
}

// Google Translate remembers the chosen language in a cookie called "googtrans".
export function currentLanguage(): LanguageCode {
  const match = document.cookie.match(/(?:^|; )googtrans=\/en\/(\w+)/)
  const code = match?.[1]
  return code === 'tn' || code === 'af' ? code : 'en'
}

export function setLanguage(code: LanguageCode) {
  const expires = code === 'en' ? 'Thu, 01 Jan 1970 00:00:00 GMT' : 'Fri, 31 Dec 2100 23:59:59 GMT'
  document.cookie = `googtrans=/en/${code}; path=/; expires=${expires}`
  localStorage.setItem('kmp_language', code)
  // Reloading is the most reliable way to have the widget translate (or un-translate) the page.
  window.location.reload()
}

// Google Translate edits the page's text nodes directly, which can confuse React when it later
// updates the same nodes. This well-known guard stops those edits from crashing the app.
function guardReactAgainstTranslator() {
  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) return child
    return originalRemoveChild.call(this, child) as T
  }
  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) return node
    return originalInsertBefore.call(this, node, ref) as T
  }
}

// Only loads Google's script when someone has picked Setswana or Afrikaans,
// so English users don't download anything extra.
export function initTranslation() {
  if (currentLanguage() === 'en') return
  guardReactAgainstTranslator()

  const holder = document.createElement('div')
  holder.id = 'google_translate_element'
  document.body.appendChild(holder)

  window.googleTranslateElementInit = () => {
    new window.google.translate.TranslateElement(
      { pageLanguage: 'en', includedLanguages: 'en,tn,af', autoDisplay: false },
      'google_translate_element',
    )
  }
  const script = document.createElement('script')
  script.src = 'https://translate.google.com/translate_a/element.js?cb=googleTranslateElementInit'
  script.async = true
  document.body.appendChild(script)
}
