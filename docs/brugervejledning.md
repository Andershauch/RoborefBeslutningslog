# Brugervejledning

Denne vejledning forklarer, hvordan du bruger Beslutningsloggen i hverdagen. Opsætning står i [README](../README.md).

## Begreber

| Begreb       | Betydning                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **Prompt**   | En mødetype-prompt, som du registrerer (en Markdown-fil, `.md`). Den har titel, fagområde, formål og en ansvarlig.             |
| **Version**  | Én udgave af en prompts tekst. Hver gang teksten ændres, bliver det en ny version med nyt nummer. Ældre versioner bevares.     |
| **Kladde**   | En version, der er registreret, men endnu ikke gennemgået. Den ændrer ikke, hvad der gælder.                                   |
| **Gældende** | Den version, der er godkendt og taget i brug. Der er højst én gældende version pr. prompt.                                     |
| **Afvist**   | En version, der er gennemgået og afvist med en begrundelse. Den kan ikke senere godkendes; registrér i stedet en ny version.   |
| **Arkiveret**| En prompt, der er skjult fra den almindelige oversigt. Hele historikken bevares, og den kan gendannes.                          |
| **Log**      | Den samlede liste over, hvad der er sket (upload, godkendelse, afvisning, arkivering, tjek mod Roboref), med tidspunkt og navn. |

Intet kan slettes eller overskrives gennem appen. Det er hele pointen: historikken skal kunne stoles på.

## Registrér en prompt første gang

1. Vælg at uploade en prompt, og vælg en Markdown-fil (maks. 200 kB, UTF-8). Du kan også starte med den medfølgende eksempelprompt.
2. Vælg **Opret som en ny prompt**, og udfyld fagområde, mødetype, formål og ansvarlig.
3. Hvis prompten allerede har en version i brug, kan du starte nummereringen dér, fx ved 16. Appen opfinder ikke tidligere versioner og dokumenterer ikke tidligere ændringsårsager, som den ikke kender.
4. Beskriv ændringen, årsagen, den forventede effekt og den faglige begrundelse. Alle fire felter er påkrævede.
5. Gem. Versionen bliver en **kladde**.

## Registrér en ny version

1. Upload den ændrede fil. Appen foreslår, hvilken prompt den hører til, ud fra filnavnet. Ret, hvis den gætter forkert.
2. Appen **sammenligner selv** med den gældende version (eller den nyeste, hvis ingen er godkendt) og viser, hvilke linjer der er tilføjet og fjernet. Denne beskrivelse af ændringerne beregnes af appen og kan ikke erstattes af en tekst, du skriver. Du skriver selv årsag, forventet effekt og faglig begrundelse.
3. Hvis du uploader en fil med nøjagtig samme indhold som en eksisterende version, afviser appen det.
4. Gem. Hvis en kollega eller en anden fane i mellemtiden har ændret, hvad der gælder, beder appen dig gennemgå sammenligningen igen, så du aldrig gemmer ud fra et forældet grundlag.

## Godkend eller afvis

Åbn en kladde, og vælg:

- **Godkend og gør gældende.** Angiv ibrugtagningsdato (senest i dag, og ikke før den nuværende versions dato) og en bekræftelse. Ved den allerførste godkendelse af en prompt kan datoen stå tom, hvis den oprindelige dato er ukendt; ved senere versioner er den påkrævet. Godkendelsen er permanent og bliver en del af loggen. Den tidligere gældende version bevares som historik.
- **Afvis version.** Angiv en begrundelse. Afvisningen ændrer ikke noget i Roboref.

Godkendelse sker med et enkelt, sikret skridt: hvis to godkendelser sker samtidig, vinder den første, og den anden får besked om at opdatere siden.

## Sammenlign versioner

Under en prompt kan du vælge en ældre version og se forskellene linje for linje (grønt er tilføjet, rødt er fjernet). Du kan også hente den oprindelige Markdown-fil med **Download .md**, nøjagtig som den blev uploadet (inklusive linjeskift). Hver version har en SHA-256-kontrolsum, så du kan bekræfte, at en fil er uændret.

## Hent fra Roboref og tjek for ændringer

Kræver, at `.env` er udfyldt (se [Konfiguration](konfiguration.md)).

- **Hent fra Roboref:** søg og filtrér på afdeling, vælg mødetyper og en historisk post, og registrér dem som kladder. Appen gemmer mødetypens felter i teksten og husker, hvilken mødetype og hvilken historisk post den kommer fra.
- **Tjek for ændringer:** kontrollerer, om Roboref har nyere historik for mødetyper, du har registreret, og viser, hvilke felter der er ændret. Du kan markere ændringen som gennemgået med en begrundelse. Tjekket er manuelt og køres kun, når du beder om det.

Appen **læser kun** fra Roboref. Den kan ikke ændre noget dér, og et tjek registrerer ikke automatisk en ny version. Datoer i Roborefs historik er ikke nødvendigvis den dato, ændringen faktisk blev taget i brug.

## Log og eksport

- **Log:** viser alle handlinger, nyeste først.
- **Eksport:** vælg **Download JSON** (alt: prompter, tekster, versioner og hændelser), **Download CSV** (versionsoversigt til regneark) eller **Dokumentationsrapport** (til udskrift eller gem som PDF).
- JSON-eksporten er en komplet ekstra kopi af indholdet og kan bruges som supplement til backup. Den erstatter ikke en kopi af `data/`-mappen; se [Drift og backup](drift.md).

## Arkivér og gendan

Vælg **Arkivér prompt** for at skjule en prompt, du ikke længere bruger. Den forsvinder fra oversigten, men historikken bevares, og **Gendan fra arkiv** henter den frem igen. Begge handlinger står i loggen.

## Hvad programmet ikke gør

- Det ændrer, godkender eller spærrer **ikke** noget i Roboref. Du skal selv registrere i Roboref, hvad der tages i brug.
- Det har **intet login**. Navnet i loggen er det, du har sat i `ROBOREF_USER_NAME`, og er ikke bevis for, hvem der handlede.
- Det er til **én bruger ad gangen** på én computer. Del ikke databasen mellem flere samtidige brugere.
- Det er **ikke** en garanti for opfyldelse af tilsynskrav eller et eksternt sikret revisionsarkiv.
