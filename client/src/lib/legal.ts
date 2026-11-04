// The details the law asks an online shop to show (Electronic Communications and Transactions Act,
// section 43), in ONE place: the terms of use, returns policy and privacy notice all read them from here.
// Replace every [ ... ] with the real details before relying on the pages.
export const LEGAL = {
  tradingName: 'KurumanMarketPlace',
  operator: '[Your full name, or your registered business name]',
  legalStatus: '[e.g. "a sole proprietor" or "a private company (Pty) Ltd"]',
  registrationNumber: '[Company registration number, if registered]',
  physicalAddress: '[Street address in Kuruman where legal documents may be delivered]',
  phone: '[Contact phone number]',
  email: '[Contact email address]',
  website: 'https://kurumanmarketplace.co.za',
  informationOfficer: '[Name of the Information Officer - can be the owner]',
}

// The date the terms of use, the returns & refunds policy and the privacy notice last changed. The
// server keeps the same value (POLICY.termsVersion) and asks everyone to accept again when it changes.
export const TERMS_DATE = '4 November 2026'

// Shows a detail, marking the ones still to be filled in so they stand out.
export function isPlaceholder(value: string): boolean {
  return value.startsWith('[')
}
