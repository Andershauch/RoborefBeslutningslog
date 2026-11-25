# Ændringslog

Alle væsentlige ændringer noteres her. Formatet følger [Keep a Changelog](https://keepachangelog.com/da/1.1.0/), og versionsnumre følger [semantisk versionering](https://semver.org/lang/da/).

## [Ikke udgivet]

### Tilføjet

- **Valgfrit login med Microsoft Entra ID** (OpenID Connect) til drift på en server: roller (Læser, Redaktør, Godkender, Administrator), krav om to-faktor og en trin-for-trin-guide til kommunens IT ([docs/login-entra-id.md](docs/login-entra-id.md)). Uden login (standard) er alt uændret.
- Rettigheder håndhæves på serveren; hver hændelse i loggen markerer, om identiteten var bekræftet af login. Gamle hændelser markeres som ikke verificerede.
- Valgfrit **firøjneprincip** (`ROBOREF_REQUIRE_FOUR_EYES`): den, der uploadede en version, kan ikke selv godkende den.
- Indstillingerne `ROBOREF_AUTH_MODE`, `ROBOREF_OIDC_*`, `ROBOREF_PUBLIC_URL`, `ROBOREF_REQUIRE_MFA`, `ROBOREF_SESSION_HOURS` og `ROBOREF_HOST`.

### Bemærk

- Login er afprøvet mod en simuleret Entra ID og skal verificeres mod jeres egen lejer, især at id-tokenet indeholder `amr` med `mfa` (se guiden).
- Login kræver pakken `jose` (`npm ci --omit=dev`). Den lokale app uden login kræver stadig ingen `npm install`.

## [1.0.0] – 2026-11-25

Første offentlige udgivelse.

### Funktioner

- Registrering af prompts (Markdown) med versioner, SHA-256-kontrolsum og obligatorisk begrundelse (ændring, årsag, forventet effekt, faglig begrundelse).
- Kladde, godkendelse med ibrugtagningsdato, afvisning med begrundelse, arkivering og gendannelse. Intet kan slettes eller overskrives.
- Linjesammenligning mellem versioner; serveren beregner selv ændringsbeskrivelsen for eksisterende prompts.
- Uforanderlig hændelseslog og eksport som JSON, CSV og rapport til udskrift/PDF.
- Læsende integration med Roboref: hent mødetyper og historik, og tjek manuelt for ændringer.
- Daglig automatisk sikkerhedskopi og et værktøj til at kontrollere en backup (`scripts/verify-local-backup.mjs`).

### Opsætning og drift

- Opsætning udelukkende via `.env` (`ROBOREF_API_KEY`, `ROBOREF_BASE_URL`; valgfrit `ROBOREF_USER_NAME`, `ROBOREF_PORT`, `ROBOREF_DATA_DIR`). API-nøglen forlader aldrig serveren.
- Kører på Windows, macOS og Linux med Node.js 24 eller nyere. Ingen `npm install` kræves for at bruge appen.

### Sikkerhed og kvalitet

- Kun `127.0.0.1`/`localhost`, `Origin`-kontrol, streng indholdspolitik (CSP), sikkerhedsheadere og størrelsesgrænser.
- Over 90 automatiske tests (ca. 92 % linjedækning af serverkoden), kørt på Ubuntu, Windows og macOS, plus `npm audit`, kodeanalyse og søgning efter hemmeligheder i CI.
- Dependabot for pakker og GitHub Actions.

### Kendte begrænsninger

- Én bruger ad gangen; intet login og ingen roller. Navnet i loggen er ikke verificeret.
- Databasen er ikke krypteret.
- Ændringskontrol mod Roboref er manuel.

[1.0.0]: https://github.com/Andershauch/RoborefBeslutningslog/releases/tag/v1.0.0
