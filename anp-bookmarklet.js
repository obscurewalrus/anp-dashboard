/**
 * ANP Agenda Bookmarklet — Broncode
 *
 * Haalt de volledige ANP-nieuwsagenda op via de ANP API en kopieert deze
 * als geformatteerde tekst naar het klembord. Bedoeld om te draaien als
 * bookmarklet op app.anp.nl (sessiecookies vereist).
 *
 * Werking:
 *   1. Haal alle kalender-ID's op via GET /services/calendars
 *   2. Filter op numerieke ID's (echte kalenders, geen bundle headers)
 *   3. Fetch items per kalender (vandaag + 2 dagen)
 *   4. Dedupliceert op item-ID, merget categorieën bij duplicaten
 *   5. Groepeert per datum, sorteert op starttijd
 *   6. Formatteert naar clipboard-tekst (compatibel met ANP Dashboard parser)
 *
 * API-details:
 *   Base URL:  https://newsapi.anp.nl/services/
 *   Auth:      Sessiecookies via credentials: 'include'
 *   Headers:   api-version: 1.0, appid: INZAGEWEB25
 *
 * Output-formaat (moet compatibel blijven met parseANPAgenda() in anp-dashboard):
 *   ANP AGENDA (opgehaald <datum>)
 *   Periode: YYYY-MM-DD + 2 dagen | Kalenders: N | Items: N
 *   ==================================================
 *
 *   ## <dagnaam> <dag> <maand>
 *
 *   HH:MM | Titel [Categorie1, Categorie2]
 *     Intro tekst
 *
 * @see project-instructions.md voor volledige documentatie
 * @see anp-dashboard.jsx voor de parser die deze output consumeert
 */

