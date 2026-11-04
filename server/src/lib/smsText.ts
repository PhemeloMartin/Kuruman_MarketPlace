// Every SMS the platform sends, in English, Setswana and Afrikaans - in one place, so a fluent speaker can
// check them all side by side. Each person gets their SMS in the language of their account (the language
// they chose on the site); a stall's SMS go in the stall owner's language.
//
// The Setswana and Afrikaans texts are DRAFTS until checked by fluent speakers (spec NFR-09, the same
// status as the search glossary). Change only the words in quotes; keep the ${...} parts.
//
// Two rules for every text, checked by `npm run test:sms`:
//   1. One SMS = 160 characters, so keep them short (longer ones cost two SMS). The one exception is the
//      stall's new-order SMS: it lists every item ordered, which the stall holder needs to decide, so a big
//      order can take two SMS; its own words are kept short.
//   2. Only the basic SMS alphabet (GSM-7). One character outside it - Afrikaans ê, ë, ô or Setswana š,
//      curly quotes, a long dash - turns the whole message into "Unicode" SMS, where one SMS holds only
//      70 characters: the same text then costs two or three SMS. So: "se" not "sê", "-" not "–", ' not ’.

export type Lang = "en" | "tn" | "af";
type Args = Record<string, string | number | boolean>;
type Texts = Record<Lang, (a: Args) => string>;

const head = (a: Args) => `KurumanMarketPlace ${a.order}:`;

