export type Severity = 'low' | 'medium' | 'high';
export interface Classification { category?: string; severity?: Severity }

// Default rulesets — bundled, ordered (first category with a hit wins). Lowercase keywords; literal substring.
const CATEGORIES: { category: string; keywords: string[] }[] = [
  { category: 'conflict', keywords: ['airstrike', 'shelling', 'offensive', 'troops', 'missile', 'ceasefire', 'frontline', 'casualties', 'militant'] },
  { category: 'cyber', keywords: ['ransomware', 'breach', 'malware', 'ddos', 'phishing', 'exploit', 'data leak', 'hacked', 'cyberattack'] },
  { category: 'protest', keywords: ['protest', 'demonstration', 'rally', 'unrest', 'riot', 'strike', 'clashes'] },
  { category: 'disaster', keywords: ['earthquake', 'flood', 'wildfire', 'hurricane', 'tornado', 'eruption', 'landslide', 'evacuat'] },
  { category: 'crime', keywords: ['shooting', 'homicide', 'trafficking', 'kidnap', 'arrest', 'cartel', 'smuggling'] },
  { category: 'politics', keywords: ['election', 'sanction', 'parliament', 'minister', 'summit', 'treaty', 'coup'] }
];
const HIGH = ['killed', 'dead', 'explosion', 'attack', 'emergency', 'mass', 'critical', 'fatal'];
const MED = ['injured', 'warning', 'threat', 'evacuat', 'clashes', 'breach'];

export function classify(title: string, summary = ''): Classification {
  const text = `${title} ${summary}`.toLowerCase();
  let category: string | undefined;
  for (const c of CATEGORIES) { if (c.keywords.some((k) => text.includes(k))) { category = c.category; break; } }
  let severity: Severity | undefined;
  if (HIGH.some((k) => text.includes(k))) severity = 'high';
  else if (MED.some((k) => text.includes(k))) severity = 'medium';
  else if (category) severity = 'low';
  return { ...(category ? { category } : {}), ...(severity ? { severity } : {}) };
}
