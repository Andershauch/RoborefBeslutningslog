export const labels: Record<string, string> = {
  instruction: 'Instruktion',
  example: 'Eksempel',
  template: 'Skabelon',
  technicalTerms: 'Fagbegreber',
  unwantedPhrases: 'Uønskede formuleringer',
  defaultAgenda: 'Standarddagsorden',
  title: 'Titel',
  showDisclaimer: 'Vis forbehold',
  isTemplateEditable: 'Redigerbar skabelon',
  disclaimerText: 'Forbeholdstekst',
  transcribeWithDiarization: 'Talergenkendelse',
  language: 'Sprog',
  isDraft: 'Kladde',
  isShared: 'Delt',
};
export type RoborefHistory = {
  validFrom: string;
  validTo: string | null;
  title: string;
  instruction: string;
  isDraft: boolean;
  [key: string]: unknown;
};
export function fieldKeys(...items: Array<Record<string, unknown> | undefined>): string[] {
  const known = Object.keys(labels),
    extras = new Set<string>();
  for (const item of items)
    if (item)
      for (const key of Object.keys(item))
        if (!known.includes(key) && key !== 'validFrom' && key !== 'validTo') extras.add(key);
  return [...known, ...Array.from(extras).sort()];
}
export function fieldValue(item: Record<string, unknown> | undefined, key: string): string {
  if (!item || !Object.prototype.hasOwnProperty.call(item, key))
    return 'Ikke returneret af Roboref';
  const value = item[key];
  if (value === null) return 'Ingen værdi (null)';
  if (typeof value === 'string') return value || '(tom tekst)';
  if (typeof value === 'boolean') return value ? 'Ja' : 'Nej';
  return JSON.stringify(value, null, 2) ?? 'Ikke returneret af Roboref';
}
export function snapshot(item: RoborefHistory): string {
  const raw = Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => key !== 'validFrom' && key !== 'validTo')
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return (
    '# Mødetype fra Roboref\n\n' +
    fieldKeys(item)
      .map((key) => `## ${labels[key] || key}\n\n${fieldValue(item, key)}`)
      .join('\n\n') +
    '\n\n## Originale feltværdier (JSON)\n\n' +
    JSON.stringify(raw, null, 2) +
    '\n'
  );
}
