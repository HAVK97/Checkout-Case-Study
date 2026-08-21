import type { MatchRule, ReasonCodeDef } from "./types";

// Hand-coded from docs/reason_codes.md. These are simplified take-home rules,
// not real Visa VCR / Mastercard Chargeback Guide requirements — see that
// file for the caveat. Encoded in code (not parsed from markdown at runtime)
// so ALL-vs-ANY-N thresholds and the two non-representable exception codes
// (Visa 10.5, Mastercard 4870) are never left to the LLM's judgement.

export const REASON_CODES: ReasonCodeDef[] = [
  {
    code: "10.4",
    scheme: "visa",
    label: "Other Fraud, Card Absent Environment",
    issuerClaim: "Cardholder denies authorising a card-not-present transaction.",
    match: { type: "any", n: 2 },
    requirements: [
      { id: "10.4.1", label: "Same card + same shipping address in two prior undisputed transactions, 120–365 days before this one" },
      { id: "10.4.2", label: "Evidence the cardholder is in possession of / using the merchandise" },
      { id: "10.4.3", label: "For digital goods: device fingerprint, IP, geolocation, account login matching prior undisputed transactions" },
      { id: "10.4.4", label: "Proof of delivery to the cardholder's verified billing address with signature" },
    ],
  },
  {
    code: "10.5",
    scheme: "visa",
    label: "Visa Fraud Monitoring Program",
    issuerClaim: "Transaction flagged under Visa's fraud monitoring program.",
    match: { type: "exception" },
    exceptionNote:
      "Generally cannot be represented. Recommend accept_liability unless the merchant can prove the transaction was miscoded by the issuer.",
    requirements: [
      { id: "10.5.1", label: "Evidence the transaction was miscoded by the issuer (the only path to representment)" },
    ],
  },
  {
    code: "12.5",
    scheme: "visa",
    label: "Incorrect Amount",
    issuerClaim: "The amount charged does not match the amount the cardholder authorised.",
    match: { type: "all" },
    requirements: [
      { id: "12.5.1", label: "Signed receipt, terms of service, or order confirmation showing the agreed amount" },
      { id: "12.5.2", label: "Documentation the amount charged matches the agreed amount" },
      { id: "12.5.3", label: "If a tip/gratuity/adjustment was added, evidence the cardholder authorised it" },
    ],
  },
  {
    code: "12.6.1",
    scheme: "visa",
    label: "Duplicate Processing",
    issuerClaim: "The same transaction was processed more than once.",
    match: { type: "all" },
    requirements: [
      { id: "12.6.1.1", label: "Evidence the two transactions are for two separate purchases (different order IDs / items / services)" },
      { id: "12.6.1.2", label: "Documentation of each purchase event (separate invoices, deliveries, or service dates)" },
      { id: "12.6.1.3", label: "Transaction timestamps and authorisation codes for each charge" },
    ],
  },
  {
    code: "13.1",
    scheme: "visa",
    label: "Merchandise / Services Not Received",
    issuerClaim: "Cardholder paid but never received the goods or services.",
    match: { type: "all" },
    requirements: [
      { id: "13.1.1", label: "Proof of delivery: tracking number, carrier, confirmation of delivery to the cardholder's address" },
      { id: "13.1.2", label: "For services: evidence the service was rendered on or before the expected date" },
      { id: "13.1.3", label: "Date of delivery / service rendered is on or before the chargeback date" },
      { id: "13.1.4", label: "Delivery address materially matches the address the cardholder provided at purchase" },
    ],
  },
  {
    code: "13.2",
    scheme: "visa",
    label: "Cancelled Recurring Transaction",
    issuerClaim: "Cardholder cancelled a recurring subscription but was still charged.",
    match: { type: "all" },
    requirements: [
      { id: "13.2.1", label: "Terms of service disclosing the recurring billing arrangement and cancellation method" },
      { id: "13.2.2", label: "Evidence the cardholder was notified of the upcoming charge (typically 7+ days in advance)" },
      { id: "13.2.3", label: "No record of a cancellation request prior to the billing date" },
      { id: "13.2.4", label: "Evidence of the cardholder's original opt-in to the recurring arrangement" },
    ],
  },
  {
    code: "13.3",
    scheme: "visa",
    label: "Not as Described or Defective Merchandise",
    issuerClaim: "Cardholder received the goods but they are materially not as described or defective.",
    match: { type: "all" },
    requirements: [
      { id: "13.3.1", label: "The merchant's published description of the item purchased" },
      { id: "13.3.2", label: "Evidence the item delivered matches that description (photos, specs, serial number)" },
      { id: "13.3.3", label: "Evidence of an unused return/refund route, OR the cardholder retained the merchandise after complaining" },
    ],
  },
  {
    code: "13.6",
    scheme: "visa",
    label: "Credit Not Processed",
    issuerClaim: "The merchant agreed to a refund but never processed it.",
    match: { type: "any", n: 1 },
    requirements: [
      { id: "13.6.1", label: "Evidence a refund was processed (refund transaction ID, date, amount)" },
      { id: "13.6.2", label: "Evidence no refund was ever agreed (refund policy + absence of any refund commitment)" },
    ],
  },
  {
    code: "13.7",
    scheme: "visa",
    label: "Cancelled Merchandise / Services",
    issuerClaim: "Cardholder cancelled the purchase per the merchant's policy but was charged.",
    match: { type: "all" },
    requirements: [
      { id: "13.7.1", label: "The merchant's cancellation policy as displayed at point of sale" },
      { id: "13.7.2", label: "Evidence the cardholder agreed to that policy" },
      { id: "13.7.3", label: "Evidence the cardholder did not cancel within the window, or cancelled outside the refundable period" },
    ],
  },
  {
    code: "4837",
    scheme: "mastercard",
    label: "No Cardholder Authorisation",
    issuerClaim: "Cardholder denies authorising the transaction (card-not-present fraud equivalent).",
    match: { type: "any", n: 2 },
    requirements: [
      { id: "4837.1", label: "AVS match (full address) AND CVV match on the disputed transaction" },
      { id: "4837.2", label: "3D Secure authentication completed successfully" },
      { id: "4837.3", label: "Two prior undisputed transactions from this cardholder with this merchant in the past 12 months" },
      { id: "4837.4", label: "Proof of delivery to the cardholder's billing address with signature" },
    ],
  },
  {
    code: "4853",
    scheme: "mastercard",
    label: "Cardholder Dispute (Goods / Services Not Provided)",
    issuerClaim: "Goods or services were not provided as agreed.",
    match: { type: "all" },
    requirements: [
      { id: "4853.1", label: "Proof of delivery or service provision (tracking, confirmation, access log)" },
      { id: "4853.2", label: "Evidence the goods/services materially match what was advertised" },
      { id: "4853.3", label: "No prior contact attempting resolution, OR documented resolution attempt the cardholder refused" },
    ],
  },
  {
    code: "4855",
    scheme: "mastercard",
    label: "Goods / Services Not Provided",
    issuerClaim: "Paid for goods or services that were never delivered or rendered.",
    match: { type: "all" },
    requirements: [
      { id: "4855.1", label: "Proof of delivery (tracking + carrier confirmation) or proof of service rendered" },
      { id: "4855.2", label: "Date of delivery / service is before the chargeback date" },
      { id: "4855.3", label: "Delivery address matches the cardholder's records" },
    ],
  },
  {
    code: "4859",
    scheme: "mastercard",
    label: "No-Show / Addendum",
    issuerClaim:
      "Cardholder was charged a no-show fee, late cancellation fee, or addendum charge they dispute.",
    match: { type: "all" },
    requirements: [
      { id: "4859.1", label: "Evidence of the cardholder's original reservation or booking" },
      { id: "4859.2", label: "The merchant's no-show / cancellation policy as disclosed at booking" },
      { id: "4859.3", label: "Evidence the cardholder failed to show, or cancelled outside the policy window" },
      { id: "4859.4", label: "Evidence the fee charged matches the disclosed policy" },
    ],
  },
  {
    code: "4863",
    scheme: "mastercard",
    label: "Cardholder Does Not Recognise — Potential Fraud",
    issuerClaim: "Cardholder does not recognise the transaction (may just be a confusing descriptor).",
    match: { type: "any", n: 1 },
    requirements: [
      { id: "4863.1", label: "Merchant's billing descriptor matches a name the cardholder would recognise" },
      { id: "4863.2", label: "AVS + CVV match on the disputed transaction" },
      { id: "4863.3", label: "Prior undisputed transactions from this cardholder with this merchant" },
      { id: "4863.4", label: "Cardholder's IP / device / account login matches prior undisputed sessions" },
    ],
  },
  {
    code: "4870",
    scheme: "mastercard",
    label: "Chip Liability Shift",
    issuerClaim: "Counterfeit card used at a non-chip-enabled terminal (card-present only).",
    match: { type: "exception" },
    exceptionNote:
      "Card-present reason code. In a CNP acquiring context, expect accept_liability — flag the merchant for terminal upgrade.",
    requirements: [
      { id: "4870.1", label: "Evidence the transaction was chip-and-PIN / chip-and-signature at a chip-enabled terminal" },
    ],
  },
];

export function matchRuleIntro(match: MatchRule): string {
  if (match.type === "all") return "Merchant must satisfy all of the following:";
  if (match.type === "any") return `Merchant must satisfy at least ${match.n} of the following:`;
  return "Representment is only available if the merchant can prove:";
}

export function getReasonCode(scheme: string, code: string): ReasonCodeDef {
  const def = REASON_CODES.find((r) => r.scheme === scheme && r.code === code);
  if (!def) {
    throw new Error(`Unknown reason code: ${scheme} ${code}`);
  }
  return def;
}
