# ANP Nieuwstools

Interne tools voor de NRC-nieuwsredactie om de ANP-nieuwsagenda op te halen, te filteren en te verwerken.

## Wat zit erin?

| Bestand | Wat doet het |
|---|---|
| `anp-bookmarklet.js` | Broncode van de bookmarklet — haalt de volledige ANP-agenda op via de API en kopieert deze naar het klembord |
| `anp-bookmarklet.html` | Installatiepagina met drag-to-bookmark knop voor de bookmarklet |
| `anp-dashboard.html` | Standalone dashboard dat de bookmarklet-output parseert tot een filterbaar, doorzoekbaar overzicht |
| `project-instructions.md` | Technische documentatie, API-referentie en instructies voor AI-assistenten (Claude Code) |

## Hoe werkt het?

### Stap 1 — Bookmarklet installeren
Open `anp-bookmarklet.html` (of de GitHub Pages URL) en sleep de blauwe knop naar je bladwijzerbalk.

### Stap 2 — Agenda ophalen
Ga naar [app.anp.nl](https://app.anp.nl), log in, en klik op de bookmarklet. De agenda (vandaag + 4 dagen) wordt opgehaald; rechtsonder loopt een teller mee. Daarna opent het dashboard automatisch met de data erin. Lukt dat niet (popup geblokkeerd), dan staat de agenda op je klembord.

> **Na een update van de bookmarklet moet je hem opnieuw installeren.** De code zit in de bladwijzer zelf, niet op de server — een oude bladwijzer blijft de oude versie draaien.

### Stap 3 — Dashboard gebruiken
Open `anp-dashboard.html` (of de GitHub Pages URL), plak de tekst, en klik **Analyseer agenda**. Je kunt dan filteren op datum, categorie en zoektekst, items markeren met een ster, en je selectie kopiëren.

## GitHub Pages

Als je Pages hebt ingeschakeld (Settings → Pages → Branch: main) zijn de tools bereikbaar op:

```
https://<username>.github.io/<repo>/anp-dashboard.html
https://<username>.github.io/<repo>/anp-bookmarklet.html
```

## Hoe het venster wordt opgehaald

- De bookmarklet doet **één request per kalender per dag** (`fromDate=<dag>&numDays=1`). Eerdere versies deden één request per kalender voor het hele venster; drukke kalenders raakten hun `count`-budget dan al op bij dag 1, waardoor de laatste dag van het venster stelselmatig leeg bleef.
- Items die **buiten het venster** vallen worden weggefilterd. De API levert namelijk ook doorlopers terug met een startdatum ver in het verleden (jaarthema's, tentoonstellingen); die verschenen anders als spookdag "1 januari".
- Uitzondering: een item dat eerder begon maar **binnen het venster eindigt** blijft staan, op zijn einddatum, met de extra categorie `Doorlopend`. Zo blijven meerdaagse rechtszaken en dergelijke zichtbaar op de dag dat ze ertoe doen.
- Alle datumberekeningen gaan in **lokale tijd**, niet in UTC.
- De kopregel van de output vermeldt het venster, het aantal items per dag, hoeveel items buiten het venster zijn genegeerd en of een kalender tegen de item-limiet aan liep. Die regel staat ook in de dashboardheader — zo zie je meteen of er iets mist.

Venstergrootte aanpassen: `NUM_DAYS` bovenin `anp-bookmarklet.js` én in `anpBookmarklet()` in `anp-bookmarklet.html` (5 = vandaag + 4 dagen). Meer dagen betekent evenredig meer requests.

## Technische details

- De bookmarklet draait in de browser op het domein `app.anp.nl` (sessiecookies vereist)
- API: `newsapi.anp.nl/services/` met headers `api-version: 1.0`, `appid: INZAGEWEB25`
- Het dashboard is een standalone HTML-bestand met React via CDN — geen buildstap nodig
- Het outputformaat van de bookmarklet is het contract tussen de twee tools — wijzig dit niet zonder de parser in het dashboard aan te passen
- Datumkoppen hebben het formaat `## 2026-08-15 | zaterdag 15 augustus`. Het dashboard sorteert op de ISO-datum en toont het label. Koppen zonder ISO-datum (output van oudere bookmarklets) worden nog steeds geparseerd
- `anp-bookmarklet.js` en de functie `anpBookmarklet()` in `anp-bookmarklet.html` bevatten dezelfde logica; wijzig ze samen. De `.js` is de gedocumenteerde broncode, de `.html` bouwt de daadwerkelijke bookmarklet

Zie `project-instructions.md` voor de volledige API-referentie en kalender-ID's.