const TEXTS = {
  // ---- Sign-in and confirmation codes ----
  code: {
    en: (a) => `KurumanMarketPlace ${a.purpose === "sign_in" ? "sign-in" : "confirmation"} code: ${a.code}. It works for ${a.minutes} minutes. Never share it with anyone.`,
    tn: (a) => `KurumanMarketPlace: khoutu ya gago ya ${a.purpose === "sign_in" ? "go tsena" : "go netefatsa"} ke ${a.code}. E dira metsotso e ${a.minutes}. O se ka wa e naya ope.`,
    af: (a) => `KurumanMarketPlace ${a.purpose === "sign_in" ? "aanmeldkode" : "bevestigingskode"}: ${a.code}. Dit werk vir ${a.minutes} minute. Moet dit nooit met iemand deel nie.`,
  },

  // ---- The customer's order ----
  "order.pay_now": {
    en: (a) => `${head(a)} accepted by ${a.shop}. Pay ${a.total} online within ${a.minutes} min: ${a.link}`,
    tn: (a) => `${head(a)} e amogetswe ke ${a.shop}. Duela ${a.total} mo metsotsong e ${a.minutes}: ${a.link}`,
    af: (a) => `${head(a)} aanvaar deur ${a.shop}. Betaal ${a.total} aanlyn binne ${a.minutes} min: ${a.link}`,
  },
  "order.paid": {
    en: (a) => `${head(a)} payment of ${a.total} received. We'll SMS you when it's ready.`,
    tn: (a) => `${head(a)} tuelo ya ${a.total} e amogetswe. Re tla go romelela SMS fa e siametse.`,
    af: (a) => `${head(a)} betaling van ${a.total} ontvang. Ons stuur 'n SMS wanneer dit gereed is.`,
  },
  "order.accepted_cash": {
    en: (a) => `${head(a)} accepted by ${a.shop} (${a.total}, cash). We'll SMS you when it's ready.`,
    tn: (a) => `${head(a)} e amogetswe ke ${a.shop} (${a.total}, kheshe). Re tla go romelela SMS fa e siametse.`,
    af: (a) => `${head(a)} aanvaar deur ${a.shop} (${a.total}, kontant). Ons stuur 'n SMS wanneer dit gereed is.`,
  },
  "order.ready_pickup": {
    en: (a) => `${head(a)} ready to collect at ${a.shop}. Show your code from ${a.link}`,
    tn: (a) => `${head(a)} e siametse go tsewa kwa ${a.shop}. Bontsha khoutu ya gago go tswa mo ${a.link}`,
    af: (a) => `${head(a)} gereed om by ${a.shop} af te haal. Wys jou kode van ${a.link}`,
  },
  "order.on_the_way": {
    en: (a) => `${head(a)} ${a.retry ? "we're delivering again" : "on the way to you"}. Track it, and have your code ready: ${a.link}`,
    tn: (a) => `${head(a)} ${a.retry ? "re e romela gape" : "e mo tseleng"}. E sale morago, mme o baakanye khoutu ya gago: ${a.link}`,
    af: (a) => `${head(a)} ${a.retry ? "ons lewer weer af" : "op pad na jou"}. Volg dit, en hou jou kode gereed: ${a.link}`,
  },
  "order.declined": {
    en: (a) => `${head(a)} ${a.shop} can't take your order${a.why}. You pay nothing.`,
    tn: (a) => `${head(a)} ${a.shop} ga ba kgone go tsaya odara ya gago${a.why}. Ga o duele sepe.`,
    af: (a) => `${head(a)} ${a.shop} kan nie jou bestelling aanvaar nie${a.why}. Jy betaal niks.`,
  },
  "order.expired_unpaid": {
    en: (a) => `${head(a)} not paid in time, so it's cancelled. You pay nothing.`,
    tn: (a) => `${head(a)} ga e a duelwa ka nako, ka jalo e khanseletswe. Ga o duele sepe.`,
    af: (a) => `${head(a)} nie betyds betaal nie, dus is dit gekanselleer. Jy betaal niks.`,
  },
  "order.expired_no_reply": {
    en: (a) => `${head(a)} ${a.shop} didn't answer in time, so it's cancelled. You pay nothing.`,
    tn: (a) => `${head(a)} ${a.shop} ga ba a araba ka nako, ka jalo e khanseletswe. Ga o duele sepe.`,
    af: (a) => `${head(a)} ${a.shop} het nie betyds geantwoord nie, dus is dit gekanselleer. Jy betaal niks.`,
  },
  "order.cancelled_by_support": {
    en: (a) => `${head(a)} cancelled by support. Details: ${a.link}`,
    tn: (a) => `${head(a)} e khanseletswe ke ba thuso. Dintlha: ${a.link}`,
    af: (a) => `${head(a)} deur ondersteuning gekanselleer. Besonderhede: ${a.link}`,
  },
  "order.delivery_failed": {
    en: (a) => `${head(a)} the courier couldn't hand it over. Support will contact you.`,
    tn: (a) => `${head(a)} courier ga a kgona go go neela yone. Ba thuso ba tla ikgolaganya le wena.`,
    af: (a) => `${head(a)} die koerier kon dit nie aan jou oorhandig nie. Ondersteuning sal jou kontak.`,
  },
  "courier.outside": {
    en: (a) => `${head(a)} ${a.name}, your courier, is outside with your order. Your code: ${a.link}`,
    tn: (a) => `${head(a)} ${a.name} (courier) o kwa ntle le odara ya gago. Khoutu ya gago: ${a.link}`,
    af: (a) => `${head(a)} ${a.name} (koerier) is buite met jou bestelling. Jou kode: ${a.link}`,
  },
  "ticket.answered": {
    en: (a) => `KurumanMarketPlace: support answered your question #${a.ticketId} (${a.subject}). Read it: ${a.link}`,
    tn: (a) => `KurumanMarketPlace: ba thuso ba arabile potso ya gago #${a.ticketId} (${a.subject}). E bale: ${a.link}`,
    af: (a) => `KurumanMarketPlace: ondersteuning het jou vraag #${a.ticketId} beantwoord (${a.subject}). Lees dit: ${a.link}`,
  },

  // ---- Orders by SMS, for a stall or shop with a basic phone ----
  "stall.new_order": {
    en: (a) =>
      `${head(a)} ${a.customer} wants ${a.items} ${a.pickup ? "to collect" : "for delivery"}, ${a.total} ${a.cash ? "cash" : "paid online"}. ` +
      `Reply 1 to accept or 2 if sold out, within ${a.minutes} min.`,
    tn: (a) =>
      `${head(a)} ${a.customer} o batla ${a.items} ${a.pickup ? "go di tsaya" : "go di isetswa"}, ${a.total} ${a.cash ? "kheshe" : "e duetswe"}. ` +
      `Araba 1 go amogela, 2 fa di fedile. Mo metsotsong e ${a.minutes}.`,
    af: (a) =>
      `${head(a)} ${a.customer} bestel ${a.items} ${a.pickup ? "om af te haal" : "vir aflewering"}, ${a.total} ${a.cash ? "kontant" : "betaal"}. ` +
      `Antwoord 1 = aanvaar, 2 = uitverkoop, binne ${a.minutes} min.`,
  },
  "stall.help": {
    en: () => `KurumanMarketPlace: reply 1 to accept the newest order, 2 if sold out, or type the customer's 6-digit code when they collect.`,
    tn: () => `KurumanMarketPlace: araba 1 go amogela odara e ntsha, 2 fa di fedile, kgotsa kwala khoutu ya moreki (dinomoro di le 6) fa a tla go tsaya.`,
    af: () => `KurumanMarketPlace: antwoord 1 om die nuutste bestelling te aanvaar, 2 as dit uitverkoop is, of tik die klant se 6-syfer-kode wanneer hulle dit kom haal.`,
  },
  "stall.nothing_waiting": {
    en: () => `KurumanMarketPlace: there's no order waiting for an answer right now.`,
    tn: () => `KurumanMarketPlace: ga go na odara e e emetseng karabo jaanong.`,
    af: () => `KurumanMarketPlace: daar is nou geen bestelling wat op 'n antwoord wag nie.`,
  },
  "stall.too_late": {
    en: (a) => `${head(a)} too late, the ${a.minutes} minutes had passed. The customer was told.`,
    tn: (a) => `${head(a)} go setse go le morago, metsotso e ${a.minutes} e ne e fetile. Moreki o boleletswe.`,
    af: (a) => `${head(a)} te laat, die ${a.minutes} minute was verby. Die klant is laat weet.`,
  },
  "stall.sold_out": {
    en: (a) => `${head(a)} declined as sold out. The customer was told. Thank you.`,
    tn: (a) => `${head(a)} o e ganne ka gonne di fedile. Moreki o boleletswe. Re a leboga.`,
    af: (a) => `${head(a)} afgewys omdat dit uitverkoop is. Die klant is laat weet. Dankie.`,
  },
  "stall.accepted_ready_cash": {
    en: (a) => `${head(a)} accepted. When the customer comes, they show a 6-digit code. Send that code to this number to finish. Collect ${a.total} cash.`,
    tn: (a) => `${head(a)} e amogetswe. Moreki o tla go bontsha khoutu ya dinomoro di le 6: e romele kwa nomorong e. Tsaya ${a.total} kheshe.`,
    af: (a) => `${head(a)} aanvaar. Die klant wys 'n 6-syfer-kode: stuur dit na hierdie nommer om klaar te maak. Vra ${a.total} kontant.`,
  },
  "stall.accepted_online": {
    en: (a) => `${head(a)} accepted. The customer pays online now; you get an SMS when the money is in.`,
    tn: (a) => `${head(a)} e amogetswe. Moreki o duela ka inthanete jaanong; o tla amogela SMS fa madi a tsene.`,
    af: (a) => `${head(a)} aanvaar. Die klant betaal nou aanlyn; jy kry 'n SMS wanneer die geld in is.`,
  },
  "stall.accepted": {
    en: (a) => `${head(a)} accepted. The customer was told.`,
    tn: (a) => `${head(a)} e amogetswe. Moreki o boleletswe.`,
    af: (a) => `${head(a)} aanvaar. Die klant is laat weet.`,
  },
  "stall.paid_ready": {
    en: (a) => `${head(a)} PAID online, ${a.total} - take no cash. When the customer comes, they show a 6-digit code. Send that code to this number to finish.`,
    tn: (a) => `${head(a)} E DUETSWE, ${a.total} - o se ka wa tsaya kheshe. Moreki o tla go bontsha khoutu ya dinomoro di le 6: e romele kwa nomorong e.`,
    af: (a) => `${head(a)} AANLYN BETAAL, ${a.total} - vat geen kontant nie. Die klant wys 'n 6-syfer-kode: stuur dit na hierdie nommer om klaar te maak.`,
  },
  "stall.code_no_match": {
    en: () => `KurumanMarketPlace: that code doesn't match an order waiting at your stall. Check the number with the customer.`,
    tn: () => `KurumanMarketPlace: khoutu eo ga e tsamaelane le odara epe e e go emetseng. Netefatsa dinomoro le moreki.`,
    af: () => `KurumanMarketPlace: daardie kode pas by geen bestelling wat by jou stalletjie wag nie. Kyk die nommer saam met die klant.`,
  },
  "stall.code_correct": {
    en: (a) => `${head(a)} code correct. Hand over ${a.items}.${a.cash ? ` Collect ${a.total} cash.` : " It is already paid."}`,
    tn: (a) => `${head(a)} khoutu e nepagetse. Neela moreki ${a.items}.${a.cash ? ` Tsaya ${a.total} kheshe.` : " E setse e duetswe."}`,
    af: (a) => `${head(a)} kode is reg. Oorhandig ${a.items}.${a.cash ? ` Vra ${a.total} kontant.` : " Dit is reeds betaal."}`,
  },
} satisfies Record<string, Texts>;

export type SmsKey = keyof typeof TEXTS;
export const SMS_KEYS = Object.keys(TEXTS) as SmsKey[];

// The text of one SMS in a person's language (English if we don't know it).
export function smsText(key: SmsKey, language: string | null | undefined, args: Args = {}): string {
  const lang: Lang = language === "tn" || language === "af" ? language : "en";
  return TEXTS[key][lang](args);
}

// GSM-7, the basic SMS alphabet (GSM 03.38). The extension characters count as two.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENDED = "^{}\\[~]|€";

// How a text travels: in the basic alphabet (and how many characters it uses), or as Unicode.
export function smsSize(text: string): { gsm7: boolean; units: number } {
  let units = 0;
  for (const ch of text) {
    if (GSM7_BASIC.includes(ch)) units += 1;
    else if (GSM7_EXTENDED.includes(ch)) units += 2;
    else return { gsm7: false, units: text.length };
  }
  return { gsm7: true, units };
}
