/**
 * ANP Agenda Bookmarklet — Broncode (v4)
 *
 * Haalt de volledige ANP-nieuwsagenda op via de ANP API en stuurt deze
 * direct door naar het ANP Dashboard via postMessage. Bedoeld om te draaien
 * als bookmarklet op app.anp.nl (sessiecookies vereist).
 *
 * Dit bestand is de ENIGE bron van waarheid voor de bookmarklet-code.
 * anp-bookmarklet.html laadt het via <script src> en bouwt de javascript:-URL
 * met anpBookmarklet.toString(). Bewerk de bookmarklet dus alleen hier.
 *
 * Werking:
 *   1. Haal alle kalender-ID's op via GET /services/calendars
 *   2. Filter op numerieke ID's (echte kalenders, geen bundle headers)
 *   3. Fetch items per kalender (vandaag + 2 dagen, Amsterdamse tijd)
 *   4. Dedupliceert op item-ID, merget categorieën bij duplicaten
 *   5. Groepeert per datum, sorteert op starttijd
 *   6. Formatteert naar tekst (compatibel met dashboard parser)
 *   7. Opent dashboard in nieuw tabblad en stuurt data via postMessage
 *   8. Fallback: kopieer naar klembord als popup geblokkeerd is
 *
 * Alle datums en tijden worden expliciet in Europe/Amsterdam berekend. De
 * browser van de gebruiker kan in een andere zone staan; zonder die expliciete
 * zone belandt een item van 00:30 op de vorige dag.
 *
 * Uitvoerformaat (het contract met parseANPAgenda() in anp-dashboard.html):
 *
 *   ANP AGENDA v4 (opgehaald 26-07-2026 09:41) [fetch=2026-07-26T09:41]
 *   Periode: 2026-07-26 t/m 2026-07-28 | Kalenders: 12 | Items: 143
 *   ==================================================
 *
 *   ## zondag 26 juli 2026 [2026-07-26]
 *
 *   09:00 | Titel van het item [Binnenland, Politiek]
 *     Introtekst van het item
 *
 * De ISO-sleutel achter elke datumkop laat het dashboard dagen vergelijken met
 * "vandaag" zonder Nederlandse maandnamen te hoeven terugrekenen. De v4-markering
 * in de eerste regel laat het dashboard output van een oude bookmarklet herkennen.
 *
 * postMessage handshake:
 *   - Bookmarklet voegt message-listener toe VOOR window.open
 *   - Dashboard laadt met ?autoload=1 en stuurt {type:"ANP_DASHBOARD_READY"}
 *   - Bookmarklet controleert afzender en stuurt {type:"ANP_AGENDA_DATA", text:"..."}
 *   - Dashboard parseert en toont de data automatisch
 *
 * @see anp-bookmarklet.html voor de installatiepagina die deze code inpakt
 * @see anp-dashboard.html voor het dashboard dat deze data ontvangt
 */

/**
 * @param {string} DASHBOARD_URL Absolute URL van anp-dashboard.html. De
 *   installatiepagina leidt deze af uit haar eigen locatie en geeft hem hier mee.
 */
