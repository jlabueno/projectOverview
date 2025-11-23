const numberFormat = new Intl.NumberFormat();
const percentFormat = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 1
});

export function renderAnalysis(container, data) {
  container.classList.remove("hidden");
  container.innerHTML = buildAnalysisMarkup(data);
}

export function buildAnalysisMarkup(data) {
  return `
    ${renderRepositorySummary(data.repo, data.meta)}
    ${renderLanguages(data.languages)}
    ${renderArchitecture(data.architecture)}
    ${renderStructure(data.structure)}
    ${renderClassStats(data.classes)}
    ${renderExternalApis(data.externalApis)}
    ${renderExposedApis(data.exposedApis)}
  `;
}

function renderArchitecture(architecture) {
  if (!architecture || !architecture.components.length) {
    return `
      <section class="result-block">
        <h2>Architecture overview</h2>
        <p class="muted">Could not derive major components from the repository structure.</p>
      </section>
    `;
  }

  return `
    <section class="result-block">
      <h2>Architecture overview</h2>
      ${renderArchitectureBlocks(architecture)}
      ${renderArchitectureWorkflow(architecture.workflow)}
    </section>
  `;
}

function renderArchitectureBlocks(architecture) {
  return `
    <div class="architecture">
      <div class="architecture__node architecture__node--root">
        <h3>${architecture.repo.name}</h3>
        <p class="muted">Key languages: ${architecture.repo.languages.join(", ") || "n/a"}</p>
      </div>
      <div class="architecture__branches">
        ${architecture.components
          .map(
            (component) => `
              <div class="architecture__branch">
                <span class="architecture__line"></span>
                <div class="architecture__node">
                  <h4>${component.name}</h4>
                  <p class="muted">${numberFormat.format(component.files)} files</p>
                  <div class="architecture__tech">
                    ${
                      component.technologies.length
                        ? component.technologies
                            .map((tech) => `<span class="pill pill--small">${tech}</span>`)
                            .join("")
                        : `<span class="pill pill--small">Mixed</span>`
                    }
                  </div>
                  ${
                    component.samples.length
                      ? `<p class="mono architecture__samples">${component.samples.join("<br />")}</p>`
                      : ""
                  }
                </div>
              </div>
            `
          )
          .join("")}
      </div>
    </div>
  `;
}

function renderArchitectureWorkflow(workflow = []) {
  if (!workflow.length) {
    return `
      <div class="architecture__flow">
        <p class="muted">Workflow could not be inferred from the source files.</p>
      </div>
    `;
  }

  const steps = workflow
    .map(
      (step) => `
        <div class="architecture__flow-step">
          <span class="pill pill--small">${step.kind === "page" ? "Page" : "Component"}</span>
          <strong>${step.title}</strong>
          <p class="muted">${step.detail}</p>
          ${step.source ? `<p class="mono">${step.source}</p>` : ""}
        </div>
      `
    )
    .join('<span class="architecture__arrow">→</span>');

  return `
    <div class="architecture__flow">
      ${steps}
    </div>
  `;
}

function renderRepositorySummary(repo, meta) {
  return `
    <section class="result-block">
      <h2>Repository overview</h2>
      <div class="card">
        <h3>${repo.fullName}</h3>
        <p class="muted">${repo.description || "No description provided."}</p>
        <div class="result-grid">
          ${renderMetric("Default branch", repo.defaultBranch)}
          ${renderMetric("Stars", numberFormat.format(repo.stars))}
          ${renderMetric("Forks", numberFormat.format(repo.forks))}
          ${renderMetric("Open issues", numberFormat.format(repo.openIssues))}
          ${renderMetric("Files scanned", numberFormat.format(meta.treeEntries))}
          ${renderMetric("Files analyzed deeply", numberFormat.format(meta.analyzedFiles))}
        </div>
      </div>
    </section>
  `;
}

function renderLanguages(languages) {
  if (!languages.length) {
    return `
      <section class="result-block">
        <h2>Languages</h2>
        <p class="muted">GitHub did not report any language statistics for this repository.</p>
      </section>
    `;
  }
  return `
    <section class="result-block">
      <h2>Language breakdown</h2>
      <div class="result-grid">
        ${languages
          .map(
            (lang) => `
          <div class="card">
            <div class="pill">${lang.language}</div>
            <p class="muted">${percentFormat.format(lang.share)}% of tracked bytes</p>
            <p class="mono">${numberFormat.format(lang.bytes)} bytes</p>
          </div>
        `
          )
          .join("")}
      </div>
    </section>
  `;
}