(function () {
  // ─── Configuratie ──────────────────────────────────────────────────
  const BASE_URL = "https://newsapi.anp.nl/services/";
  const HEADERS = {
    "api-version": "1.0",
    "appid": "INZAGEWEB25",
  };
  const NUM_DAYS = 3; // vandaag + 2 dagen vooruit
  const MAX_ITEMS_PER_CALENDAR = 200;

  // ─── Datumberekening ───────────────────────────────────────────────
  const now = new Date();
  const fromDate = now.toISOString().split("T")[0]; // YYYY-MM-DD

  // ─── Stap 1: Haal kalenderlijst op ────────────────────────────────
  fetch(BASE_URL + "calendars", {
    headers: HEADERS,
    credentials: "include",
  })
    .then((r) => r.json())
    .then((calendarResponse) => {
      if (calendarResponse.hasError || !calendarResponse.data) {
        alert("Fout bij ophalen kalenders");
        return;
      }

      // Filter: alleen numerieke ID's zijn echte kalenders
      // UUID-achtige ID's zijn bundle headers en worden overgeslagen
      const calendars = calendarResponse.data.filter((c) =>
        /^\d+$/.test(c.id)
      );

      // Bouw een naam-lookup voor categorieën
      const calendarNameMap = {};
      calendars.forEach((c) => {
        calendarNameMap[c.id] = c.name;
      });

      const totalCalendars = calendars.length;

      // ─── Stap 2: Fetch items per kalender ─────────────────────────
      const itemPromises = calendars.map((cal) => {
        const url =
          BASE_URL +
          "calendars/" +
          cal.id +
          "/items?expand=list&count=" +
          MAX_ITEMS_PER_CALENDAR +
          "&fromDate=" +
          fromDate +
          "&numDays=" +
          NUM_DAYS;

        return fetch(url, {
          headers: HEADERS,
          credentials: "include",
        })
          .then((r) => r.json())
          .then((json) => ({
            category: cal.name,
            items: (json.data && json.data.items) || [],
          }))
          .catch(() => ({
            category: cal.name,
            items: [],
          }));
      });

      // ─── Stap 3: Dedupliceert en merge categorieën ────────────────
      Promise.all(itemPromises)
        .then((results) => {
          const seen = {};
          const allItems = [];

          results.forEach((result) => {
            result.items.forEach((apiItem) => {
              const id = apiItem.id;

              if (!seen[id]) {
                // Nieuw item — eerste keer gezien
                seen[id] = true;
                const startDate = apiItem.eventStart
                  ? new Date(apiItem.eventStart)
                  : null;

                allItems.push({
                  title: apiItem.title || "Zonder titel",
                  intro: apiItem.introText || "",
                  start: startDate,
                  date: startDate
                    ? startDate.toLocaleDateString("nl-NL", {
                        weekday: "long",
                        day: "numeric",
                        month: "long",
                      })
                    : "Geen datum",
                  time: startDate
                    ? startDate.toLocaleTimeString("nl-NL", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    : "",
                  cats: [result.category],
                  products: (apiItem.plannedProducts || []).join(", "),
                  words: apiItem.wordCount || 0,
                });
              } else {
                // Duplicaat — voeg categorie toe als die nog niet bestaat
                for (let i = 0; i < allItems.length; i++) {
                  if (allItems[i].title === apiItem.title) {
                    if (allItems[i].cats.indexOf(result.category) === -1) {
                      allItems[i].cats.push(result.category);
                    }
                    break;
                  }
                }
              }
            });
          });

          // ─── Stap 4: Groepeer per datum, sorteer op tijd ──────────
          const dateGroups = {};
          const dateOrder = [];

          allItems.forEach((item) => {
            if (!dateGroups[item.date]) {
              dateGroups[item.date] = [];
              dateOrder.push(item.date);
            }
            dateGroups[item.date].push(item);
          });

          // Sorteer items binnen elke datum op starttijd
          Object.keys(dateGroups).forEach((dateKey) => {
            dateGroups[dateKey].sort((a, b) => {
              if (!a.start) return 1;
              if (!b.start) return -1;
              return a.start - b.start;
            });
          });

          // ─── Stap 5: Formatteer output ────────────────────────────
          // BELANGRIJK: Dit formaat moet compatibel blijven met
          // parseANPAgenda() in anp-dashboard.jsx
          let output = "";

          // Header
          output +=
            "ANP AGENDA (opgehaald " + now.toLocaleString("nl-NL") + ")\n";
          output +=
            "Periode: " +
            fromDate +
            " + 2 dagen | Kalenders: " +
            totalCalendars +
            " | Items: " +
            allItems.length +
            "\n";
          output +=
            "==================================================\n\n";

          // Items per datum
          dateOrder.forEach((dateLabel) => {
            output += "## " + dateLabel + "\n\n";

            dateGroups[dateLabel].forEach((item) => {
              // Tijdstip (optioneel)
              if (item.time) {
                output += item.time + " | ";
              }

              // Titel + categorieën
              output += item.title;
              output += " [" + item.cats.join(", ") + "]";
              output += "\n";

              // Intro (ingesprongen met 2 spaties voor parser-compatibiliteit)
              if (item.intro) {
                output += "  " + item.intro + "\n";
              }

              output += "\n";
            });
          });

          // ─── Stap 6: Kopieer naar klembord ────────────────────────
          navigator.clipboard
            .writeText(output)
            .then(() => {
              alert(
                "ANP agenda gekopieerd!\n" +
                  allItems.length +
                  " items uit " +
                  totalCalendars +
                  " kalenders."
              );
            })
            .catch(() => {
              // Fallback voor browsers zonder Clipboard API
              const textarea = document.createElement("textarea");
              textarea.value = output;
              document.body.appendChild(textarea);
              textarea.select();
              document.execCommand("copy");
              document.body.removeChild(textarea);
              alert(
                "ANP agenda gekopieerd!\n" +
                  allItems.length +
                  " items uit " +
                  totalCalendars +
                  " kalenders."
              );
            });
        })
        .catch((e) => {
          alert("Fout bij items: " + e.message);
        });
    })
    .catch((e) => {
      alert("Fout bij kalenders: " + e.message);
    });
})();
