# Sikkerhed

*English summary: Roboref Beslutningslog is a single-user app that runs on your own computer and listens only on `127.0.0.1`. Report vulnerabilities privately via GitHub ("Security" tab → "Report a vulnerability"), not in public issues.*

## Rapportér en sårbarhed

Opret **ikke** et offentligt issue. Brug i stedet fanen **Security → Report a vulnerability** på GitHub. Beskriv, hvad du fandt, hvordan det kan genskabes, og hvilken version det gælder. Du får et svar hurtigst muligt; dette er et lille projekt uden garanteret svartid.

## Understøttede versioner

Kun den nyeste udgivelse (`main`) får sikkerhedsrettelser.

## Sikkerhedsmodel

Programmet er lavet til **én bruger på én computer**:

- Serveren lytter kun på `127.0.0.1` og afviser andre værtsnavne og andre oprindelser (`Origin`).
- Der er **ingen login og ingen roller**. Alle, der kan nå `127.0.0.1:5188` på din computer, kan læse og ændre loggen. Kør det ikke på en delt server, og udsæt det ikke på et netværk.
- Handlinger registreres under et navn, du selv vælger (`ROBOREF_USER_NAME`). Det er ikke verificeret og er ikke et sikkert revisionsspor mod en ondsindet bruger.
- Dataene ligger i en lokal SQLite-fil, som ikke krypteres. Beskyt computeren, og tag backup.
- Appen kalder kun Roboref (læsende) med din egen API-nøgle. Nøglen sendes kun fra serveren til Roboref og returneres aldrig til browseren.

## Hvad der beskytter dig

- **Forfalskede forespørgsler fra andre websteder:** skrivning kræver appens egen `Origin`.
- **DNS rebinding:** kun værtsnavnene `127.0.0.1` og `localhost` på den rigtige port accepteres.
- **Indsprøjtning af kode (XSS):** al tekst vises som tekst, og en streng indholdspolitik (CSP) forbyder eksterne scripts og `eval`.
- **SQL-indsprøjtning:** alle databasekald bruger parametre.
- **Dataintegritet:** intet slettes eller overskrives; skrivninger er atomiske, og en fejl rulles helt tilbage.
- **API-nøglen:** læses kun af serveren, valideres, sendes kun til din Roboref-adresse (uden redirects) og vises aldrig i svar, fejl eller log.
- **Fejlsvar** afslører ikke stier, SQL eller interne fejltekster.

Andre programmer og brugerkonti på samme computer kan stadig nå `127.0.0.1:5188`. Beskyt computeren, og brug skærmlås.

## Hemmeligheder

- Læg **aldrig** API-nøgler, `.env`, databaser eller backups i Git. `.gitignore` dækker dem, men tjek altid `git status`, før du committer.
- Hvis en nøgle kommer ud, så **tilbagekald den hos Roboref med det samme**. Det er ikke nok at slette den fra Git, fordi historikken bevares.

## Automatiske kontroller

Hver pull request og hver mandag (samt ved manuel kørsel) kører GitHub Actions:

- tests (med dækningsgrænse) på Ubuntu, Windows og macOS, typecheck, lint og formatkontrol,
- kontrol af, at den indcheckede, byggede klient svarer til kildekoden,
- `npm audit` på de pakker, der leveres med appen (fejler ved høj eller kritisk sårbarhed),
- søgning efter hemmeligheder (gitleaks). På en pull request scannes dens egne commits; ved ugentlig og manuel kørsel scannes hele historikken.

Dependabot foreslår ugentligt opdateringer af pakker og GitHub Actions.

## Kendte begrænsninger

- Der er intet login, ingen roller og ingen kryptering af databasen (se ovenfor).
- Roboref-historikkens datoer er ikke nødvendigvis den dato, en ændring faktisk blev taget i brug.
- Programmet er en dokumentationslog og ikke en garanti for opfyldelse af tilsynskrav.
