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
Ga naar [app.anp.nl](https://app.anp.nl), log in, en klik op de bookmarklet. De agenda (vandaag + 2 dagen) wordt naar je klembord gekopieerd.

### Stap 3 — Dashboard gebruiken
Open `anp-dashboard.html` (of de GitHub Pages URL), plak de tekst, en klik **Analyseer agenda**. Je kunt dan filteren op datum, categorie en zoektekst, items markeren met een ster, en je selectie kopiëren.

## GitHub Pages

Als je Pages hebt ingeschakeld (Settings → Pages → Branch: main) zijn de tools bereikbaar op:

```
https://<username>.github.io/<repo>/anp-dashboard.html
https://<username>.github.io/<repo>/anp-bookmarklet.html
```

## Technische details

- De bookmarklet draait in de browser op het domein `app.anp.nl` (sessiecookies vereist)
- API: `newsapi.anp.nl/services/` met headers `api-version: 1.0`, `appid: INZAGEWEB25`
- Het dashboard is een standalone HTML-bestand met React via CDN — geen buildstap nodig
- Het clipboard-outputformaat van de bookmarklet is het contract tussen de twee tools — wijzig dit niet zonder de parser in het dashboard aan te passen

Zie `project-instructions.md` voor de volledige API-referentie en kalender-ID's.