function anpBookmarklet(DASHBOARD_URL) {
  var BASE_URL = "https://newsapi.anp.nl/services/";
  var HEADERS = { "api-version": "1.0", "appid": "INZAGEWEB25" };
  var TZ = "Europe/Amsterdam";
  var NUM_DAYS = 3;
  var MAX_ITEMS_PER_CALENDAR = 200;

  // ─── Datumhelpers (altijd Europe/Amsterdam) ───────────────────────
  // en-CA levert het formaat YYYY-MM-DD, precies wat de API en het
  // dashboard verwachten.
  function isoDay(d) {
    return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
  }
  function clockTime(d) {
    return new Intl.DateTimeFormat("nl-NL", {
      timeZone: TZ,
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  }
  function dayLabel(d) {
    return d.toLocaleDateString("nl-NL", {
      timeZone: TZ,
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
  // Kalenderrekenwerk op een kale YYYY-MM-DD, los van tijdzones.
  function addDays(iso, n) {
    var p = iso.split("-");
    var dt = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    dt.setUTCDate(dt.getUTCDate() + n);
    return dt.toISOString().split("T")[0];
  }

  var now = new Date();
  var fromDate = isoDay(now);
  var todayLabel = dayLabel(now);

  // Eenmalig geheim dat we via de URL aan het dashboard meegeven en dat het
  // moet terugsturen. Zonder deze koppeling kan elk venster dat toevallig
  // "ANP_DASHBOARD_READY" roept de complete agenda opvangen.
  var token = Math.random().toString(36).slice(2) + Date.now().toString(36);

  // ─── Doel-origin voor postMessage ─────────────────────────────────
  // Nooit naar "*" posten als het te vermijden is: de agenda is interne
  // data en de bookmarklet draait op app.anp.nl, waar ook andere frames
  // kunnen meeluisteren. Bij file:// is er geen echte origin; dan valt
  // het terug op "*" en waarschuwt de installatiepagina daar al over.
  var dashOrigin;
  try {
    dashOrigin = new URL(DASHBOARD_URL, location.href).origin;
  } catch (e) {
    dashOrigin = "*";
  }
  if (!dashOrigin || dashOrigin === "null") dashOrigin = "*";

  function get(url) {
    return fetch(url, {
      headers: HEADERS,
      credentials: "include",
      cache: "no-store",
    }).then(function (r) {
      return r.json();
    });
  }

  // ─── Stap 1: Haal kalenderlijst op ────────────────────────────────
  get(BASE_URL + "calendars")
    .then(function (calendarResponse) {
      if (calendarResponse.hasError || !calendarResponse.data) {
        alert("Fout bij ophalen kalenders");
        return;
      }

      var calendars = calendarResponse.data.filter(function (c) {
        return /^\d+$/.test(c.id);
      });
      var totalCalendars = calendars.length;

      // ─── Stap 2: Fetch items per kalender ───────────────────────
      var itemPromises = calendars.map(function (cal) {
        var url =
          BASE_URL +
          "calendars/" +
          cal.id +
          "/items?expand=list&count=" +
          MAX_ITEMS_PER_CALENDAR +
          "&fromDate=" +
          fromDate +
          "&numDays=" +
          NUM_DAYS;

        return get(url)
          .then(function (json) {
            return {
              category: cal.name,
              items: (json.data && json.data.items) || [],
            };
          })
          .catch(function () {
            return { category: cal.name, items: [] };
          });
      });

      // ─── Stap 3: Dedupliceer en merge categorieën ───────────────
      Promise.all(itemPromises)
        .then(function (results) {
          // seen bewaart de itemreferentie zelf, niet alleen een vlag. Een
          // duplicaat vindt zo direct het bestaande item om zijn categorie
          // aan toe te voegen; zoeken op titel liet categorieën verdwijnen
          // zodra een titel leeg was of niet exact matchte.
          var seen = {};
          var allItems = [];

          results.forEach(function (result) {
            result.items.forEach(function (apiItem) {
              var existing = seen[apiItem.id];

              if (existing) {
                if (existing.cats.indexOf(result.category) === -1) {
                  existing.cats.push(result.category);
                }
                return;
              }

              var startDate = apiItem.eventStart
                ? new Date(apiItem.eventStart)
                : null;
              var title = apiItem.title || "Zonder titel";
              var iso = startDate ? isoDay(startDate) : "";
              var label = startDate ? dayLabel(startDate) : "Geen datum";
              var time = startDate ? clockTime(startDate) : "";

              // Meerdaagse events (rechtszaken, festivals) beginnen vóór
              // vandaag maar lopen nog. Die horen bij het nieuws van vandaag,
              // niet bij een dag die je standaard niet ziet. Ze verhuizen dus
              // naar vandaag; de starttijd vervalt, want die sloeg op een
              // andere dag. Heeft de API geen eventEnd, dan blijft het item
              // gewoon onder zijn eigen (voorbije) datum staan.
              if (iso && iso < fromDate) {
                var endIso = apiItem.eventEnd
                  ? isoDay(new Date(apiItem.eventEnd))
                  : "";
                if (endIso && endIso >= fromDate) {
                  iso = fromDate;
                  label = todayLabel;
                  time = "";
                  title = title + " (loopt door)";
                }
              }

              var item = {
                title: title,
                intro: apiItem.introText || "",
                start: startDate,
                iso: iso,
                date: label,
                time: time,
                cats: [result.category],
              };

              seen[apiItem.id] = item;
              allItems.push(item);
            });
          });

          // ─── Stap 4: Groepeer per datum, sorteer op tijd ────────
          var dateGroups = {};
          var dateOrder = [];

          allItems.forEach(function (item) {
            var key = item.iso || "geen-datum";
            if (!dateGroups[key]) {
              dateGroups[key] = { iso: item.iso, label: item.date, items: [] };
              dateOrder.push(key);
            }
            dateGroups[key].items.push(item);
          });

          dateOrder.sort(function (a, b) {
            // Items zonder datum altijd achteraan.
            if (a === "geen-datum") return 1;
            if (b === "geen-datum") return -1;
            return a < b ? -1 : a > b ? 1 : 0;
          });

          dateOrder.forEach(function (key) {
            dateGroups[key].items.sort(function (a, b) {
              if (!a.start) return 1;
              if (!b.start) return -1;
              return a.start - b.start;
            });
          });

          // ─── Stap 5: Formatteer output ─────────────────────────
          // BELANGRIJK: dit formaat is het contract met parseANPAgenda()
          // in anp-dashboard.html. Wijzig het daar mee.
          var output = "";
          output +=
            "ANP AGENDA v4 (opgehaald " +
            now.toLocaleDateString("nl-NL", {
              timeZone: TZ,
              day: "2-digit",
              month: "2-digit",
              year: "numeric",
            }) +
            " " +
            clockTime(now) +
            ") [fetch=" +
            fromDate +
            "T" +
            clockTime(now) +
            "]\n";
          output +=
            "Periode: " +
            fromDate +
            " t/m " +
            addDays(fromDate, NUM_DAYS - 1) +
            " | Kalenders: " +
            totalCalendars +
            " | Items: " +
            allItems.length +
            "\n";
          output += "==================================================\n\n";

          dateOrder.forEach(function (key) {
            var group = dateGroups[key];
            output +=
              "## " + group.label + (group.iso ? " [" + group.iso + "]" : "") + "\n\n";
            group.items.forEach(function (item) {
              if (item.time) output += item.time + " | ";
              output += item.title;
              output += " [" + item.cats.join(", ") + "]";
              output += "\n";
              if (item.intro) output += "  " + item.intro + "\n";
              output += "\n";
            });
          });

          // ─── Stap 6: Verstuur naar dashboard via postMessage ────
          // BELANGRIJK: listener moet bestaan VOOR window.open zodat
          // we de READY-message van het dashboard kunnen ontvangen.
          var dataSent = false;
          var dashWindow = null;

          function copyToClipboard(reason) {
            navigator.clipboard
              .writeText(output)
              .then(function () {
                alert(
                  reason +
                    " " +
                    allItems.length +
                    " items naar klembord gekopieerd. Plak handmatig in het dashboard."
                );
              })
              .catch(function () {
                alert(
                  reason +
                    " Kopiëren naar klembord lukte ook niet. Open het dashboard " +
                    "en klik de bookmarklet opnieuw, of sta popups toe voor app.anp.nl."
                );
              });
          }

          var messageListener = function (event) {
            if (dataSent) return;
            if (!event.data || event.data.type !== "ANP_DASHBOARD_READY") return;
            // Drie controles: het moet het venster zijn dat wij zelf geopend
            // hebben, op de verwachte origin, en het moet ons token kunnen
            // terugsturen. dashWindow is al gezet voordat er een READY kan
            // binnenkomen, want window.open() geeft synchroon terug.
            if (dashWindow && event.source !== dashWindow) return;
            if (dashOrigin !== "*" && event.origin !== dashOrigin) return;
            if (event.data.token !== token) return;

            event.source.postMessage(
              { type: "ANP_AGENDA_DATA", token: token, text: output },
              dashOrigin
            );
            dataSent = true;
            window.removeEventListener("message", messageListener);
          };
          window.addEventListener("message", messageListener);

          dashWindow = window.open(
            DASHBOARD_URL + "?autoload=1&t=" + token,
            "_blank"
          );

          if (!dashWindow) {
            // Popup geblokkeerd — fallback naar klembord. Dit gebeurt nog
            // binnen de klik, dus het klembord is hier gewoon beschikbaar.
            window.removeEventListener("message", messageListener);
            copyToClipboard("Popup geblokkeerd.");
            return;
          }

          // Timeout na 30s — opruimen als er niets reageert. Het klembord
          // weigert hier meestal (de user-activation is verlopen), dus de
          // melding vertelt wat er aan de hand is in plaats van te zwijgen.
          setTimeout(function () {
            if (dataSent) return;
            window.removeEventListener("message", messageListener);
            copyToClipboard(
              "Het dashboard reageerde niet binnen 30 seconden. Controleer of " +
                "de bookmarklet naar de juiste dashboard-URL wijst en of je hem " +
                "opnieuw naar je bladwijzerbalk hebt gesleept."
            );
          }, 30000);
        })
        .catch(function (e) {
          alert("Fout bij items: " + e.message);
        });
    })
    .catch(function (e) {
      alert("Fout bij kalenders: " + e.message);
    });
}