function renderStructure(structure) {
  const directoriesBlock = structure.directories.length
    ? `
      <div class="result-grid">
        ${structure.directories
          .map(
            (dir) => `
          <div class="card">
            <h3>${dir.name}</h3>
            <p class="muted">${numberFormat.format(dir.files)} files</p>
            ${
              dir.topExtensions.length
                ? dir.topExtensions
                    .map(
                      (ext) =>
                        `<span class="badge">${ext.extension.toUpperCase()} · ${numberFormat.format(
                          ext.count
                        )}</span>`
                    )
                    .join(" ")
                : `<span class="muted">No dominant extensions</span>`
            }
            <ul class="list mono">
              ${dir.samples.map((sample) => `<li>${sample}</li>`).join("")}
            </ul>
          </div>
        `
          )
          .join("")}
      </div>`
    : `<p class="muted">No nested directories detected in the sampled git tree.</p>`;

  return `
    <section class="result-block">
      <h2>Top-level structure</h2>
      ${directoriesBlock}
      ${
        structure.rootFiles.length
          ? `
        <div class="card" style="margin-top: 1rem;">
          <h3>Files at repository root</h3>
          <p class="mono">${structure.rootFiles.join(", ")}</p>
        </div>
      `
          : ""
      }
    </section>
  `;
}

function renderClassStats(classes) {
  return `
    <section class="result-block">
      <h2>Class definitions</h2>
      <div class="card">
        <div class="pill">Total classes detected</div>
        <p class="mono" style="font-size: 1.8rem;">${numberFormat.format(classes.total)}</p>
        ${
          classes.files.length
            ? `
          <div class="scroll-area">
            ${classes.files
              .slice(0, 20)
              .map(
                (file) => `
                <div class="annotated">
                  <strong>${file.path}</strong>
                  <div class="muted">${file.classes} classes (${file.language.toUpperCase()})</div>
                </div>
              `
              )
              .join("")}
          </div>
          <p class="muted">Only showing top 20 files.</p>
        `
            : `<p class="muted">No explicit class declarations found in scanned files.</p>`
        }
      </div>
    </section>
  `;
}

function renderExternalApis(externalApis) {
  if (!externalApis.length) {
    return `
      <section class="result-block">
        <h2>External API calls</h2>
        <p class="muted">No outbound API URLs were detected in the sampled source files.</p>
      </section>
    `;
  }
  return `
    <section class="result-block">
      <h2>External API calls</h2>
      <div class="scroll-area">
        ${externalApis
          .map(
            (call) => `
          <div class="annotated">
            <div>
              <span class="badge">${call.method}</span>
              <strong>${call.url}</strong>
              <span class="muted">(${call.host})</span>
            </div>
            <p class="muted">File: <span class="mono">${call.sourceFile}</span></p>
            <p class="muted">…${call.snippet}…</p>
          </div>
        `
          )
          .join("")}
      </div>
      <p class="muted">Based on static string analysis; manual verification recommended.</p>
    </section>
  `;
}

function renderExposedApis(exposedApis) {
  if (!exposedApis.length) {
    return `
      <section class="result-block">
        <h2>Declared server routes</h2>
        <p class="muted">No HTTP endpoints were discovered in the sampled files.</p>
      </section>
    `;
  }
  return `
    <section class="result-block">
      <h2>Declared server routes</h2>
      <div class="scroll-area">
        ${exposedApis
          .map(
            (route) => `
          <div class="annotated">
            <div>
              <span class="badge">${route.method}</span>
              <strong>${route.endpoint}</strong>
              <span class="muted">${route.framework}</span>
            </div>
            <p class="muted">File: <span class="mono">${route.sourceFile}</span></p>
            <p class="muted">…${route.snippet}…</p>
          </div>
        `
          )
          .join("")}
      </div>
      <p class="muted">Routes inferred heuristically from common framework signatures.</p>
    </section>
  `;
}

function renderMetric(label, value) {
  return `
    <div class="card">
      <p class="muted">${label}</p>
      <p class="mono" style="font-size: 1.35rem;">${value}</p>
    </div>
  `;
}

