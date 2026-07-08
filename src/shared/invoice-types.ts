/** Invoice-generator shared types. Hours are DERIVED from a line's time range (see calc.ts) and never
 *  stored. Image assets (logos, signature) live as encrypted blobs referenced by an opaque ref. */
export interface InvoiceLine { id: string; date: string; start: string; end: string; description: string }
export interface Party { name: string; company: string; logoRef?: string }
export interface Signature { signerName?: string; signedDate?: string; signatureRef?: string }

export interface Invoice {
  id: string;
  number: string;        // zero-padded, e.g. "0007"
  issueDate: string;     // ISO date
  currency: string;      // ISO 4217
  rate: number;          // flat rate per hour
  taxPct?: number;       // optional VAT/tax %
  sender: Party;
  client: Party;
  lines: InvoiceLine[];
  notes?: string;
  signature?: Signature;
  createdAt: string;
  updatedAt: string;
}

export interface Profile { id: string; kind: 'sender' | 'client'; name: string; company: string; logoRef?: string }

/** On-disk shape (one encrypted JSON file). `seq` backs the auto-incrementing invoice number. */
export interface InvoiceStoreData { invoices: Invoice[]; profiles: Profile[]; seq: number }

/** getAsset result — a ready-to-embed data URL. */
export interface InvoiceAsset { mime: string; dataUrl: string }
