export function changedAcrossHistory(
  history: Record<string, unknown>[],
  baseline: string,
  fields: string[],
) {
  const base = history.find((x) => x.validFrom === baseline),
    latest = history[0];
  if (!base || !latest)
    throw new Error(
      'Den tidligere post kunne ikke findes i Roboref. Gennemgå tilknytningen manuelt.',
    );
  const newer = history.filter((x) => Date.parse(String(x.validFrom)) > Date.parse(baseline));
  const chronology = [base, ...newer.slice().reverse()];
  const changed = fields.filter((k) =>
    chronology.some(
      (x, i) => i > 0 && JSON.stringify(x[k]) !== JSON.stringify(chronology[i - 1][k]),
    ),
  );
  return {base, latest, fields: changed, steps: newer.length};
}
