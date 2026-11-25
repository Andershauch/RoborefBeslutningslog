# Drift og backup

Denne side handler om at holde appen kørende og dine data i sikkerhed: hvor dataene ligger, hvordan du opdaterer uden at miste noget, og hvordan du kontrollerer en backup.

## Hvad ligger hvor

| Hvad                           | Placering                              | I Git? |
| ------------------------------ | -------------------------------------- | ------ |
| Databasen med al din historik  | `data/beslutningslog.sqlite`           | Nej    |
| Automatiske sikkerhedskopier   | `data/backups/beslutningslog-ÅÅÅÅ-MM-DD.sqlite` | Nej |
| Din opsætning og API-nøgle     | `.env`                                 | Nej    |
| Programmet                     | resten af projektmappen                | Ja     |

GitHub er **ikke** en backup af dine registreringer: databasen og `.env` er med vilje udeladt. Hvis du tidligere brugte en ældre udgave, kan databasen ligge i `local-runtime/data/`; den bruges stadig, hvis den findes (se [Konfiguration](konfiguration.md#datamappen)).

## Sikkerhedskopier

- Ved hver opstart af en eksisterende database laves en kopi i `data/backups/`, **højst én pr. dag**. De gamle kopier slettes ikke automatisk; ryd selv op, når der er for mange.
- Kopierne ligger på samme computer som databasen. De beskytter mod fejl i appen, men **ikke** mod et diskhavari eller en mistet computer. Tag derfor selv en kopi af hele `data/`-mappen et andet sted (fx et netværksdrev), især før en opdatering.
- Eksport som JSON fra appen er en ekstra, læsbar kopi af indholdet.

## Opdater appen uden at miste data

1. Luk appen (startvinduet).
2. **Kopiér hele `data/`-mappen og din `.env` til et sikkert sted.**
3. Hent den nye version fra GitHub (Download ZIP), og pak den ud i en ny mappe.
4. Flyt `data/` (og `.env`) fra den gamle mappe til den nye. Eller sæt `ROBOREF_DATA_DIR` i `.env` til den eksisterende datamappe.
5. Start appen. Nye databaseændringer (migrationer) køres automatisk, én gang, og en fejlet migration rulles helt tilbage.
6. Kontrollér, at dine prompts og versioner er der. Bevar den gamle mappe en tid, til du er sikker.

Kør kun **én kopi af appen ad gangen** på samme port. Startfilen genkender en allerede kørende app og åbner den i stedet for at starte en ny, så et nyt vindue viser måske ikke den kopi, du forventer. Er den kørende app en ældre version, får du besked om at lukke den først.

## Kontrollér en backup

Værktøjet åbner **ikke** den aktive database. Det laver en midlertidig kopi af den valgte backup, åbner kopien, kører databaseskemaet på den og kontrollerer integritet og relationer. Den midlertidige kopi slettes bagefter. Det viser kun filnavn, resultat og antal poster, aldrig promptindhold, og sender intet over netværket.

```sh
node scripts/verify-local-backup.mjs "data/backups/beslutningslog-2026-11-03.sqlite"
```

Erstat stien med en rigtig, dateret backupfil. Der kræves ingen `npm install`, kun Node.js 24. Et godkendt resultat begynder med `{"ok":true`. Værktøjet accepterer kun daterede filer (`beslutningslog-ÅÅÅÅ-MM-DD.sqlite`) i en mappe, der hedder `backups`, og afviser dermed den aktive databasefil. Det ændrer aldrig backuppen.

Det er en **prøveåbning af en kopi**, ikke en gendannelse. En egentlig gendannelse (luk appen, læg backuppen på plads som `beslutningslog.sqlite`) kræver, at du først har taget en ekstra kopi af den nuværende fil.

## Fejlfinding

Se tabellen i [Konfiguration](konfiguration.md#fejlfinding). Mere kan ses i startvinduet: det viser, hvor databasen ligger, og om Roboref er sat op (kun værtsnavnet, aldrig nøglen).
