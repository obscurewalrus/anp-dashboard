/**
 * ANP Agenda Bookmarklet — Broncode (v4)
 *
 * Haalt de volledige ANP-nieuwsagenda op via de ANP API en stuurt deze
 * direct door naar het ANP Dashboard via postMessage. Bedoeld om te draaien
 * als bookmarklet op app.anp.nl (sessiecookies vereist).
 *
 * ─── Wat er in v4 is opgelost ──────────────────────────────────────────
 *
 * 1. ONTBREKENDE ITEMS OP DE LAATSTE DAG
 *    v3 deed één request per kalender voor het hele venster met count=200.
 *    Kalenders met veel items (Sport, Binnenland, Rechtbank) raakten dat
 *    budget al op bij dag 1 en 2, waardoor de laatste dag van het venster
 *    systematisch leeg of half gevuld bleef. v4 doet één request per
 *    kalender PER DAG, zodat elke dag zijn eigen budget heeft.
 *
 * 2. HISTORISCHE ITEMS (bijv. "1 januari")
 *    De API levert ook doorlopende items terug waarvan eventStart ver in
 *    het verleden ligt (jaarthema's, tentoonstellingen, meerdaagse zaken).
 *    v3 groepeerde die op hun startdatum en toonde dus een spookdag
 *    "1 januari". v4 filtert alles buiten het venster weg. Uitzondering:
 *    een item dat eerder begon maar BINNEN het venster eindigt blijft
 *    staan — op zijn einddatum, met de extra categorie "Doorlopend".
 *
 * 3. TIJDZONE
 *    v3 gebruikte toISOString() (UTC) voor fromDate. Tussen 00:00 en 02:00
 *    Nederlandse zomertijd leverde dat de datum van gisteren op. v4 rekent
 *    volledig in lokale tijd.
 *
 * 4. CATEGORIEËN OP HET VERKEERDE ITEM
 *    v3 zocht bij een duplicaat het bestaande item op via de TITEL. Twee
 *    items met dezelfde titel (bijv. "Persconferentie") kregen daardoor
 *    elkaars categorieën. v4 dedupliceert en merget consequent op ID.
 *
 * 5. MEERREGELIGE INTRO'S BRAKEN HET OUTPUTFORMAAT
 *    Een introText met een newline erin liep uit de indentatie van het
 *    tekstformaat, waardoor de dashboardparser regels als losse items las
 *    of oversloeg. Titels en intro's worden nu naar één regel platgeslagen.
 *
 * 6. CONTROLEERBAARHEID
 *    De kopregel bevat nu het exacte venster, het aantal items per dag,
 *    hoeveel items buiten het venster zijn genegeerd en of een kalender
 *    tegen de count-limiet aan liep. Zo is direct zichtbaar of er iets mist.
 *
 * Werking:
 *   1. Haal alle kalender-ID's op via GET /services/calendars
 *   2. Filter op numerieke ID's (echte kalenders, geen bundle headers)
 *   3. Fetch per kalender per dag (fromDate=<dag>&numDays=1)
 *   4. Filter items op het lokale datumvenster, dedupliceer op ID
 *   5. Groepeer per datum (chronologisch), sorteer op starttijd
 *   6. Formatteer naar tekst (compatibel met dashboard parser)
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
 *   DASHBOARD_URL — de URL waar je dashboard staat.
 *   NUM_DAYS      — grootte van het venster, vandaag meegerekend.
 *                   5 = vandaag + 4 dagen (op donderdag dus t/m maandag).
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

  // Aantal dagen in het venster, vandaag meegerekend.
  const NUM_DAYS = 5;

  // Maximaal aantal items per kalender PER DAG. Ruim boven wat een
  // kalender op één dag heeft; loopt een kalender hier toch tegenaan,
  // dan wordt dat in de kopregel gemeld.
  const MAX_ITEMS_PER_DAY = 500;

  // Aantal gelijktijdige requests. De browser knijpt zelf al af rond 6
  // per host; hoger zetten levert vooral timeouts op.
  const CONCURRENCY = 6;

  // ─── Datumhelpers (lokale tijd, expliciet géén UTC) ────────────────
  const pad = (n) => (n < 10 ? "0" : "") + n;
  const isoOf = (d) =>
    d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const dayStart = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const labelOf = (d) =>
    d.toLocaleDateString("nl-NL", {
      weekday: "long",
      day: "numeric",
      month: "long",
    });
  const timeOf = (d) =>
    d.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });

  // Titels en intro's mogen nooit een newline bevatten: het tekstformaat
  // naar het dashboard is regelgebaseerd.
  const oneLine = (s) => String(s || "").replace(/\s+/g, " ").trim();

  const now = new Date();
  const windowStart = dayStart(now);
  const windowEnd = new Date(
    windowStart.getFullYear(),
    windowStart.getMonth(),
    windowStart.getDate() + NUM_DAYS
  ); // exclusief

  const days = [];
  for (let i = 0; i < NUM_DAYS; i++) {
    const d = new Date(
      windowStart.getFullYear(),
      windowStart.getMonth(),
      windowStart.getDate() + i
    );
    days.push({ iso: isoOf(d), label: labelOf(d) });
  }

  // ─── Voortgangsindicator ───────────────────────────────────────────
  // Het ophalen duurt met NUM_DAYS × kalenders requests merkbaar langer
  // dan in v3; zonder feedback lijkt de bookmarklet niets te doen.
  const box = document.createElement("div");
  box.style.cssText =
    "position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;" +
    "background:#0f172a;color:#e2e8f0;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.35);" +
    "font:13px/1.4 system-ui,-apple-system,sans-serif;pointer-events:none";
  box.textContent = "ANP agenda ophalen…";
  document.body.appendChild(box);
  const status = (t) => {
    box.textContent = t;
  };
  const statusDone = (t) => {
    box.textContent = t;
    setTimeout(() => box.remove(), 5000);
  };

  // ─── Requestpool met beperkte gelijktijdigheid ─────────────────────
  function runPool(makers, limit, onProgress) {
    return new Promise((resolve) => {
      const out = new Array(makers.length);
      let next = 0;
      let done = 0;
      if (!makers.length) return resolve(out);

      function launch() {
        while (next < makers.length && next - done < limit) {
          ((k) => {
            makers[k]()
              .then(
                (v) => {
                  out[k] = v;
                },
                () => {
                  out[k] = null;
                }
              )
              .then(() => {
                done++;
                if (onProgress) onProgress(done, makers.length);
                if (done === makers.length) resolve(out);
                else launch();
              });
          })(next++);
        }
      }
      launch();
    });
  }

  // ─── Plaats een API-item in het venster ────────────────────────────
  // Retourneert null als het item buiten het venster valt (en dus niet
  // getoond moet worden). Een item dat vóór het venster begon maar erbinnen
  // eindigt, wordt op zijn EINDdatum geplaatst — dat is de nieuwswaardige
  // dag (uitspraak, slotdag) — en gemarkeerd als doorlopend.
  function placeInWindow(apiItem) {
    const rawStart = apiItem.eventStart;
    const start = rawStart ? new Date(rawStart) : null;

    if (!start || isNaN(start.getTime())) {
      return { iso: "", label: "Geen datum", time: "", running: false, sort: null };
    }

    const startDay = dayStart(start);
    if (startDay >= windowStart && startDay < windowEnd) {
      return {
        iso: isoOf(startDay),
        label: labelOf(startDay),
        time: timeOf(start),
        running: false,
        sort: start,
      };
    }

    if (startDay < windowStart) {
      const rawEnd = apiItem.eventEnd || apiItem.eventEndDate || null;
      const end = rawEnd ? new Date(rawEnd) : null;
      if (end && !isNaN(end.getTime())) {
        const endDay = dayStart(end);
        if (endDay >= windowStart && endDay < windowEnd) {
          return {
            iso: isoOf(endDay),
            label: labelOf(endDay),
            time: timeOf(end),
            running: true,
            sort: end,
          };
        }
      }
      return null; // historisch of doorlopend buiten het venster
    }

    return null; // begint ná het venster
  }

  // ─── Stap 1: Haal kalenderlijst op ────────────────────────────────
  fetch(BASE_URL + "calendars", {
    headers: HEADERS,
    credentials: "include",
  })
    .then((r) => r.json())
    .then((calendarResponse) => {
      if (calendarResponse.hasError || !calendarResponse.data) {
        statusDone("Fout bij ophalen kalenders");
        alert("Fout bij ophalen kalenders");
        return;
      }

      const calendars = calendarResponse.data.filter((c) =>
        /^\d+$/.test(c.id)
      );
      const totalCalendars = calendars.length;

      // ─── Stap 2: Eén request per kalender per dag ─────────────────
      // Dag-major volgorde: alle kalenders voor dag 1, dan dag 2, enz.
      // Daardoor is de verwerkingsvolgorde deterministisch en landen
      // doorlopende items op de vroegste dag waarop ze voorkomen.
      const tasks = [];
      days.forEach((day, dayIndex) => {
        calendars.forEach((cal) => {
          tasks.push(() => {
            const url =
              BASE_URL +
              "calendars/" +
              cal.id +
              "/items?expand=list&count=" +
              MAX_ITEMS_PER_DAY +
              "&fromDate=" +
              day.iso +
              "&numDays=1";

            return fetch(url, {
              headers: HEADERS,
              credentials: "include",
            })
              .then((r) => r.json())
              .then((json) => ({
                category: cal.name,
                dayIndex,
                items: (json.data && json.data.items) || [],
                failed: false,
              }))
              .catch(() => ({
                category: cal.name,
                dayIndex,
                items: [],
                failed: true,
              }));
          });
        });
      });

      status(
        "ANP agenda ophalen… 0/" +
          tasks.length +
          " (" +
          totalCalendars +
          " kalenders × " +
          NUM_DAYS +
          " dagen)"
      );

      // ─── Stap 3: Filter op venster, dedupliceer op ID ─────────────
      runPool(tasks, CONCURRENCY, (done, total) =>
        status("ANP agenda ophalen… " + done + "/" + total)
      )
        .then((results) => {
          const byId = Object.create(null); // ID → item (alleen bewaarde items)
          const droppedIds = Object.create(null); // ID → true (buiten venster)
          const allItems = [];
          const truncated = [];
          let failedRequests = 0;

          results.forEach((result) => {
            if (!result) {
              failedRequests++;
              return;
            }
            if (result.failed) failedRequests++;

            // Raakt een kalender op één dag de count-limiet, dan kán er
            // afgekapt zijn. Melden in plaats van stil verliezen.
            if (result.items.length >= MAX_ITEMS_PER_DAY) {
              truncated.push(
                result.category + " (" + days[result.dayIndex].iso + ")"
              );
            }

            result.items.forEach((apiItem) => {
              const id = String(
                apiItem.id != null
                  ? apiItem.id
                  : oneLine(apiItem.title) + "|" + apiItem.eventStart
              );

              const existing = byId[id];
              if (existing) {
                // Zelfde item uit een andere kalender: categorie erbij.
                if (existing.cats.indexOf(result.category) === -1) {
                  existing.cats.push(result.category);
                }
                return;
              }

              const placed = placeInWindow(apiItem);
              if (!placed) {
                // Niet als 'gezien' markeren: een ander request mag dit
                // item alsnog binnen het venster aanleveren.
                droppedIds[id] = true;
                return;
              }

              const cats = [result.category];
              if (placed.running) cats.push("Doorlopend");

              const item = {
                title: oneLine(apiItem.title) || "Zonder titel",
                intro: oneLine(apiItem.introText),
                iso: placed.iso,
                date: placed.label,
                time: placed.time,
                start: placed.sort,
                cats,
              };

              byId[id] = item;
              allItems.push(item);
            });
          });

          const droppedCount = Object.keys(droppedIds).length;

          // ─── Stap 4: Groepeer per datum, sorteer op tijd ──────────
          const groups = Object.create(null); // iso → { label, items }
          allItems.forEach((item) => {
            const key = item.iso || "";
            if (!groups[key]) groups[key] = { label: item.date, items: [] };
            groups[key].items.push(item);
          });

          // Chronologisch; "Geen datum" (lege iso) altijd achteraan.
          const groupKeys = Object.keys(groups).sort((a, b) => {
            if (!a) return 1;
            if (!b) return -1;
            return a < b ? -1 : a > b ? 1 : 0;
          });

          groupKeys.forEach((key) => {
            groups[key].items.sort((a, b) => {
              if (!a.start) return 1;
              if (!b.start) return -1;
              return a.start - b.start;
            });
          });

          // ─── Stap 5: Formatteer output ────────────────────────────
          // BELANGRIJK: Dit formaat moet compatibel blijven met
          // parseANPAgenda() in anp-dashboard.html. De datumkop is
          // "## <ISO> | <label>"; het dashboard sorteert op de ISO-datum
          // en toont het label.
          const perDay = days
            .map((d) => {
              const g = groups[d.iso];
              return d.iso.slice(8) + "/" + d.iso.slice(5, 7) + ": " +
                (g ? g.items.length : 0);
            })
            .join(" · ");

          let output = "";
          output +=
            "ANP AGENDA (opgehaald " + now.toLocaleString("nl-NL") + ")\n";
          output +=
            "Periode: " +
            days[0].iso +
            " t/m " +
            days[days.length - 1].iso +
            " (" +
            NUM_DAYS +
            " dagen) | Kalenders: " +
            totalCalendars +
            " | Items: " +
            allItems.length +
            "\n";
          output += "Per dag: " + perDay + "\n";
          output +=
            "Buiten venster genegeerd: " +
            droppedCount +
            (failedRequests ? " | Mislukte requests: " + failedRequests : "") +
            "\n";
          if (truncated.length) {
            output +=
              "LET OP — limiet van " +
              MAX_ITEMS_PER_DAY +
              " geraakt bij: " +
              truncated.join(", ") +
              "\n";
          }
          output +=
            "==================================================\n\n";

          groupKeys.forEach((key) => {
            const group = groups[key];
            output += "## " + (key ? key + " | " : "") + group.label + "\n\n";
            group.items.forEach((item) => {
              if (item.time) output += item.time + " | ";
              output += item.title;
              output += " [" + item.cats.join(", ") + "]";
              output += "\n";
              if (item.intro) output += "  " + item.intro + "\n";
              output += "\n";
            });
          });

          statusDone(
            allItems.length +
              " items over " +
              groupKeys.length +
              " dagen — dashboard opent…"
          );

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
          statusDone("Fout bij items: " + e.message);
          alert("Fout bij items: " + e.message);
        });
    })
    .catch((e) => {
      statusDone("Fout bij kalenders: " + e.message);
      alert("Fout bij kalenders: " + e.message);
    });
})();
