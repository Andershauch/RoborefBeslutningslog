# AGENTS.md: instruktioner til AI-assistenter

Gælder alle kodeassistenter (Claude Code, Codex, Copilot m.fl.). Læs dette først, derefter [docs/arkitektur.md](docs/arkitektur.md) før du ændrer logik.

## Hvad projektet er

Lokal beslutningslog for Roboref-mødetype-prompts: versioner, begrundelser, godkendelser og en uforanderlig hændelseslog. **Node.js ≥ 24, én bruger, én computer, SQLite, intet login.** Roboref kaldes kun **læsende**. Brugerfladen og fejltekster er på **dansk**.

Der er **ikke** implementeret: hosting-pakning (Docker), PostgreSQL, flere servere, automatisk brugerstyring (SCIM) eller andre loginudbydere end Microsoft Entra ID. Login (`ROBOREF_AUTH_MODE=oidc`) er valgfrit og testet mod en simuleret Entra ID; antag ikke andet. (En tidligere hostet variant er fjernet og må ikke genindføres uden en bevidst beslutning fra ejeren.)

## Kommandoer

```sh
npm install                  # kun til udvikling; appen kræver det ikke
npm start                    # http://127.0.0.1:5188
npm test                     # alle tests
npm run test:coverage        # + dækningsgrænser (88/90/88)
npm run typecheck && npm run lint && npm run format:check
npm run format               # ret formatering (Prettier)
npm run build:local-client   # genbyg public/client.js fra src/client + src/shared
```

Før du siger, at noget virker: kør `npm test`, `npm run typecheck`, `npm run lint` og `npm run format:check`. Oplys ærligt, hvad du ikke kunne køre.

## Kort over koden

- `src/server/`: `server.mjs` (start), `app.mjs` (routing, statiske filer, sikkerhedsheadere), `config.mjs` (`.env`), `storage.mjs` (SQLite, migrationer, backup), `roboref-api.mjs`, `handlers/*.ts` (API-logik).
- `src/shared/change-analysis.ts`: linjesammenligning (server **og** klient).
- `src/client/`: React/TSX-brugerflade. `public/client.js` er **genereret** af den.
- `migrations/`: SQL, kun tilføjelser. `tests/`: `node --test`. `scripts/`: byggescript, Roboref-hjælpere, backupkontrol.

## Regler, der ikke må brydes

1. **Aldrig committe eller udskrive hemmeligheder:** `.env`, API-nøgler, databaser (`data/`, `*.sqlite`), backups, persondata. `.gitignore` er ikke nok: tjek `git status` og diff. **Læs aldrig brugerens `.env`.** Udskriv aldrig nøgle eller Roboref-adresse i svar, logs, tests eller commits.
2. **Roboref-nøglen forlader aldrig serveren.** Ingen nøglefelter i klienten, ingen nøgle i svar eller fejlbeskeder. Roboref kaldes kun med GET, fast adresse fra `.env`, `redirect: 'error'`, timeout.
3. **Intet slettes eller overskrives** i versioner, indhold eller hændelser. Skrivninger er atomiske og betingede (`db.batch` med `WHERE EXISTS`/`IS ?`). Bevar SQL-mønstrene i `handlers/log-review.ts` og `log-upload.ts`, når du refaktorerer, og kør samtidighedstestene.
4. **Serveren beregner ændringsbeskrivelsen** for eksisterende prompts. Stol aldrig på klientens tekst.
5. **Migrationer er kun-tilføjelser.** Ret eller omdøb aldrig en eksisterende fil i `migrations/` (filnavnet er nøglen i brugernes databaser). Ny ændring = ny fil med næste nummer. Test frisk database **og** opgradering.
6. **Rør aldrig brugerens data.** Kør ikke programmet mod `data/` i en brugers mappe i test; brug midlertidige mapper (`ROBOREF_DATA_DIR`, `mkdtemp`). Migrér ikke lagring eller identitet uden backup, tests og rollbackplan.
7. **Tilskriv aldrig historiske handlinger en person uden verificeret grundlag.** Identiteten er et ikke-verificeret navn (`ROBOREF_USER_NAME`).
8. **Sikkerhedsgrænser:** `Origin`-kontrol på skrivning, kun `127.0.0.1`/`localhost` på rigtig port, sikkerhedsheadere og streng CSP på alle svar, størrelsesgrænser, ingen interne detaljer i fejlsvar. Tilføj ikke `unsafe-eval`, eksterne scripts eller netværkskald fra klienten.
9. **Rettigheder håndhæves på serveren** (`requirePermission` i `handlers/`; roller i `src/shared/roles.ts`). Skjul aldrig blot en knap i klienten, og tilføj aldrig en handling uden en rettighed i `ACTION_PERMISSIONS`. Hver hændelse gemmer `identity_verified`; tilskriv aldrig en uverificeret handling en person.
10. **Rør ikke login-flowet uden at køre `tests/oidc.test.mjs`.** Svæk aldrig state/PKCE/nonce, kontrol af signatur/udsteder/målgruppe/udløb/organisation, to-faktor, cookie-flagene eller hashing af sessionsnøgler. Log eller returnér aldrig tokens, koder eller klienthemmeligheden. Uden for loopback kræver `ROBOREF_PUBLIC_URL` HTTPS.
11. **Ingen produktionsdeployment, hosting eller ændring af repositoryets synlighed/indstillinger** uden udtrykkelig godkendelse fra ejeren.

