# Data i appen

Hvilke oplysninger gemmer Beslutningsloggen, hvor ligger de, og hvem kan se dem? Siden er skrevet, så en IT-afdeling eller en databeskyttelsesrådgiver hurtigt kan vurdere, hvad appen indebærer. Den er **ikke juridisk rådgivning**: det er jeres egen vurdering, hvad der kræver aftaler, registrering eller godkendelse.

## Kort fortalt

- Appen er **ikke beregnet til oplysninger om borgere**. Den beskriver, hvordan mødetyper i Roboref fungerer.
- Appen gemmer **oplysninger om medarbejdere**: navn, e-mail, rolle og hvad de har gjort og hvornår. Det er personoplysninger.
- Appen kan **ikke forhindre**, at nogen ved et uheld skriver en borgers oplysninger i et fritekstfelt. Derfor står der en advarsel i appen.
- Der er **ingen ekstern leverandør, ingen sporing og ingen analyse**. Eneste kontakt udadtil er til Microsoft (login, valgfrit) og til Roboref (kun læsning, kun når brugeren beder om det).
- **Intet slettes i appen.** Det er med vilje: loggen skal kunne stoles på.

## Hvad der gemmes

Alt ligger i én SQLite-fil, `data/beslutningslog.sqlite`, og i dens sikkerhedskopier i `data/backups/`.

| Hvad                                               | Tabel / sted                            | Personoplysninger?                                                              |
| -------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------- |
| Prompttekster og versioner                         | `versions`                              | Nej, ikke tiltænkt. Fritekst kan indeholde noget ved en fejl.                   |
| Titel, fagområde, mødetype, formål                 | `prompts`                               | Nej                                                                             |
| **Ansvarlig** for en prompt                        | `prompts` (feltet _owner_)              | **Ja**: normalt en medarbejders navn                                            |
| Begrundelser (ændring, årsag, effekt, faglig)      | `versions`                              | Nej, ikke tiltænkt. Fritekst.                                                   |
| **Hvem uploadede, hvem godkendte/afviste**         | `versions`, `events`                    | **Ja**: navn, e-mail, bruger-id og tidspunkt                                    |
| **Hændelseslog** (upload, godkendelse, afvisning, arkivering, Roboref-tjek) | `events` | **Ja**: navn, e-mail, bruger-id, tidspunkt, om identiteten var bekræftet af login |
| Aktive login-sessioner (kun med login)             | `sessions`                              | **Ja**: navn, e-mail og roller i op til 8 timer; selve nøglen gemmes kun som hash |
| Igangværende login (kun med login)                 | `login_attempts`                        | Nej: tilfældige engangsværdier i 10 minutter                                    |
| Roboref API-nøgle og login-hemmelighed             | Filen `.env` (ikke databasen)           | Nej, men de er adgangskoder og skal beskyttes                                   |

Mødetyper hentet fra Roboref gemmes som tekst i en version. Roborefs felter, fx **eksempler**, kan indeholde eksempeltekst. **Kontrollér dem, før du registrerer dem.**

## Hvad der ikke gemmes

- Ingen adgangskoder. Med login ser appen dem aldrig; uden login findes der ingen.
- Ingen IP-adresser, enhedsoplysninger eller browserhistorik i databasen.
- Ingen cookies udover login-sessionen (kun med login).
- Ingen tredjepartstjenester, annoncer, sporing eller analyse.

Bemærk, at **serveren og proxyen** kan have egne logfiler (fx med IP-adresser). De styres af jeres drift, ikke af appen.

## Hvem kan se hvad

Uden login: alle, der kan nå appen på computeren. Med login: de roller, I tildeler i Entra. En _Læser_ kan se alt i tabellen ovenfor, også medarbejdernes navne i loggen og i eksporten. Se [Login med Entra ID](login-entra-id.md).

## Opbevaring og sletning

- Der er **ingen automatisk sletning**. Loggen er ment til at bevares, så beslutninger kan dokumenteres.
- Appen har **ingen funktion til at slette** prompter, versioner eller hændelser.
- Kommer der noget i appen, som ikke burde være der (fx en borgers oplysninger), kan det kun fjernes ved et indgreb i databasefilen af en administrator. Gør det **ikke selv**, men stop appen, tag en backup og kontakt jeres IT og databeskyttelsesrådgiver. Husk, at **backups og eksporter** også indeholder oplysningerne.

## Spørgsmål, I kan bruge i jeres egen vurdering

- Er medarbejdernes navne og e-mail i loggen dækket af jeres fortegnelse over behandlinger, og hvad er formålet og grundlaget?
- Hvor længe skal loggen opbevares, og hvem må se den?
- Hvem hoster serveren, og er det en ekstern leverandør (så skal I bruge en databehandleraftale) eller jer selv?
- Hvordan sikrer I, at brugerne ikke lægger borgeroplysninger i appen (instruktion, advarsel, stikprøver)?
