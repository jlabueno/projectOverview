let jspdfLoader;

async function getJsPDF() {
  if (!jspdfLoader) {
    jspdfLoader = import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js").then(
      (module) => {
        if (module.jspdf?.jsPDF) return module.jspdf.jsPDF;
        if (module.jsPDF) return module.jsPDF;
        throw new Error("Unable to load jsPDF from CDN.");
      }
    );
  }
  return jspdfLoader;
}

export async function generateAnalysisPdf(analysis) {
  if (!analysis) throw new Error("No analysis data available. Run an analysis first.");
  const jsPDF = await getJsPDF();
  const doc = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48;
  const width = doc.internal.pageSize.getWidth() - margin * 2;
  let cursor = margin;

  cursor = writeHeading(doc, "GitHub Project Analyzer Report", margin, cursor);
  cursor = writeText(doc, `Generated: ${new Date().toLocaleString()}`, margin, cursor);
  cursor = writeText(doc, `Repository: ${analysis.repo.fullName}`, margin, cursor);
  cursor = writeText(
    doc,
    `Description: ${analysis.repo.description || "No description provided."}`,
    margin,
    cursor
  );
  cursor += 10;
  cursor = writeSubheading(doc, "Repository stats", margin, cursor);
  cursor = writeBullets(
    doc,
    [
      `Default branch: ${analysis.repo.defaultBranch}`,
      `Stars/Forks/Issues: ${analysis.repo.stars}/${analysis.repo.forks}/${analysis.repo.openIssues}`,
      `Files scanned/analyzed: ${analysis.meta.treeEntries}/${analysis.meta.analyzedFiles}`
    ],
    margin,
    cursor
  );

  cursor += 4;
  cursor = writeSubheading(doc, "Languages", margin, cursor);
  if (analysis.languages.length) {
    cursor = writeBullets(
      doc,
      analysis.languages.map(
        (lang) => `${lang.language}: ${lang.share.toFixed(1)}% (${lang.bytes.toLocaleString()} bytes)`
      ),
      margin,
      cursor
    );
  } else {
    cursor = writeText(doc, "No language data reported.", margin, cursor);
  }

  cursor += 4;
  cursor = writeSubheading(doc, "Class definitions", margin, cursor);
  cursor = writeText(
    doc,
    `Total class-like declarations: ${analysis.classes.total.toLocaleString()}`,
    margin,
    cursor
  );
  cursor = writeTopList(
    doc,
    analysis.classes.files.slice(0, 10),
    (item) => `${item.path} — ${item.classes} classes (${item.language.toUpperCase()})`,
    margin,
    cursor
  );

  cursor += 4;
  cursor = writeSubheading(doc, "Top-level structure", margin, cursor);
  cursor = writeTopList(
    doc,
    analysis.structure.directories,
    (dir) =>
      `${dir.name} (${dir.files} files) · top extensions: ${
        dir.topExtensions.length
          ? dir.topExtensions.map((ext) => `${ext.extension} (${ext.count})`).join(", ")
          : "n/a"
      }`,
    margin,
    cursor
  );
  if (analysis.structure.rootFiles.length) {
    cursor = writeText(
      doc,
      `Root files: ${analysis.structure.rootFiles.slice(0, 10).join(", ")}`,
      margin,
      cursor
    );
  }

  cursor += 4;
  cursor = writeSubheading(doc, "External API calls", margin, cursor);
  cursor = writeTopList(
    doc,
    analysis.externalApis.slice(0, 10),
    (call) => `${call.method} ${call.url} (file: ${call.sourceFile})`,
    margin,
    cursor
  );

  cursor += 4;
  cursor = writeSubheading(doc, "Exposed routes", margin, cursor);
  cursor = writeTopList(
    doc,
    analysis.exposedApis.slice(0, 10),
    (route) => `${route.method} ${route.endpoint} (${route.framework}, file: ${route.sourceFile})`,
    margin,
    cursor
  );

  doc.save(`${analysis.repo.fullName.replace(/[\\/]/g, "-")}-overview.pdf`);
}

function writeHeading(doc, text, x, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(text, x, y);
  return y + 26;
}

function writeSubheading(doc, text, x, y) {
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(text, x, y);
  doc.setFontSize(11);
  return y + 18;
}

function writeText(doc, text, x, y) {
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text, doc.internal.pageSize.getWidth() - x * 2);
  lines.forEach((line) => {
    doc.text(line, x, y);
    y += 14;
  });
  return y;
}

function writeBullets(doc, items, x, y) {
  const width = doc.internal.pageSize.getWidth() - x * 2;
  items.forEach((item) => {
    const lines = doc.splitTextToSize(item, width - 12);
    doc.text("•", x, y);
    lines.forEach((line, idx) => {
      doc.text(line, x + 12, y);
      if (idx < lines.length - 1) y += 14;
    });
    y += 14;
  });
  return y;
}

function writeTopList(doc, items, formatter, x, y) {
  if (!items.length) {
    return writeText(doc, "No data available.", x, y);
  }
  const width = doc.internal.pageSize.getWidth() - x * 2;
  items.forEach((item, index) => {
    const text = formatter(item);
    const lines = doc.splitTextToSize(`${index + 1}. ${text}`, width);
    lines.forEach((line) => {
      doc.text(line, x, y);
      y += 14;
    });
  });
  return y;
}

