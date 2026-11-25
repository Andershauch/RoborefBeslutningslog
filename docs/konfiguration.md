# Konfiguration

Alle indstillinger sættes i filen `.env` i projektmappen. Kopiér `.env.example` til `.env`, udfyld, og **genstart appen** efter ændringer.

`.env` er udelukket af Git og må aldrig committes, sendes eller deles. Hvis en API-nøgle er kommet ud, så tilbagekald den hos Roboref med det samme.

| Variabel            | Påkrævet | Standard                     | Betydning                                                                                                                                   |
| ------------------- | -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROBOREF_API_KEY`   | Nej¹     | _(tom)_                      | Din personlige API-nøgle. Kun synlige tegn, ingen mellemrum eller linjeskift, højst 4096 tegn.                                              |
| `ROBOREF_BASE_URL`  | Nej¹     | _(tom)_                      | Adressen til din organisations Roboref-API, inklusive `/api/v2` og uden afsluttende skråstreg. Skal starte med `https://`.                  |
| `ROBOREF_USER_NAME` | Nej      | `Lokal bruger`               | Det navn, dine handlinger registreres under. Der er intet login; navnet er en mærkat og ikke bevis for, hvem der handlede. Højst 100 tegn. |
| `ROBOREF_REQUIRE_FOUR_EYES` | Nej | `false` | `true` betyder, at den, der har uploadet en version, ikke selv må godkende den (firøjneprincippet). Giver kun mening med login, hvor der er flere forskellige brugere; uden login er der kun én bruger, som så aldrig kan godkende. |
| `ROBOREF_PORT`      | Nej      | `5188`                       | Port på `127.0.0.1`. Heltal mellem 1024 og 65535.                                                                                           |
| `ROBOREF_DATA_DIR`  | Nej      | `data/` (se nedenfor)        | Mappe til databasen og dens sikkerhedskopier. Relative stier regnes fra projektmappen.                                                      |

¹ Uden begge felter virker appen stadig til upload, versioner, godkendelser og eksport. Kun hentning fra Roboref er slået fra, og appen forklarer, hvad der mangler.

## Login (Entra ID)

Kun relevant, når appen kører på en server for flere brugere. Trin for trin: [Login med Entra ID](login-entra-id.md).

| Variabel                     | Påkrævet ved login | Standard    | Betydning                                                                                                          |
| ---------------------------- | ------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| `ROBOREF_AUTH_MODE`          | Nej                | `local`     | `local` = intet login (din egen computer). `oidc` = login med Entra ID og roller.                                |
| `ROBOREF_OIDC_ISSUER`        | Ja                 | _(tom)_     | Entra-adressen `https://login.microsoftonline.com/<mappe-id>/v2.0`. Mappe-id'et kontrolleres i hvert login.        |
| `ROBOREF_OIDC_CLIENT_ID`     | Ja                 | _(tom)_     | Program-id (klient) fra appregistreringen.                                                                         |
| `ROBOREF_OIDC_CLIENT_SECRET` | Ja                 | _(tom)_     | Klienthemmeligheden. Behandl den som en adgangskode; den vises aldrig i fejl eller log.                            |
| `ROBOREF_PUBLIC_URL`         | Ja                 | _(tom)_     | Appens offentlige HTTPS-adresse uden sti, fx `https://beslutningslog.kommune.dk`. Skal passe med omdirigerings-URI'en. |
| `ROBOREF_REQUIRE_MFA`        | Nej                | `true`      | Kræver, at login er gennemført med to-faktor (`amr` indeholder `mfa`).                                           |
| `ROBOREF_SESSION_HOURS`      | Nej                | `8`         | Hvor længe en session gælder, 1 til 72 timer. Roller læses ved login og gælder, til sessionen udløber.              |
| `ROBOREF_HOST`               | Nej                | `127.0.0.1` | Adresse, serveren lytter på. Lad den stå, og brug en HTTPS-proxy på samme server.                                  |

Roller (`reader`, `editor`, `approver`, `admin`) tildeles i Entra som app-roller og kommer med i hvert login. En bruger uden gyldig rolle får "Ingen adgang".

## Regler for adressen

`ROBOREF_BASE_URL` afvises, hvis den ikke er en gyldig adresse, ikke bruger `https://`, indeholder brugernavn/adgangskode eller indeholder `?` eller `#`. Ren `http://` er kun tilladt til din egen computer (`127.0.0.1`, `localhost`), fx til test mod en lokal attrap.

## Datamappen

Standard er `data/` i projektmappen. Hvis der allerede findes en database i den ældre placering `local-runtime/data/`, bruges den videre, så en opdatering af koden ikke får dine data til at "forsvinde". Sæt `ROBOREF_DATA_DIR`, hvis du vil have databasen et andet sted (fx på et drev med automatisk backup). Undgå en mappe, der synkroniseres live mellem flere computere: databasen er til én bruger på én maskine ad gangen.

## Fejlfinding

| Symptom                                                  | Sandsynlig årsag                                                                                                      |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| "Roboref er ikke sat op" i appen eller startvinduet      | `.env` mangler, ligger i en anden mappe, eller `ROBOREF_API_KEY`/`ROBOREF_BASE_URL` er tomme. Teksten nævner hvilke. |
| "Adgangen blev afvist" (HTTP 401)                        | Nøglen er forkert, udløbet eller hører til en anden organisation.                                                     |
| "Port … er optaget"                                      | Et andet program (eller en anden kopi af appen) bruger porten. Luk det, eller sæt `ROBOREF_PORT`.                     |
| "En tidligere version … kører stadig"                    | Et gammelt startvindue er åbent. Luk det, og start igen.                                                              |
| "kræver Node.js 24 eller nyere"                          | Installér den nyeste LTS-version fra nodejs.org.                                                                      |
