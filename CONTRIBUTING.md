# Bidrag

Tak, fordi du vil hjælpe. Projektet er lille, og bidrag er velkomne: fejlrapporter, forslag, rettelser og forbedringer af dokumentationen.

Vær venlig og saglig over for andre. Chikane og nedsættende sprog accepteres ikke, og det kan føre til, at et indlæg fjernes.

## Før du skriver et issue

> **Læg aldrig noget følsomt i et issue, en kommentar eller en pull request:** ingen API-nøgler, ingen `.env`, ingen databaser eller backups, ingen rigtige prompter eller persondata. Fjern eller erstat sådanne oplysninger i skærmbilleder og fejlbeskeder.
>
> **Sikkerhedsproblemer** meldes ikke som issues. Følg [SECURITY.md](SECURITY.md) og brug fanen **Security → Report a vulnerability**.

- **Fejl:** beskriv, hvad du gjorde, hvad du forventede, og hvad der skete. Skriv styresystem og `node --version`. Kopiér fejlteksten fra startvinduet (den indeholder aldrig din nøgle).
- **Forslag:** beskriv problemet, du vil løse, før løsningen.

## Foreslå en ændring (pull request)

1. Opret et issue først, hvis ændringen er stor, så vi er enige om retningen.
2. Opret en gren, og hold ændringen **lille og afgrænset**: én ting pr. pull request.
3. Følg [Udvikling](docs/udvikling.md) og [AGENTS.md](AGENTS.md). De samme regler gælder for mennesker og AI-assistenter.
4. Kør lokalt, før du åbner pull requesten:

   ```sh
   npm install
   npm test && npm run typecheck && npm run lint && npm run format:check
   ```

5. Ændrer du `src/client/` eller `src/shared/`, så kør `npm run build:local-client` og tag resultatet med. CI afviser en forældet klient.
6. Skriv en test for ny adfærd og for hver fejlrettelse (testen skal fejle uden rettelsen). Opdater dokumentationen i samme pull request.
7. Beskriv i pull requesten, **hvad** der er ændret, **hvorfor**, og **hvordan** du har kontrolleret det.

Alle kontroller i CI skal være grønne, før en ændring kan flettes.

## Regler, der altid gælder

- Intet må kunne slettes eller overskrives i loggen; skrivninger er atomiske. Se [Arkitektur](docs/arkitektur.md).
- Eksisterende migrationer ændres aldrig; en ny databaseændring får en ny fil.
- API-nøglen må aldrig nå browseren eller stå i svar, fejl eller log.

## Licens

Ved at bidrage accepterer du, at dit bidrag udgives under projektets [MIT-licens](LICENSE).
