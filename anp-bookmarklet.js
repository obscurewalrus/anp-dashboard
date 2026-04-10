/**
 * ANP Agenda Bookmarklet — Broncode (v3)
 *
 * Haalt de volledige ANP-nieuwsagenda op via de ANP API en stuurt deze
 * direct door naar het ANP Dashboard via postMessage. Bedoeld om te draaien
 * als bookmarklet op app.anp.nl (sessiecookies vereist).
 *
 * Werking:
 *   1. Haal alle kalender-ID's op via GET /services/calendars
 *   2. Filter op numerieke ID's (echte kalenders, geen bundle headers)
 *   3. Fetch items per kalender (vandaag + 2 dagen)
 *   4. Dedupliceert op item-ID, merget categorieën bij duplicaten
 *   5. Groepeert per datum, sorteert op starttijd
 *   6. Formatteert naar tekst (compatibel met dashboard parser)
 *   7. Opent dashboard in nieuw tabblad en stuurt data via postMessage
 *   8. Fallback: kopieer naar klembord als popup geblokkeerd is
 *
 * postMessage handshake:
 *   - Bookmarklet voegt message-listener toe VOOR window.open
 *   - Dashboard laadt met ?autoload=1 en stuurt {type:"ANP_DASHBOARD_READY"}
 *   - Bookmarklet ontvangt READY en stuurt {type:"ANP_AGENDA_DATA", text:"..."}
 *   - Dashboard parseert en toont de data automatisch
 *
 * Configuratie:
 *   Pas DASHBOARD_URL aan naar de URL waar je dashboard staat.
 *   Bijvoorbeeld: https://lucasbrouwers.github.io/anp-nieuwstools/anp-dashboard.html
 *
 * @see project-instructions.md voor volledige documentatie
 * @see anp-dashboard.html voor het dashboard dat deze data ontvangt
 */

(function () {
  // ─── Configuratie ──────────────────────────────────────────────────
  const DASHBOARD_URL =
    "https://USERNAME.github.io/REPO/anp-dashboard.html"; // ← AANPASSEN

  const BASE_URL = "https://newsapi.anp.nl/services/";
  const HEADERS = {
    "api-version": "1.0",
    "appid": "INZAGEWEB25",
  };
  const NUM_DAYS = 3;
  const MAX_ITEMS_PER_CALENDAR = 200;

  const now = new Date();
  const fromDate = now.toISOString().split("T")[0];

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

      const calendars = calendarResponse.data.filter((c) =>
        /^\d+$/.test(c.id)
      );
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
                });
              } else {
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

          Object.keys(dateGroups).forEach((dateKey) => {
            dateGroups[dateKey].sort((a, b) => {
              if (!a.start) return 1;
              if (!b.start) return -1;
              return a.start - b.start;
            });
          });

          // ─── Stap 5: Formatteer output ────────────────────────────
          // BELANGRIJK: Dit formaat moet compatibel blijven met
          // parseANPAgenda() in anp-dashboard.html
          let output = "";
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

          dateOrder.forEach((dateLabel) => {
            output += "## " + dateLabel + "\n\n";
            dateGroups[dateLabel].forEach((item) => {
              if (item.time) output += item.time + " | ";
              output += item.title;
              output += " [" + item.cats.join(", ") + "]";
              output += "\n";
              if (item.intro) output += "  " + item.intro + "\n";
              output += "\n";
            });
          });

          // ─── Stap 6: Verstuur naar dashboard via postMessage ──────
          // BELANGRIJK: listener moet bestaan VOOR window.open zodat
          // we de READY-message van het dashboard kunnen ontvangen.
          let dataSent = false;
          const messageListener = function (event) {
            if (
              !dataSent &&
              event.data &&
              event.data.type === "ANP_DASHBOARD_READY" &&
              event.source
            ) {
              event.source.postMessage(
                { type: "ANP_AGENDA_DATA", text: output },
                "*"
              );
              dataSent = true;
              window.removeEventListener("message", messageListener);
            }
          };
          window.addEventListener("message", messageListener);

          const dashWindow = window.open(
            DASHBOARD_URL + "?autoload=1",
            "_blank"
          );

          if (!dashWindow) {
            // Popup geblokkeerd — fallback naar klembord
            window.removeEventListener("message", messageListener);
            navigator.clipboard
              .writeText(output)
              .then(() => {
                alert(
                  "Popup geblokkeerd. " +
                    allItems.length +
                    " items naar klembord gekopieerd. Plak handmatig in dashboard."
                );
              })
              .catch(() => {
                alert("Popup geblokkeerd én klembord faalt. Sta popups toe.");
              });
            return;
          }

          // Timeout na 30s — opruimen als er niets reageert
          setTimeout(() => {
            if (!dataSent) {
              window.removeEventListener("message", messageListener);
              navigator.clipboard.writeText(output).catch(() => {});
            }
          }, 30000);
        })
        .catch((e) => {
          alert("Fout bij items: " + e.message);
        });
    })
    .catch((e) => {
      alert("Fout bij kalenders: " + e.message);
    });
})();
