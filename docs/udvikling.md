# Udvikling

For dig, der vil rette, udvide eller bidrage til koden. Brugere behøver ikke dette. Se også [Arkitektur](arkitektur.md) og [AGENTS.md](../AGENTS.md).

## Opsætning

Krav: Node.js ≥ 24 og Git.

```sh
git clone <repository-adresse>
cd RoborefBeslutningslog
npm install        # kun nødvendigt til udvikling, ikke til at bruge appen
cp .env.example .env   # valgfrit: kun til at prøve Roboref-forbindelsen af
npm start
```

## Kommandoer

| Kommando                      | Hvad den gør                                                                                             |
| ----------------------------- | -------------------------------------------------------------------------------------------------------- |
| `npm start`                   | Starter appen på `http://127.0.0.1:5188`                                                                 |
| `npm test`                    | Kører alle tests (`node --test tests/*.test.mjs`)                                                        |
| `npm run test:coverage`       | Som `npm test`, men fejler under dækningsgrænserne (linjer 88 %, grene 90 %, funktioner 88 %)            |
| `npm run typecheck`           | TypeScript-kontrol uden at skrive filer                                                                  |
| `npm run lint`                | ESLint (typescript-eslint og react-hooks)                                                                |
| `npm run format` / `format:check` | Prettier: ret eller kontrollér formatering                                                           |
| `npm run build:local-client`  | Bygger `public/client.js` og `public/app.css` fra `src/client/` og `src/shared/`                          |
| `npm run roboref:test`        | Læser mødetyper og historik fra Roboref med din `.env` (ændrer intet)                                     |
| `npm run roboref:preview -- <id>` | Åbner en sammenligning af de to seneste historiske poster for en mødetype                            |

## Kvalitetskontrol

Hver pull request og hver ændring på `main` kører automatisk (GitHub Actions):

1. **Tests med dækningsgrænse**, typecheck, lint og formatkontrol (Ubuntu).
2. **Tests på Windows og macOS.** Appen skal virke på alle tre.
3. **Kontrol af den byggede klient:** klienten genbygges, og CI fejler, hvis `public/client.js`, `app.css` eller licensfilen afviger fra det indcheckede. Kør `npm run build:local-client`, og commit resultatet.
4. **`npm audit`** på de pakker, der leveres med appen (fejler ved høj/kritisk sårbarhed), og **gitleaks** mod hemmeligheder. Begge kører også ugentligt.

Kør `npm test && npm run typecheck && npm run lint && npm run format:check` lokalt før du åbner en PR.

## Sådan gør du typiske ændringer

- **Ændr brugerfladen:** ret filer i `src/client/`, kør `npm run build:local-client`, commit både kilde og `public/`. Browsertesten (`tests/client-smoke.test.mjs`) indlæser den byggede klient.
- **Ændr API'et:** ret en handler i `src/server/handlers/`. Ny forretningsregel kræver en test i `tests/`, der bruger en rigtig SQLite-database. Bump `API_VERSION` i `src/server/app.mjs`, hvis klient og server ikke længere passer til en ældre kørende udgave.
- **Ændr databasen:** tilføj en **ny** fil i `migrations/` med næste løbenummer (`0001_navn.sql`). Ret aldrig en eksisterende. Test både en frisk database og opgradering af en med data (`tests/storage.test.mjs` viser mønstret).
- **Tilføj en indstilling:** udvid `src/server/config.mjs` med validering og test, tilføj den til `.env.example` og [Konfiguration](konfiguration.md).
- **Opdater afhængigheder:** Dependabot sender ugentlige PR'er. `react`, `react-dom` og typerne skal opdateres sammen (klienten pakker dem), og hver ændring skal have grøn CI. Store versionshop af `typescript`, `eslint` og `@types/node` kræver en bevidst beslutning og er slået fra.

## Skrivestil

- Tekster, som brugeren ser, er på dansk; kode, filnavne og testnavne bruger engelsk eller dansk efter, hvad der er tydeligst, og kommentarer forklarer **hvorfor**, ikke hvad.
- Serverkoden er TypeScript uden kompilering: kun sletbar syntaks, `import type`, og `.ts` i importstier.
- Hold PR'er små og reviewvenlige, med en beskrivelse af hvad, hvorfor og hvordan det er verificeret. Eventuelt kendte begrænsninger hører til i beskrivelsen.

## Hemmeligheder og data

Læg aldrig `.env`, API-nøgler, databaser, backups eller persondata i Git eller i en PR. `.gitignore` dækker dem, men tjek `git status` før du committer. Tests må ikke bruge rigtige nøgler eller rigtige data; brug midlertidige mapper (se eksisterende tests).
