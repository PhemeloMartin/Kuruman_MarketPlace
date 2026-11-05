import { marketInfo } from '../components/Markets'
import type { Credit } from '../components/Markets'

// A product without a photo of its own gets a photo of its kind, found by words in its name
// (client/public/products/), or else its market's photo. The seller's own photo replaces it as soon as
// they add one.
// The photos are from Wikimedia Commons; the Photo credits page names who took them (their licences ask
// for that).
//
// The first match wins, so the more specific words come first ("vetkoek with mince" before "vetkoek",
// "chicken feed" before "chicken").
interface Example {
  words: RegExp
  file: string
  what: string
  credit: Credit
}

const EXAMPLES: Example[] = [
  {
    words: /vetkoek.*mince/i,
    file: 'vetkoek-mince',
    what: 'Vetkoek with mince',
    credit: {
      text: 'Picture: Stasia007, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Vetkoek_and_fish_curry.jpg',
    },
  },
  {
    words: /kota/i,
    file: 'kota',
    what: 'Kota',
    credit: {
      text: 'Picture: Andy Li, CC0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Bunny_Chow_with_Lamb_%26_Potato_-_African_Chow_2023-07-27.jpg',
    },
  },
  {
    words: /magwinya|fat ?cake/i,
    file: 'magwinya',
    what: 'Magwinya (fat cakes)',
    credit: {
      text: 'Picture: Deborah Tjituka, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Fat_cakes_and_soup_breakfast.jpg',
    },
  },
  {
    words: /vetkoek/i,
    file: 'vetkoek',
    what: 'Vetkoek',
    credit: {
      text: 'Picture: NJR ZA, CC BY-SA 3.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Vetkoek_with_mince-001.jpg',
    },
  },
  {
    words: /\bpap\b/i,
    file: 'pap-and-stew',
    what: 'Pap and stew',
    credit: {
      text: 'Picture: Puoyaka, CC0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Pap_and_Beef_Stew.jpg',
    },
  },
  {
    words: /maize meal|mielie ?meal|mealie ?meal/i,
    file: 'maize-meal',
    what: 'Maize meal',
    credit: {
      text: 'Picture: Tenaciuos Ntaawa, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Corn_flour_for_sale.jpg',
    },
  },
  {
    words: /mealie|mielie|maize|corn/i,
    file: 'green-mealies',
    what: 'Green mealies',
    credit: {
      text: 'Picture: Colin, CC BY 2.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Corn_on_the_cob_in_Norwich_Market.jpg',
    },
  },
  {
    words: /bread|loaf/i,
    file: 'bread',
    what: 'Brown bread',
    credit: {
      text: 'Picture: Daderot, CC0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Boston_Brown_Bread_loaf_-_Massachusetts.jpg',
    },
  },
  {
    words: /morogo|wild spinach/i,
    file: 'morogo',
    what: 'Morogo',
    credit: {
      text: 'Picture: Sharon the Bubbly Maker, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Morogo_in_a_size_30_pot_about_to_be_cooked_in_Mookane,_Botswana.jpg',
    },
  },
  {
    words: /spinach|chard/i,
    file: 'spinach',
    what: 'Spinach',
    credit: {
      text: 'Picture: Jeffery Martin, CC0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Organic_Swiss_chard_bunches.jpg',
    },
  },
  {
    words: /tomato/i,
    file: 'tomatoes',
    what: 'Tomatoes',
    credit: {
      text: 'Picture: Softeis, CC BY-SA 3.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Tomato_je.jpg',
    },
  },
  {
    words: /onion/i,
    file: 'onions',
    what: 'Onions',
    credit: {
      text: 'Picture: Jubair Bin Iqbal, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Indian_Onion.jpg',
    },
  },
  {
    words: /butternut|pumpkin|squash/i,
    file: 'butternut',
    what: 'Butternut',
    credit: {
      text: 'Picture: George Chernilevsky, public domain, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Cucurbita_moschata_Butternut_2012_G2.jpg',
    },
  },
  {
    words: /goat/i,
    file: 'goat-kid',
    what: 'Boer goat kids',
    credit: {
      text: 'Picture: Michael Gäbler, CC BY 3.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Boer_goat_with_two_kids.jpg',
    },
  },
  {
    words: /\bmash\b|feed/i,
    file: 'chicken-feed',
    what: 'Chicken feed',
    credit: {
      text: 'Picture: Thabizolo, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Poultry_farming_01.jpg',
    },
  },
  {
    words: /\bhens?\b|chicken|poultry/i,
    file: 'hen',
    what: 'Hens',
    credit: {
      text: 'Picture: Adoscam, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Des_Poulets_Goliath_de_couleur_beige_dans_un_poulailler_au_B%C3%A9nin.jpg',
    },
  },
  {
    words: /lucerne|alfalfa|\bhay\b/i,
    file: 'lucerne',
    what: 'Lucerne bale',
    credit: {
      text: 'Picture: Gary D Robson, CC BY-SA 3.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Alfalfa_round_bales.jpg',
    },
  },
  {
    words: /brick/i,
    file: 'bricks',
    what: 'Cement bricks',
    credit: {
      text: 'Picture: Bhaskaranaidu, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Preparation_of_cement_bricks._at_Turkyamjal_village.jpg',
    },
  },
  {
    words: /cement/i,
    file: 'cement',
    what: 'Cement',
    credit: {
      text: 'Picture: KVDP, public domain, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Portland_Cement_Bags.jpg',
    },
  },
  {
    words: /\bsand\b/i,
    file: 'sand',
    what: 'Building sand',
    credit: {
      text: 'Picture: Johnnybam, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Pile_of_Sand_for_Building_in_Anambra_State.jpg',
    },
  },
  {
    words: /bracelet/i,
    file: 'bracelet',
    what: 'Beaded bracelet',
    credit: {
      text: 'Picture: Simon Pierre Barrette, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:Bracelet_11-o.lau-F180.LA1029.jpg',
    },
  },
  {
    words: /key ?ring|bead/i,
    file: 'beaded-keyring',
    what: 'Beaded key rings',
    credit: {
      text: 'Picture: AlejandroLinaresGarcia, CC BY-SA 4.0, via Wikimedia Commons (cropped)',
      href: 'https://commons.wikimedia.org/wiki/File:ExpoIndigenous2015_057.JPG',
    },
  },
]

export const EXAMPLE_PHOTOS = EXAMPLES.map(({ what, credit }) => ({ what, credit }))

export function examplePhoto(name: string, category?: string): string | null {
  const match = EXAMPLES.find((e) => e.words.test(name))
  if (match) return `/products/${match.file}.webp`
  return category ? (marketInfo(category).photo ?? null) : null
}
