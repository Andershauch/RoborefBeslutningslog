# Arkitektur

Dette dokument beskriver, hvordan programmet er bygget, hvilke regler der skal holde, og hvilke valg der er truffet. Det er skrevet, så både en udvikler og en AI-assistent kan finde rundt.

## Overblik

Et lokalt program til én bruger: en Node.js-server lytter på `127.0.0.1`, serverer en React-brugerflade og et lille JSON-API, og gemmer alt i en SQLite-fil. Der er ingen eksterne tjenester, undtagen **læsende** kald til Roboref, når brugeren beder om det.

```text
Browser (React)  ──HTTP──▶  Node-server (127.0.0.1)  ──▶  SQLite (data/beslutningslog.sqlite)
                                  │
                                  └──(kun læsning, API-nøgle fra .env)──▶  Roboref API
```

## Mappekort

| Sti                               | Indhold                                                                                                |
| --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/server/server.mjs`           | Startpunkt: indlæser `.env`, kontrollerer Node-version, starter HTTP-server, åbner browser             |
| `src/server/app.mjs`              | `createLocalApplication`: samler lagring, handlers og statiske filer; `handle(Request) → Response`     |
| `src/server/config.mjs`           | Validering af `.env` (Roboref-nøgle/-adresse, port, datamappe, brugernavn)                             |
| `src/server/storage.mjs`          | SQLite-adapter, migrationer, daglig backup, atomiske batches                                           |
| `src/server/roboref-api.mjs`      | Læsende proxy til Roboref; nøglen forlader aldrig serveren                                             |
| `src/server/handlers/`            | API-handlers som TypeScript-moduler: `log.ts` (+ `log-review.ts`, `log-upload.ts`), `content.ts`, `export.ts`, `common.ts` |
| `src/shared/change-analysis.ts`   | Linjesammenligning, brugt af både server og klient                                                     |
| `src/client/`                     | React-brugerflade (TypeScript/TSX) og ikoner                                                           |
| `public/`                         | Færdigbygget klient (`client.js`, `app.css`), licenstekster, favicon, eksempelprompt                   |
| `migrations/`                     | SQL-migrationer (kun tilføjelser; filnavnet er nøglen)                                                 |
| `scripts/`                        | Byggescript til klienten, Roboref-hjælpescripts, kontrol af backup                                     |
| `tests/`                          | Tests (`node --test`), inklusive HTTP-sikkerhed, lagring og browsertest af klienten                    |

## Datamodel

Tre tabeller (se `migrations/0000_prompt_log.sql`):

- `prompts`: id, titel, mødetype, formål, ansvarlig, fagområde, oprettet af/hvornår og `active_version_id` (den gældende version, eller `NULL`).
- `versions`: id, `prompt_id`, løbenummer, filnavn, **indhold**, SHA-256, ændring/årsag/effekt/begrundelse, hvem og hvornår der uploadede, og (efter godkendelse) hvem/hvornår/ibrugtagningsdato. Unikke indekser sikrer, at et versionsnummer og et indhold kun findes én gang pr. prompt.
- `events`: den uforanderlige log. Handlinger: `uploaded`, `approved`, `rejected`, `archived`, `restored`, `roboref_reviewed`. `detail` er JSON med bl.a. kilde (Roboref-mødetype), sammenligningsgrundlag og bekræftelsestekst.

**Afledt status.** Der er ingen statuskolonne. En version er _afvist_, hvis der findes en `rejected`-hændelse; _gældende_, hvis den er prompten `active_version_id`; _kladde_ ellers. En prompt er _arkiveret_, hvis den seneste `archived`/`restored`-hændelse er `archived`.

## Regler, der skal holde (invarianter)

Disse er dækket af tests og må ikke brydes uden en bevidst beslutning:

1. **Intet slettes eller overskrives.** API'et har ingen handling, der sletter eller ændrer indhold, versioner eller hændelser. Kun `active_version_id`, godkendelsesfelterne og nye rækker skrives.
2. **Skrivninger er atomiske og betingede.** Godkendelse, afvisning og upload bruger betingede `UPDATE`/`INSERT … WHERE EXISTS …` i én transaktion (`db.batch`). Ved samtidige handlinger vinder én, og den anden får 409. En fejl midt i en batch rulles helt tilbage.
3. **Serveren beregner ændringsbeskrivelsen** for en eksisterende prompt. Klientens tekst kan ikke erstatte den.
4. **Sammenligningsgrundlaget kontrolleres ved gem** (`expectedBaseVersionId`): hvis den gældende version er ændret siden forhåndsvisningen, afvises gem (`comparison_changed`).
5. **Roboref-nøglen forlader aldrig serveren** og kan ikke sendes fra browseren. Roboref kaldes kun læsende, med fast adresse fra `.env`, uden redirects og med timeout.
6. **Kun appens egen oprindelse** må skrive (`Origin`-kontrol), og kun værtsnavnene `127.0.0.1`/`localhost` på den rigtige port og `http` accepteres (beskytter mod DNS rebinding).
7. **Alle svar har sikkerhedsheadere** og en streng CSP uden `unsafe-eval` og uden eksterne adresser. Fejlsvar afslører ingen interne oplysninger.
8. **Brugerens tekst vises altid som tekst** (React escaper); data indsættes i bootstrap-scriptet med `<` escapet.
9. **Migrationer er kun-tilføjelser.** En eksisterende migrationsfil må ikke ændres eller omdøbes (filnavnet er nøglen i `local_migrations`). Nye ændringer får en ny fil med højere nummer.
10. **Historiske handlinger tilskrives aldrig en person uden grundlag.** Identiteten er et ikke-verificeret navn fra `.env`, og det er markeret `identityVerified: false`.

## Anmodningsflow

1. `server.mjs` indlæser `.env`, validerer indstillinger og kalder `createLocalApplication`.
2. `app.handle(request)` afviser forkerte værtsnavne/porte, router `/api/*` til handlers og alt andet til en lille liste af statiske filer (ingen mappe-servering).
3. Handlers får en `HandlerContext {db, user}` injiceret. De kender hverken HTTP-serveren eller SQLite-biblioteket, kun grænsefladen i `handlers/common.ts`, så de kan testes med en rigtig in-memory-database.
4. Fejl: forventede fejl er `RequestError` (med status og tekst); alt andet bliver til et generisk 500-svar uden detaljer.

## Klienten

Brugerfladen er TypeScript/TSX i `src/client/`. `scripts/build-local-client.mjs` transpilerer den med TypeScripts API og pakker den sammen med React, ReactDOM og Scheduler (fra `node_modules`) i én fil, `public/client.js`, så appen kan køre **uden npm install og uden internet**. Filen er genereret og er checket ind; **CI fejler, hvis den ikke svarer til kildekoden.** Ret kilden, kør `npm run build:local-client`, og commit begge dele. Ikoner ligger lokalt i `src/client/icons.tsx` (ingen ikonpakke hentes).

## Teknologivalg og begrænsninger

- **Node.js ≥ 24 uden TypeScript-kompilering til serveren.** Node kører `.ts`-filerne direkte (type stripping). Derfor kun _sletbar_ TypeScript-syntaks (ingen enums eller parameter properties; `erasableSyntaxOnly`), `import type` til typer, og `.ts` i importstier mellem serverfiler.
- **`node:sqlite`** (indbygget) i stedet for en ekstern database: ingen installation, én fil at tage backup af. Det er til én bruger ad gangen.
- **Ingen login og ingen roller.** Alle med adgang til `127.0.0.1:5188` på computeren kan læse og skrive. Se [Sikkerhed](../SECURITY.md).
- **Roboref-integrationen er læsende og manuel.** Der er ingen automatisk overvågning.

## Mulige udvidelser (ikke implementeret)

Hosting med fælles adgang, en server-database, verificeret login (fx OIDC) og roller ville kræve en særskilt, testet migrering med backup og tilbageførselsplan, samt at historiske handlinger fortsat ikke tilskrives uverificerede personer. Intet af dette er en del af programmet i dag.
