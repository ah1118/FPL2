import * as pdfjsLib from "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.4.168/pdf.worker.min.mjs";

const pdfFile = document.getElementById("pdfFile");
const extractBtn = document.getElementById("extractBtn");
const downloadBtn = document.getElementById("downloadBtn");
const statusEl = document.getElementById("status");
const resultsBody = document.getElementById("resultsBody");
const textPreview = document.getElementById("textPreview");

let extractedRows = [];

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.style.color = isError ? "#ef4444" : "#cbd5e1";
}

function toDAH(flight) {
  const digits = String(flight).replace(/\D/g, "");
  return digits ? `DAH${digits}` : "";
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
  downloadBtn.disabled = rows.length === 0;

  if (!rows.length) {
    resultsBody.innerHTML = `<tr><td colspan="6">No matching flights found.</td></tr>`;
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

  const headers = ["Raw Flight", "Shown As", "Aircraft Reg", "Route", "Page"];
  const lines = [headers.join(",")];

  for (const row of extractedRows) {
    lines.push(
      [
        row.rawFlight,
        row.shownFlight,
        row.reg,
        row.route,
        row.page
      ]
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
  a.download = "air-algerie-flights.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function extractMatchesFromLine(line, pageNumber) {
  const rows = [];

  // Example:
  // CZL - ORN 6169 B738 7T-VKA
  const regex = /([A-Z]{3}\s*-\s*[A-Z]{3})\s+(\d{3,4})\s+[A-Z0-9]{3,4}\s+(7T-[A-Z0-9]{3})/g;

  let match;
  while ((match = regex.exec(line)) !== null) {
    const route = match[1].replace(/\s+/g, " ").trim();
    const flightDigits = match[2];
    const reg = match[3];

    const rawFlight = `AH${flightDigits}`;
    const shownFlight = toDAH(rawFlight);

    rows.push({
      rawFlight,
      shownFlight,
      reg,
      route,
      page: pageNumber
    });
  }

  return rows;
}

async function readPdf(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let allText = "";
  let rows = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    const grouped = new Map();

    for (const item of textContent.items) {
      const y = Math.round(item.transform[5]);
      if (!grouped.has(y)) grouped.set(y, []);
      grouped.get(y).push(item);
    }

    const sortedY = [...grouped.keys()].sort((a, b) => b - a);

    const lines = sortedY.map((y) =>
      grouped
        .get(y)
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map((item) => item.str)
        .join(" ")
        .replace(/\s{2,}/g, " ")
        .trim()
    );

    allText += `\n--- PAGE ${pageNum} ---\n${lines.join("\n")}\n`;

    for (const line of lines) {
      rows.push(...extractMatchesFromLine(line, pageNum));
    }
  }

  return {
    text: allText.trim(),
    rows: deduplicateRows(rows)
  };
}

extractBtn.addEventListener("click", async () => {
  try {
    const file = pdfFile.files[0];

    if (!file) {
      setStatus("Please select a PDF file first.", true);
      return;
    }

    setStatus("Reading PDF...");
    renderRows([]);
    textPreview.value = "";

    const result = await readPdf(file);

    textPreview.value = result.text;
    renderRows(result.rows);

    if (result.rows.length) {
      setStatus(`Done. Found ${result.rows.length} flight record(s).`);
    } else {
      setStatus("No matching flights found in this PDF.", true);
    }
  } catch (error) {
    console.error(error);
    setStatus(`Error: ${error.message}`, true);
  }
});

downloadBtn.addEventListener("click", exportCSV);
