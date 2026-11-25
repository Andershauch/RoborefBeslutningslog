# Roboref Beslutningslog

En lokal logbog til dine mødetype-prompts i Roboref: hvilken tekst der gælder, hvem der har godkendt den, hvornår, og hvorfor den blev ændret. Alt gemmes på din egen computer.

- **Versioner:** hver ændring af en prompt bliver en ny version. Ældre versioner bevares og kan sammenlignes.
- **Begrundelser:** hver version kræver en beskrivelse af ændring, årsag, forventet effekt og faglig begrundelse.
- **Godkendelse:** en version er en kladde, indtil nogen godkender den med en ibrugtagningsdato. Den kan også afvises med en begrundelse.
- **Sporbarhed:** upload, godkendelse og afvisning registreres med tidspunkt og navn i en logbog, der ikke kan redigeres i appen.
- **Roboref:** appen kan hente mødetyper og deres historik fra Roboref og tjekke, om noget er ændret. Den **læser kun** fra Roboref og ændrer aldrig noget dér.
- **Eksport:** hele historikken kan hentes som JSON, CSV eller en rapport til udskrift/PDF.

> **Afgrænsning.** Programmet er en dokumentationslog til én bruger på én computer. Det har intet login, er ikke en garanti for opfyldelse af tilsynskrav og er ikke et eksternt sikret revisionsarkiv. Se [Sikkerhed](SECURITY.md).

## Kom i gang

Du skal bruge [Node.js](https://nodejs.org) **version 24 eller nyere** (LTS). Du behøver ikke kunne programmere.

1. **Hent projektet.** Gå til [Releases](https://github.com/Andershauch/RoborefBeslutningslog/releases/latest), hent **Source code (zip)** for den nyeste udgivelse, og pak filen ud et sted, du kan finde igen.
2. **Opret din opsætning.** Kopiér filen `.env.example` til en ny fil, der hedder `.env`, og åbn den i et tekstprogram. Udfyld:
   - `ROBOREF_API_KEY`: din personlige API-nøgle fra Roboref. Behandl den som en adgangskode.
   - `ROBOREF_BASE_URL`: adressen til din organisations Roboref-API. Den ender på `/api/v2`. Spørg din Roboref-administrator, hvis du ikke kender den.
3. **Start appen.**
   - **Windows:** dobbeltklik på `Start-Roboref.cmd`.
   - **Mac/Linux:** kør `npm start` i projektmappen.
4. Browseren åbner `http://127.0.0.1:5188`. Lad startvinduet stå åbent, mens du bruger appen. Luk vinduet (eller tryk Ctrl+C) for at stoppe den.

Første gang indeholder appen en neutral eksempelprompt, så du kan prøve den af. Du kan arkivere den, når du registrerer dine egne.

Uden `.env` virker alt undtagen hentning fra Roboref, og appen fortæller, hvad der mangler. Din `.env` bliver aldrig sendt til GitHub eller delt (den er udelukket af Git). Kontrollér forbindelsen med `npm run roboref:test`.

## Hvor gemmes mine data?

I mappen `data/` i projektmappen (databasen `beslutningslog.sqlite`). Ved hver opstart laves en dateret sikkerhedskopi i `data/backups/`, højst én om dagen. **Tag selv en ekstra kopi af `data/`**, fx når du opdaterer appen. Se [Drift og backup](docs/drift.md).

## Dokumentation

| Dokument                                     | Til                                                    |
| -------------------------------------------- | ------------------------------------------------------ |
| [Brugervejledning](docs/brugervejledning.md) | Sådan registrerer, godkender og eksporterer du         |
| [Konfiguration](docs/konfiguration.md)       | Alle indstillinger i `.env`                            |
| [Data i appen](docs/data-i-appen.md)         | Hvad appen gemmer, og om det er personoplysninger      |
| [Login med Entra ID](docs/login-entra-id.md) | Til kommunens IT: login, roller og to-faktor på en server |
| [Drift og backup](docs/drift.md)             | Opdatering, backup, kontrol af backup, fejlfinding     |
| [Sikkerhed](SECURITY.md)                     | Sikkerhedsmodel, rapportering af sårbarheder           |
| [Arkitektur](docs/arkitektur.md)             | Hvordan programmet er bygget og hvorfor                |
| [Udvikling](docs/udvikling.md)               | Test, kvalitetskontrol og bidrag                       |
| [AGENTS.md](AGENTS.md)                       | Instruktioner til AI-assistenter, der arbejder i koden |

## Teknik i korte træk

Node.js (≥ 24) uden eksterne servere: en lille webserver på `127.0.0.1`, SQLite i `node:sqlite` og en færdigbygget React-brugerflade, der ligger i repositoryet. Du behøver ikke køre `npm install` for at bruge appen på din egen computer, kun for at udvikle på den, eller hvis I slår login til på en server (`npm ci --omit=dev`). Login med Entra ID er valgfrit; se [Login med Entra ID](docs/login-entra-id.md).

## Uofficielt værktøj

Dette er et uafhængigt værktøj. Det er ikke udviklet af, godkendt af eller tilknyttet Roboref eller dets leverandør. Roboref er et varemærke tilhørende dets ejer og nævnes alene for at beskrive, hvad værktøjet kan hente data fra.

## Licens og bidrag

Udgivet under [MIT-licensen](LICENSE). Du må bruge, ændre og dele det frit, men uden nogen form for garanti. Fejl og forslag er velkomne: se [CONTRIBUTING.md](CONTRIBUTING.md). Ændringer pr. version står i [CHANGELOG.md](CHANGELOG.md). Sikkerhedsproblemer meldes privat, se [SECURITY.md](SECURITY.md).
