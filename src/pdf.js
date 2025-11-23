import { buildAnalysisMarkup } from "./renderers.js";

export async function generateAnalysisPdf(analysis) {
  if (!analysis) throw new Error("No analysis data available. Run an analysis first.");
  const printWindow = window.open("", "_blank", "noopener,noreferrer,width=1024,height=768");
  if (!printWindow) {
    throw new Error("Popup blocked. Allow pop-ups for this site to export the PDF.");
  }

  const styles = await fetchStyles();
  const markup = buildAnalysisMarkup(analysis);
  const printHtml = `
    <!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>GitHub Project Analyzer Report</title>
        <style>
          ${styles}
          body {
            background: #fff;
          }
          .app {
            max-width: 900px;
            margin: 0 auto;
            padding: 2rem 2.5rem 3rem;
          }
          .panel,
          .results,
          .status,
          .progress,
          .actions {
            display: none !important;
          }
          .print-wrapper {
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
          }
        </style>
      </head>
      <body>
        <main class="app print-wrapper">
          <header>
            <h1>GitHub Project Analyzer</h1>
            <p>Generated ${new Date().toLocaleString()}</p>
          </header>
          <section class="results">
            ${markup}
          </section>
        </main>
        <script>
          window.onload = function () {
            setTimeout(function () {
              window.print();
              window.close();
            }, 100);
          };
        </script>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(printHtml);
  printWindow.document.close();
}

async function fetchStyles() {
  try {
    const response = await fetch("./styles.css", { cache: "no-store" });
    if (!response.ok) throw new Error("Stylesheet fetch failed");
    return await response.text();
  } catch {
    return `
      :root {
        font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        --border: #e1e6f0;
        --muted: #5f6b84;
        --surface: #ffffff;
      }
      body { font-family: var(--font, "Inter", sans-serif); color: #080b12; margin: 0; }
      .result-block { border: 1px solid var(--border); border-radius: 1rem; padding: 1.5rem; margin-bottom: 1.5rem; }
    `;
  }
}

