# ANP Nieuwstools

Interne tools voor de NRC-nieuwsredactie om de ANP-nieuwsagenda op te halen, te filteren en te verwerken.

## Wat zit erin?

| Bestand | Wat doet het |
|---|---|
| `anp-bookmarklet.js` | Broncode van de bookmarklet — haalt de volledige ANP-agenda op en stuurt die naar het dashboard. Enige bron van waarheid |
| `anp-bookmarklet.html` | Installatiepagina met drag-to-bookmark knop; pakt bovenstaande code in tot een `javascript:`-URL |
| `anp-dashboard.html` | Standalone dashboard dat de bookmarklet-output parseert tot een filterbaar, doorzoekbaar overzicht |

## Hoe werkt het?

### Stap 1 — Bookmarklet installeren
Open `anp-bookmarklet.html` (of de GitHub Pages URL) en sleep de blauwe knop naar je bladwijzerbalk.

### Stap 2 — Agenda ophalen
Ga naar [app.anp.nl](https://app.anp.nl), log in, en klik op de bookmarklet. Het dashboard opent in een nieuw tabblad en vult zichzelf. Wordt de popup geblokkeerd, dan komt de agenda op je klembord en kun je hem handmatig plakken.

### Stap 3 — Dashboard gebruiken
Filter op datum, categorie en zoektekst, markeer items met een ster, en kopieer je selectie.

Het dashboard opent standaard op **vandaag**. Dagen die al voorbij zijn worden verborgen; via **Toon afgelopen dagen** haal je ze alsnog in beeld. Met **Alleen nog te komen** verberg je items van vandaag waarvan het tijdstip al gepasseerd is. Meerdaagse events die nog lopen (een rechtszaak van maandag tot vrijdag) schuiven mee naar vandaag met de toevoeging `(loopt door)`.

Is de geladen agenda van een eerdere dag, dan verschijnt bovenaan een waarschuwing. Sterren blijven bewaard in `localStorage` en overleven een reload.

## Upgraden vanaf v3 of ouder

**Een bookmarklet in je bladwijzerbalk werkt zichzelf niet bij.** Na een update moet je de oude verwijderen en de knop opnieuw naar je bladwijzerbalk slepen. Doe je dat niet, dan meldt het dashboard dat je bookmarklet verouderd is en laadt het niets — dat is met opzet, want zonder de datumsleutels uit v4 kan het dashboard "vandaag" niet betrouwbaar bepalen.

## Delen met collega's

De code bevat geen persoonlijk geheim en kan gewoon gedeeld worden:

- De enige authenticatie is `credentials: "include"` — de browser stuurt de ANP-sessiecookies van de collega zelf mee. Iedereen haalt zijn eigen agenda op, met zijn eigen rechten.
- `appid: INZAGEWEB25` is een gedeelde applicatie-identifier, geen persoonlijke sleutel.
- In de output staat geen naam, e-mailadres of gebruikers-ID.

Waar het misgaat:

- **Deel de installatiepagina, niet de losse `.js`.** Alleen `anp-bookmarklet.html` bouwt een werkende bookmarklet.
- De collega heeft een **eigen ANP-login** nodig met toegang tot dezelfde kalenders.
- De bookmarklet moet **op `app.anp.nl`** geklikt worden; elders faalt de CORS-preflight.
- **Popups toestaan**, anders is het klembord de enige route.

Het dashboard accepteert alleen agenda-data van `https://app.anp.nl`. Draait ANP bij jullie op een ander domein, dan hoort die origin in `ALLOWED_ORIGINS` in `anp-dashboard.html`. Wordt een bericht geweigerd, dan zegt het dashboard dat met de betreffende herkomst erbij.

## GitHub Pages

Als je Pages hebt ingeschakeld (Settings → Pages → Branch: main) zijn de tools bereikbaar op:

```
https://<username>.github.io/<repo>/anp-dashboard.html
https://<username>.github.io/<repo>/anp-bookmarklet.html
```

De installatiepagina leidt de dashboard-URL af uit haar eigen locatie, dus een fork wijst automatisch naar het eigen dashboard.

## Uitvoerformaat

De tekstoutput van de bookmarklet is het contract tussen de twee tools. Wijzig dit niet zonder `parseANPAgenda()` in `anp-dashboard.html` aan te passen.

```
ANP AGENDA v4 (opgehaald 26-07-2026 09:41) [fetch=2026-07-26T09:41]
Periode: 2026-07-26 t/m 2026-07-28 | Kalenders: 12 | Items: 143
==================================================

## zondag 26 juli 2026 [2026-07-26]

09:00 | Titel van het item [Binnenland, Politiek]
  Introtekst van het item
```

- `v4` in de eerste regel laat het dashboard output van een oude bookmarklet herkennen en weigeren.
- `[fetch=...]` is het ophaalmoment in Amsterdamse tijd; hiermee bepaalt het dashboard of de agenda verouderd is.
- `[2026-07-26]` achter elke datumkop is de machineleesbare sleutel waarmee dagen met "vandaag" vergeleken en chronologisch gesorteerd worden — ook over een jaarwisseling heen.

## Technische details

- De bookmarklet draait in de browser op het domein `app.anp.nl` (sessiecookies vereist)
- API: `newsapi.anp.nl/services/` met headers `api-version: 1.0`, `appid: INZAGEWEB25`
- Alle datums en tijden worden expliciet in `Europe/Amsterdam` berekend — niet in de zone van de browser en niet in UTC
- Het dashboard is een standalone HTML-bestand met React via CDN — geen buildstap nodig
- De handshake tussen bookmarklet en dashboard is gebonden aan een eenmalig token in de URL, en beide kanten controleren de origin van de tegenpartij