## Konventioner

- **Serveren kører `.ts` direkte** (Node type stripping): kun sletbar TypeScript (ingen `enum`, `namespace` eller parameter properties), `import type` til typer, og `.ts`-endelse i importstier mellem serverfiler.
- Klienten bygges af `scripts/build-local-client.mjs` (TypeScripts `transpileModule`). Importér delt kode fra `src/shared/` med `../shared/<navn>` (uden endelse) i klientfiler.
- **`public/client.js`, `public/app.css` og `public/THIRD-PARTY-LICENSES.txt` er genererede.** Ret aldrig i dem i hånden. Ændrer du `src/client/` eller `src/shared/`, så kør `npm run build:local-client` og commit resultatet; CI fejler ellers.
- Formatering er Prettier (`npm run format`); markdown formateres ikke automatisk.
- Brugerrettede tekster på dansk. Nye indstillinger: validér i `config.mjs`, test, og dokumentér i `.env.example` og `docs/konfiguration.md`.
- **Nye tabeller eller felter med personoplysninger** skal beskrives i `docs/data-i-appen.md` (en test kontrollerer, at hver tabel står der). Læg aldrig oplysninger om borgere i tests, eksempler eller dokumentation.
- Test mod **rigtig SQLite** i midlertidige mapper, ikke mocks af databasen. Navngiv tests efter den adfærd, de beskytter. Hver fejlrettelse får en test, der fejler uden rettelsen.
- Indgange (startfil, npm-scripts, filer nævnt i README/AGENTS.md) testes af `tests/entrypoints.test.mjs`: ret stier begge steder, når du flytter filer.

## Arbejdsgang

- Undersøg den faktiske kode, før du vælger løsning. Arbejd i **små branches og pull requests** med beskrivelse af hvad, hvorfor og hvordan det er verificeret, inklusive kendte begrænsninger.
- Merge først, når CI er grøn (tests på Ubuntu/Windows/macOS, dækning, typecheck, lint, format, klientens aktualitet, `npm audit`, gitleaks).
- Opdater dokumentation og tests i samme PR som ændringen. Bevar eksisterende, fungerende adfærd, medmindre ændringen er det, der bedes om.
- Review særligt: Roboref-integration, versionssammenligning, godkendelser, hændelseslog, inputvalidering, adgangskontrol og dataintegritet.

## Kendte faldgruber

- Shell-escapes kan ødelægge `\n` og backslashes i engangsscripts. Brug redigeringsværktøjer til filer med sådanne tegn, og kør bagefter tests og lint.
- `server.mjs` måles ikke af dækningsrapporten (testes som eget program); tjek `tests/server-start.test.mjs`.
- `initialVersion: 0` betyder "ikke angivet" (standard 1), ikke en fejl.
- Windows-stier: brug `path`/`fileURLToPath`, aldrig `new URL(...).pathname` til filstier.
