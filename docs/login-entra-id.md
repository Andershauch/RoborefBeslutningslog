# Login med Entra ID

Denne guide viser, hvordan en kommune tilslutter Beslutningsloggen til sit Microsoft Entra ID, så medarbejdere logger ind med deres kommunale konto og to-faktor. Den er skrevet til en IT-administrator og kan følges uden at kende programmet.

> **Status.** Login er klar til test og til drift i en lille, kontrolleret skala. Programmet er stadig én server med én SQLite-database (se [Begrænsninger](#begrænsninger)). Kør kun i produktion efter jeres egen sikkerhedsgodkendelse.

## Det vigtigste i fem linjer

- Brugerne logger ind hos **Microsoft** med deres normale konto. **Appen ser og gemmer aldrig en adgangskode.**
- **To-faktor** styres af jer (Conditional Access). Appen kontrollerer desuden, at login faktisk er gennemført med to-faktor.
- **Roller** (Læser, Redaktør, Godkender, Administrator) styres i Entra. Der er ingen brugeradministration i appen.
- Alle handlinger i loggen registreres under brugerens **bekræftede** navn.
- Det tager cirka en time at sætte op, hvis I har en server og et domænenavn klar.

## Det skal være på plads først

| Hvad                                                                                          | Hvorfor                                                  |
| --------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| En rolle i Entra som **Application Administrator** eller **Cloud Application Administrator** | Til at oprette appregistreringen                         |
| En server med **Node.js 24** (LTS)                                                            | Kører programmet                                         |
| Et **domænenavn** og **HTTPS** (via proxy eller loadbalancer), fx `beslutningslog.kommune.dk` | Login kræver HTTPS                                       |
| **Udgående HTTPS** fra serveren til `login.microsoftonline.com`                               | Serveren skal kunne tale med Microsoft                   |
| En afklaring af databehandleraftale, konsekvensanalyse og sikkerhedsgodkendelse               | Programmet gemmer faglige beslutninger om mødetyper og medarbejdernes navne (se [Data i appen](data-i-appen.md))      |

> **Menunavne.** Entra ændrer ind imellem navne og sprog. De engelske navne er: _App registrations_, _New registration_, _Certificates & secrets_, _App roles_, _Enterprise applications_, _Conditional Access_ og _Assignment required_.

## Trin 1: Opret appregistreringen

1. Gå til **Microsoft Entra administrationscenter → Entra ID → App-registreringer → Ny registrering**.
2. **Navn:** `Roboref Beslutningslog`.
3. **Kontotyper, der understøttes:** _Kun konti i denne organisationsmappe (enkelt lejer)_.
4. **Omdirigerings-URI:** vælg **Web**, og skriv `https://<jeres-adresse>/auth/callback`, fx `https://beslutningslog.kommune.dk/auth/callback`. Den skal være **præcis** den samme som i `.env` (trin 6).
5. Tryk **Registrer**, åbn derefter **Godkendelse** (Authentication) → **Tilføj en platform/URI**, og tilføj også `https://<jeres-adresse>/` som omdirigerings-URI. Den bruges, når en bruger logger ud, så Microsoft kan sende vedkommende tilbage.
6.  Skriv to værdier ned fra oversigten:
   - **Program-id (klient)** (en GUID)
   - **Mappe-id (lejer)** (en GUID)

## Trin 2: Opret en klienthemmelighed

1. Åbn appregistreringen → **Certifikater og hemmeligheder → Ny klienthemmelighed**.
2. Vælg en gyldighed (fx 12 eller 24 måneder), og tryk **Tilføj**.
3. Kopiér **Værdi** med det samme (ikke "Hemmeligt id"). Den kan ikke vises igen.
4. **Sæt en kalenderpåmindelse** før hemmeligheden udløber. Når den udløber, kan ingen logge ind.

## Trin 3: Opret de fire roller

Åbn appregistreringen → **App-roller → Opret app-rolle**, og opret fire roller. **Værdien skal være præcis som i tabellen, med små bogstaver.**

| Visningsnavn | Værdi      | Tilladte medlemstyper | Må                                                          |
| ------------ | ---------- | --------------------- | ----------------------------------------------------------- |
| Læser        | `reader`   | Brugere/grupper       | Se prompter, versioner, log og eksport                      |
| Redaktør     | `editor`   | Brugere/grupper       | Læse, uploade versioner, arkivere og hente fra Roboref      |
| Godkender    | `approver` | Brugere/grupper       | Læse, godkende og afvise versioner                          |
| Administrator | `admin`   | Brugere/grupper       | Alt ovenstående                                             |

Rettighederne lægges sammen. Giv én person både _Redaktør_ og _Godkender_, hvis vedkommende skal kunne begge dele. Se også firøjneprincippet i [Konfiguration](konfiguration.md).

## Trin 4: Giv de rigtige personer adgang

1. Gå til **Virksomhedsprogrammer** (Enterprise applications), og åbn **Roboref Beslutningslog**.
2. Åbn **Egenskaber**, og sæt **Tildeling påkrævet** til **Ja**. Så kan kun tildelte personer logge ind.
3. Åbn **Brugere og grupper → Tilføj bruger/gruppe**, vælg en bruger eller gruppe og **en rolle**.

Brug helst **sikkerhedsgrupper** (fx `Beslutningslog-Redaktører`), så I styrer adgang ét sted. Tildeling af grupper til programmer kræver normalt Entra ID P1; uden P1 tildeler I enkeltbrugere. En bruger **uden rolle** får "Ingen adgang".

## Trin 5: Kræv to-faktor

1. Gå til **Beskyttelse → Betinget adgang → Ny politik**.
2. **Brugere:** de grupper, der har adgang til programmet.
3. **Målressourcer:** vælg programmet **Roboref Beslutningslog**.
4. **Tildel:** _Kræv godkendelsesstyrke_ med **Multifaktor** (eller **Phishing-resistant MFA**, hvis I bruger sikkerhedsnøgler), eller _Kræv multifaktorgodkendelse_.
5. Start med **Kun rapport**, kontrollér, og sæt den derefter til **Til**.

Programmet kontrollerer desuden selv, at login er sket med to-faktor (`ROBOREF_REQUIRE_MFA=true`, standard). Det er en ekstra sikring, ikke en erstatning for jeres politik. Kontrollen læser feltet `amr` i Microsofts id-token, som skal indeholde `mfa`.

> **Kontrollér i test (trin 8).** Kontrollen er afprøvet mod en simuleret loginudbyder, ikke mod et rigtigt Entra. Hvis alle brugere afvises med "To-faktor-login kræves", selvom de har brugt to-faktor, leverer jeres lejer ikke `amr` i id-tokenet. Sæt så `ROBOREF_REQUIRE_MFA=false`, og lad Betinget adgang være den eneste håndhævelse, og giv os gerne besked, så vi kan tilpasse kontrollen.

## Trin 6: Udfyld `.env` på serveren

Kopiér `.env.example` til `.env`, og udfyld:

```text
ROBOREF_AUTH_MODE=oidc
ROBOREF_OIDC_ISSUER=https://login.microsoftonline.com/<Mappe-id (lejer)>/v2.0
ROBOREF_OIDC_CLIENT_ID=<Program-id (klient)>
ROBOREF_OIDC_CLIENT_SECRET=<Værdien fra trin 2>
ROBOREF_PUBLIC_URL=https://beslutningslog.kommune.dk
```

Hver indstilling er forklaret i [Konfiguration](konfiguration.md). `.env` indeholder en hemmelighed: begræns adgangen til filen, og læg den aldrig i Git eller en mail. Hvis hemmeligheden kommer ud, så opret en ny i Entra, og slet den gamle.

## Trin 7: Start programmet bag HTTPS

Programmet lytter kun på `127.0.0.1:5188` og skal have en proxy foran, som afslutter HTTPS og sender trafikken videre. Proxyen **skal**: bruge HTTPS, sende `Host`-headeren uændret videre og ikke cache svar. Et eksempel med [Caddy](https://caddyserver.com), som selv henter certifikat:

```text
beslutningslog.kommune.dk {
    reverse_proxy 127.0.0.1:5188
}
```

Installér og start:

```sh
npm ci --omit=dev      # login kræver pakken "jose"
npm start
```

Kør programmet som en tjeneste, så det starter igen efter genstart (fx `systemd` på Linux eller en planlagt opgave/tjeneste på Windows). Et simpelt `systemd`-eksempel:

```ini
[Service]
WorkingDirectory=/opt/roboref-beslutningslog
ExecStart=/usr/bin/node --disable-warning=ExperimentalWarning src/server/server.mjs
Restart=on-failure
User=roboref
```

## Trin 8: Test

- [ ] Åbn adressen i en ny browser. Du sendes til Microsofts loginside.
- [ ] Log ind med en bruger **med** en rolle og to-faktor. Du kommer til forsiden og kan se dit navn og en **Log ud**-knap.
- [ ] Log ind med en bruger **uden** rolle. Du får "Ingen adgang".
- [ ] En _Læser_ kan ikke se knapper til at uploade, godkende eller afvise.
- [ ] Upload en version som _Redaktør_, og se, at navnet står i loggen.
- [ ] Tryk **Log ud**, og kontrollér, at forsiden igen kræver login.
- [ ] Åbn `https://<jeres-adresse>/api/health`: svaret viser `"mode":"oidc"`.

## Drift

- **Roller** læses ved login og gælder i op til 8 timer (`ROBOREF_SESSION_HOURS`). Fjerner I en brugers rolle, mister vedkommende adgang senest, når sessionen udløber. Sænk værdien, hvis det skal gå hurtigere.
- **Backup:** mappen `data/` indeholder alle beslutninger. Se [Drift og backup](drift.md).
- **Hemmelighedens udløb:** forny den i Entra, opdatér `.env`, og genstart programmet.
- **Opdatering:** se [Drift og backup](drift.md). Databaseændringer køres automatisk.
- **Revision:** hver handling i loggen har et felt, der viser, om brugerens identitet var bekræftet af login. Handlinger fra før login blev slået til er markeret som ikke verificerede og tilskrives aldrig en person.

## Fejlfinding

| Du ser                                               | Det betyder normalt                                                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Microsoft: `AADSTS50011` (omdirigerings-URI)         | URI'en i Entra er ikke **præcis** `ROBOREF_PUBLIC_URL` + `/auth/callback`. Ret den.                           |
| Microsoft: `AADSTS7000215` (ugyldig hemmelighed)     | Forkert eller udløbet klienthemmelighed. Opret en ny, og opdatér `.env`.                                      |
| Microsoft: `AADSTS700016` (program ikke fundet)      | `ROBOREF_OIDC_CLIENT_ID` er forkert, eller programmet ligger i en anden lejer.                                |
| "To-faktor-login kræves"                             | Brugeren loggede ind uden to-faktor. Tjek jeres Betinget adgang-politik.                                      |
| "Ingen adgang"                                       | Brugeren har ingen rolle. Tildel en i trin 4. Rollens værdi skal være `reader`, `editor`, `approver` eller `admin`. |
| "Login er ikke tilgængeligt"                         | Serveren kan ikke nå `login.microsoftonline.com`. Tjek udgående HTTPS og firewall.                            |
| "Adgang afvist" i browseren                          | Proxyen sender ikke `Host` uændret, eller adressen afviger fra `ROBOREF_PUBLIC_URL`.                           |

Programmets startvindue og logfil viser årsagen til afviste logins (aldrig tokens eller hemmeligheder).

## Begrænsninger

- **Én server, én database.** Programmet bruger SQLite og kan ikke køre på flere servere samtidig (ingen loadbalancing). Det passer til en lille til mellemstor brugerkreds.
- **Roller styres i Entra.** Der er ingen brugeradministration i appen, ingen automatisk oprettelse eller sletning af brugere, og ændringer gælder først ved næste login.
- **Kun Entra ID er testet.** Andre OIDC-udbydere (fx Keycloak) bør virke, hvis de sender `roles`- og `amr`-oplysninger, men det er ikke afprøvet.
- **Databasen er ikke krypteret** og skal beskyttes som resten af serveren.
