const PAGE_WIDTH = 612; // 8.5in
const PAGE_HEIGHT = 792; // 11in
const LEFT_MARGIN = 48;
const TOP_MARGIN = 760;
const LINE_HEIGHT = 14;
const MAX_LINE_LENGTH = 96;

export async function generateAnalysisPdf(analysis) {
  if (!analysis) throw new Error("No analysis data available. Run an analysis first.");

  const lines = [];
  const push = (value = "") => lines.push(value);

  push("GitHub Project Analyzer Report");
  push(`Generated: ${new Date().toLocaleString()}`);
  push(`Repository: ${analysis.repo.fullName}`);
  push(`Description: ${analysis.repo.description || "No description provided."}`);
  push();
  push("Repository stats");
  push(
    `Default branch: ${analysis.repo.defaultBranch} | Stars/Forks/Issues: ${analysis.repo.stars}/${analysis.repo.forks}/${analysis.repo.openIssues}`
  );
  push(
    `Files scanned/analyzed: ${analysis.meta.treeEntries.toLocaleString()}/${analysis.meta.analyzedFiles.toLocaleString()}`
  );
  push();
  push("Languages");
  if (analysis.languages.length) {
    analysis.languages.forEach((lang) =>
      push(`${lang.language}: ${lang.share.toFixed(1)}% (${lang.bytes.toLocaleString()} bytes)`)
    );
  } else {
    push("No language data reported.");
  }
  push();
  push("Class definitions");
  push(`Total class-like declarations: ${analysis.classes.total.toLocaleString()}`);
  analysis.classes.files.slice(0, 10).forEach((file, index) => {
    push(
      `${index + 1}. ${file.path} — ${file.classes} classes (${file.language?.toUpperCase() || "n/a"})`
    );
  });
  push();
  push("Top-level structure");
  analysis.structure.directories.forEach((dir) => {
    const extSummary = dir.topExtensions.length
      ? dir.topExtensions.map((ext) => `${ext.extension} (${ext.count})`).join(", ")
      : "n/a";
    push(`${dir.name} · ${dir.files} files · Top extensions: ${extSummary}`);
  });
  if (analysis.structure.rootFiles.length) {
    push(`Root files: ${analysis.structure.rootFiles.slice(0, 15).join(", ")}`);
  }
  push();
  push("External API calls");
  if (analysis.externalApis.length) {
    analysis.externalApis.slice(0, 10).forEach((call, index) => {
      push(`${index + 1}. ${call.method} ${call.url} (file: ${call.sourceFile})`);
    });
  } else {
    push("No external URLs detected.");
  }
  push();
  push("Exposed routes");
  if (analysis.exposedApis.length) {
    analysis.exposedApis.slice(0, 10).forEach((route, index) => {
      push(
        `${index + 1}. ${route.method} ${route.endpoint} (${route.framework}, file: ${route.sourceFile})`
      );
    });
  } else {
    push("No server endpoints detected.");
  }

  const pdfBytes = buildPdfFromLines(lines);
  const blob = new Blob([pdfBytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${analysis.repo.fullName.replace(/[\\/]/g, "-")}-overview.pdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildPdfFromLines(lines) {
  const wrappedLines = lines.flatMap(wrapLine);
  const maxLinesPerPage = Math.floor((TOP_MARGIN - 60) / LINE_HEIGHT);
  const pages = [];
  let current = [];
  wrappedLines.forEach((line) => {
    if (current.length >= maxLinesPerPage && line !== null) {
      pages.push(current);
      current = [];
    }
    current.push(line);
  });
  if (current.length) pages.push(current);

  const contents = pages.map((pageLines) => {
    let y = TOP_MARGIN;
    let content = "BT\n/F1 11 Tf\n";
    pageLines.forEach((line) => {
      const safeLine = line === "" ? " " : line;
      content += `1 0 0 1 ${LEFT_MARGIN} ${y} Tm (${escapePdfText(safeLine)}) Tj\n`;
      y -= LINE_HEIGHT;
    });
    content += "ET";
    return content;
  });

  return assemblePdf(contents);
}

function wrapLine(line = "") {
  if (!line) return [""];
  const chunks = [];
  let remaining = line;
  while (remaining.length > MAX_LINE_LENGTH) {
    chunks.push(remaining.slice(0, MAX_LINE_LENGTH));
    remaining = remaining.slice(MAX_LINE_LENGTH);
  }
  chunks.push(remaining);
  return chunks;
}

function escapePdfText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function assemblePdf(pageContents) {
  const objects = [];

  function addObject(builder) {
    const obj = { builder };
    objects.push(obj);
    return obj;
  }

  const fontObj = addObject(() => "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  let pageObjects = [];
  const pagesObj = addObject(
    () =>
      `<< /Type /Pages /Count ${pageObjects.length} /Kids [${pageObjects
        .map((page) => `${page.id} 0 R`)
        .join(" ")}] >>`
  );
  const catalogObj = addObject(() => `<< /Type /Catalog /Pages ${pagesObj.id} 0 R >>`);

  const contentObjects = pageContents.map((content) =>
    addObject(() => {
      const length = new TextEncoder().encode(content).length;
      return `<< /Length ${length} >>\nstream\n${content}\nendstream`;
    })
  );

  pageObjects = pageContents.map((_, index) =>
    addObject(
      () =>
        `<< /Type /Page /Parent ${pagesObj.id} 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${fontObj.id} 0 R >> >> /Contents ${contentObjects[index].id} 0 R >>`
    )
  );

  objects.forEach((obj, index) => {
    obj.id = index + 1;
  });

  const encoder = new TextEncoder();
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  let offset = pdf.length;

  objects.forEach((obj) => {
    const body = `${obj.id} 0 obj\n${obj.builder()}\nendobj\n`;
    pdf += body;
    offsets.push(offset);
    offset += body.length;
  });

  const xrefPosition = offset;
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i < offsets.length; i += 1) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogObj.id} 0 R >>\n`;
  pdf += `startxref\n${xrefPosition}\n%%EOF`;

  return encoder.encode(pdf);
}

