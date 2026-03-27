import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const pdfFile = document.getElementById("pdfFile");
const extractBtn = document.getElementById("extractBtn");
const exportBtn = document.getElementById("exportBtn");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");
const countBadge = document.getElementById("countBadge");

let extractedRows = [];

const IATA_TO_ICAO = {
  CZL: "DABC",
  ALG: "DAAG",
  ORA: "DAOO",
  ORN: "DAOR",
  IST: "LTFM",
  DJG: "DAAJ",
  HME: "DAUH",
  OGX: "DAUU",
  AZR: "DAUA",
  CBH: "DAOR",
  TLM: "DAON",
  TRM: "DAAT",
  TMR: "DAAT",
  MRS: "LFML",
  LYS: "LFLL",
  CDG: "LFPG",
  ORY: "LFPO",
  ETZ: "LFJL",
  MLH: "LFSB",
  JED: "OEJN",
  MED: "OEMA",
  TGR: "DAUK",
  NCE: "LFMN",
  MLA: "LMML"
};

function setStatus(message, isError = false) {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.className = isError ? "status error" : "status";
}

function normalizeText(text) {
  return text
    .replace(/\u00A0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function convertFlightToDAH(rawFlight) {
  const digits = String(rawFlight).replace(/\D/g, "");
  return digits ? `DAH${digits}` : "";
}

function convertToICAO(code) {
  const clean = String(code || "").trim().toUpperCase();
  return IATA_TO_ICAO[clean] || clean;
}

function normalizeRouteToICAO(routeText) {
  return String(routeText)
    .split("-")
    .map((part) => convertToICAO(part.trim()))
    .join(" - ");
}

function parseRowsFromLines(lines, pageNumber) {
  const rows = [];

  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;

    const routeFlightRegPattern =
      /([A-Z]{3,4}\s*-\s*[A-Z]{3,4})\s+(\d{3,4})\s+[A-Z0-9]{3,4}\s+(7T-[A-Z0-9]{3})/g;

    let match;

    while ((match = routeFlightRegPattern.exec(clean)) !== null) {
      const rawRoute = match[1].replace(/\s+/g, " ").trim();
      const route = normalizeRouteToICAO(rawRoute);
      const rawFlight = `AH${match[2]}`;
      const shownFlight = convertFlightToDAH(rawFlight);
      const reg = match[3];

      rows.push({
        rawFlight,
        shownFlight,
        reg,
        route,
        page: pageNumber
      });
    }
  }

  return rows;
}

async function extractTextFromPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let allText = "";
  let allRows = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const pageText = textContent.items
      .map((item) => item.str)
      .join(" ")
      .replace(/\s{2,}/g, " ");

    allText += `\n--- PAGE ${pageNum} ---\n${pageText}\n`;

    const lineCandidates = [];
    const grouped = new Map();

    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]);
      if (!grouped.has(y)) grouped.set(y, []);
      grouped.get(y).push(item);
    }

    const sortedY = [...grouped.keys()].sort((a, b) => b - a);

    for (const y of sortedY) {
      const line = grouped
        .get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((i) => i.str)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim();

      if (line) lineCandidates.push(line);
    }

    allRows = allRows.concat(parseRowsFromLines(lineCandidates, pageNum));
  }

  return {
    text: normalizeText(allText),
    rows: deduplicateRows(allRows)
  };
}

function deduplicateRows(rows) {
  const seen = new Set();

  return rows.filter((row) => {
    const key = `${row.rawFlight}|${row.reg}|${row.route}|${row.page}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function renderRows(rows) {
  extractedRows = rows;

  if (countBadge) {
    countBadge.textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  }

  if (exportBtn) {
    exportBtn.disabled = rows.length === 0;
  }

  if (!resultsBody) return;

  if (!rows.length) {
    resultsBody.innerHTML =
      '<tr><td colspan="6">No matching flights found.</td></tr>';
    return;
  }

  resultsBody.innerHTML = rows
    .map(
      (row, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${row.rawFlight}</td>
          <td><strong>${row.shownFlight}</strong></td>
          <td>${row.reg}</td>
          <td>${row.route}</td>
          <td>${row.page}</td>
        </tr>
      `
    )
    .join("");
}

function exportCSV() {
  if (!extractedRows.length) return;

  const header = ["Raw Flight", "Shown As", "Aircraft Reg", "Route", "Page"];
  const lines = [header.join(",")];

  for (const row of extractedRows) {
    lines.push(
      [row.rawFlight, row.shownFlight, row.reg, row.route, row.page]
        .map((value) => `"${String(value).replace(/"/g, '""')}"`)
        .join(",")
    );
  }

  const blob = new Blob([lines.join("\n")], {
    type: "text/csv;charset=utf-8;"
  });

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "air-algerie-extracted-flights.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

if (extractBtn) {
  extractBtn.addEventListener("click", async () => {
    try {
      const file = pdfFile?.files?.[0];

      if (!file) {
        setStatus("Please choose a PDF file first.", true);
        return;
      }

      setStatus("Reading PDF and extracting flights...");
      renderRows([]);

      const result = await extractTextFromPdf(file);

      renderRows(result.rows);

      if (result.rows.length) {
        setStatus(
          `Done. Found ${result.rows.length} flight record(s). Routes are displayed in ICAO and flights as DAHXXXX.`
        );
      } else {
        setStatus(
          "PDF was read, but no matching flight rows were found.",
          true
        );
      }
    } catch (error) {
      console.error(error);
      setStatus(`Error: ${error.message}`, true);
    }
  });
}

if (exportBtn) {
  exportBtn.addEventListener("click", exportCSV);
}
