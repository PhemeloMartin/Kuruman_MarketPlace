// Multilingual search glossary: words that mean the same product in English, Setswana and Afrikaans
// (plus common local names). Searching any word in a group also searches the others, so
// "sepinatšhe", "spinasie" and "spinach" find the same things.
//
// This is NOT machine translation and not machine learning: it is a hand-made word list, which is
// honest, explainable and easy to grow. The Setswana and Afrikaans words still need checking by
// fluent speakers (the same status as the AI datasets). Add a group by adding a line.

export const GLOSSARY: string[][] = [
  ["spinach", "sepinatšhe", "spinasie"],
  ["wild spinach", "morogo", "merogo", "imifino"],
  ["tomato", "tomatoes", "tamati", "ditamati", "tamatie", "tamaties"],
  ["onion", "onions", "eie", "uie", "anyanese", "dianyanese"],
  ["potato", "potatoes", "letapola", "ditapola", "aartappel", "aartappels"],
  ["cabbage", "khabetšhe", "kool"],
  ["butternut", "lephutshe", "maphutshe", "botterskorsie", "pumpkin", "pampoen"],
  ["mealies", "maize", "corn", "mmidi", "mielies", "mielie"],
  ["maize meal", "mealie meal", "bupi", "mieliemeel", "pap"],
  ["bread", "borotho", "brood", "loaf"],
  ["fat cakes", "vetkoek", "magwinya", "amagwinya"],
  ["kota", "quarter loaf", "sphatlho", "kwart brood"],
  ["stew", "seshebo", "bredie"],
  ["eggs", "egg", "mae", "lee", "eiers", "eier"],
  ["milk", "mašwi", "maswi", "melk"],
  ["meat", "nama", "vleis"],
  ["chicken", "kgogo", "dikgogo", "hoender", "hen", "hens"],
  ["goat", "goats", "podi", "dipodi", "bok", "bokke"],
  ["sheep", "nku", "dinku", "skaap", "skape"],
  ["cattle", "cow", "kgomo", "dikgomo", "beeste", "koei"],
  ["chicken feed", "layer mash", "dijo tsa dikgogo", "hoenderkos", "lêmeel"],
  ["lucerne", "alfalfa", "furu", "lusern"],
  ["bricks", "brick", "setena", "ditena", "stene", "steen"],
  ["sand", "motlhaba", "sand"],
  ["cement", "samente", "sement"],
  ["beads", "beadwork", "mabenyane", "krale", "kralewerk"],
  ["basket", "seroto", "mandjie"],
  ["dress", "rok", "mosese"],
  ["shoes", "ditlhako", "skoene"],
  ["soap", "molora", "sesepa", "seep"],
  ["lotion", "setlolo", "room", "lyfroom"],
  ["pot", "pitsa", "potjie", "three-legged pot"],
  ["blanket", "kobo", "kombers"],
  ["wood", "firewood", "dikgong", "brandhout", "hout"],
  ["water", "metsi", "water"],
  ["atchar", "atjar", "achaar"],
]

// Lower-case and drop accents, so "sepinatšhe" and "sepinatshe" match (many phones can't type "š").
export function plain(word: string): string {
  return word.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim()
}

// Small spelling slips ("spinich", "tamatos"): one letter different for words of 5-6 letters, two for
// longer words. Short words must match exactly - "pot" and "pap" are different things.
function closeEnough(a: string, b: string): boolean {
  if (a === b) return true
  const shorter = Math.min(a.length, b.length)
  const allowed = shorter >= 7 ? 2 : 1
  if (shorter < 5 || Math.abs(a.length - b.length) > allowed) return false
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let diagonal = prev[0]
    prev[0] = i
    for (let j = 1; j <= b.length; j++) {
      const above = prev[j]
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diagonal + (a[i - 1] === b[j - 1] ? 0 : 1))
      diagonal = above
    }
  }
  return prev[b.length] <= allowed
}

// The words to search for: what was typed, plus every word in a glossary group it belongs to.
export function expandQuery(query: string): { terms: string[]; matchedGroups: string[][] } {
  const typed = plain(query)
  const terms = new Set<string>([typed])
  const matchedGroups: string[][] = []
  for (const group of GLOSSARY) {
    const hit = group.some((w) => {
      const p = plain(w)
      return p === typed || closeEnough(p, typed) || (typed.length >= 4 && p.includes(typed)) || typed.split(/\s+/).some((t) => closeEnough(p, t))
    })
    if (hit) {
      matchedGroups.push(group)
      // Both spellings: with accents (as a product might be named) and without (as people type).
      for (const w of group) {
        terms.add(plain(w))
        terms.add(w.toLowerCase())
      }
    }
  }
  return { terms: [...terms].filter((t) => t.length >= 2), matchedGroups }
}
