import { analyzeRepository, fetchFileContent } from "./analyzer.js";
import { renderAnalysis } from "./renderers.js";
import { generateAnalysisPdf } from "./pdf.js";
import {
  buildRagIndex,
  loadIndex,
  retrieveContext,
  generateDiagramDescription,
  describeFeatures,
  describeAnalysis
} from "./rag.js";

const form = document.getElementById("repo-form");
const statusPanel = document.getElementById("status-panel");
const statusBody = document.getElementById("status-log");
const toggleLogButton = document.getElementById("toggle-log");
const resultsBox = document.getElementById("results");
const submitButton = form.querySelector("button[type='submit']");
const pdfButton = document.getElementById("export-pdf");
const progressPanel = document.getElementById("progress");
const progressValue = document.getElementById("progress-value");
const progressLabel = document.getElementById("progress-label");
let lastAnalysis = null;
let isLogMinimized = true;
let totalFilesForProgress = 0;
let inspectedFiles = 0;
let currentProgressValue = 0;
let lastToken = "";
let ragIndex = null;

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = form.elements["repo-url"].value.trim();
  const token = form.elements["token"].value.trim();

  if (!repoUrl) return;

  resetStatus();
  resetProgress();
  logStatus("Starting analysis…");
  resultsBox.classList.add("hidden");
  resultsBox.innerHTML = "";
  submitButton.disabled = true;
  submitButton.textContent = "Analyzing…";
  pdfButton.disabled = true;
  ragIndex = null;
  lastToken = token;
  removeAutoDiagramSection();

  try {
    const analysis = await analyzeRepository(repoUrl, token, handleProgressEvent);
    logStatus("Analysis complete.");
    completeProgress();
    renderAnalysis(resultsBox, analysis);
    resultsBox.classList.remove("hidden");
    attachCopyHandlers(resultsBox);
    lastAnalysis = analysis;
    pdfButton.disabled = false;
    await generatePresetDiagrams(analysis);
  } catch (error) {
    console.error(error);
    logStatus(error.message || "Unable to analyze repository.", "error");
    failProgress(error.message);
    lastAnalysis = null;
    pdfButton.disabled = true;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Analyze repository";
  }
});

pdfButton.addEventListener("click", async () => {
  if (!lastAnalysis) return;
  const previousLabel = pdfButton.textContent;
  pdfButton.disabled = true;
  pdfButton.textContent = "Generating PDF…";
  try {
    await generateAnalysisPdf(lastAnalysis);
    logStatus("PDF downloaded.");
  } catch (error) {
    console.error(error);
    logStatus(error.message || "Unable to generate PDF.", "error");
  } finally {
    pdfButton.textContent = previousLabel;
    pdfButton.disabled = !lastAnalysis;
  }
});

toggleLogButton.addEventListener("click", () => {
  isLogMinimized = !isLogMinimized;
  statusBody.classList.toggle("status__body--minimized", isLogMinimized);
  toggleLogButton.textContent = isLogMinimized ? "Expand" : "Minimize";
  statusBody.scrollTop = statusBody.scrollHeight;
});

function handleProgressEvent(message) {
  logStatus(message);
  updateProgressFromMessage(message);
}

function logStatus(message, level = "info") {
  statusPanel.classList.remove("hidden");
  const paragraph = document.createElement("p");
  paragraph.className = "status__log";
  if (level === "error") paragraph.classList.add("status__log--error");
  paragraph.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  statusBody.appendChild(paragraph);
  statusBody.scrollTop = statusBody.scrollHeight;
}

function resetStatus() {
  statusPanel.classList.remove("hidden");
  statusBody.innerHTML = "";
  statusBody.classList.toggle("status__body--minimized", isLogMinimized);
  toggleLogButton.textContent = isLogMinimized ? "Expand" : "Minimize";
}

function resetProgress() {
  totalFilesForProgress = 0;
  inspectedFiles = 0;
  progressPanel.classList.remove("hidden");
  setProgress(0, "Initializing…");
}

function setProgress(value, label) {
  const clamped = Math.max(0, Math.min(1, value));
  currentProgressValue = clamped;
  progressValue.style.width = `${clamped * 100}%`;
  progressLabel.textContent = label;
}

function completeProgress() {
  setProgress(1, "Analysis complete");
  setTimeout(() => {
    progressPanel.classList.add("hidden");
  }, 1500);
}

function failProgress(message) {
  progressPanel.classList.remove("hidden");
  setProgress(currentProgressValue, message || "Stopped");
}

function updateProgressFromMessage(message) {
  if (message.startsWith("Repository detected")) {
    setProgress(0.15, "Resolving repository…");
  } else if (message.startsWith("Default branch")) {
    setProgress(0.3, "Fetching metadata…");
  } else if (message.startsWith("Scanned")) {
    setProgress(0.55, "Summarizing structure…");
  } else if (message.startsWith("Inspecting")) {
    const match = message.match(/Inspecting (\d+)/);
    totalFilesForProgress = match ? Number(match[1]) : 0;
    inspectedFiles = 0;
    setProgress(0.6, `Inspecting 0/${totalFilesForProgress || "?"}`);
  } else if (message.startsWith("→")) {
    inspectedFiles += 1;
    const proportion = totalFilesForProgress
      ? inspectedFiles / totalFilesForProgress
      : inspectedFiles * 0.01;
    const value = 0.6 + Math.min(proportion, 1) * 0.35;
    setProgress(value, `Inspecting ${Math.min(inspectedFiles, totalFilesForProgress || inspectedFiles)}/${totalFilesForProgress || "?"}`);
  }
}

function attachCopyHandlers(container) {
  const buttons = container.querySelectorAll(".copy-button[data-copy-target]");
  buttons.forEach((button) => {
    button.addEventListener("click", async () => {
      const targetId = button.getAttribute("data-copy-target");
      const target = container.querySelector(`#${targetId}`);
      if (!target) return;
      try {
        const value = "value" in target ? target.value : target.textContent;
        await navigator.clipboard.writeText(value || "");
        logStatus(`Copied Mermaid snippet (${targetId}).`);
      } catch (error) {
        console.error(error);
        logStatus("Unable to copy to clipboard.", "error");
      }
    });
  });
}

async function ensureRagIndex() {
  const owner = lastAnalysis?.repo?.owner;
  const repo = lastAnalysis?.repo?.name;
  const branch = lastAnalysis?.repo?.defaultBranch;
  if (!owner || !repo || !branch) throw new Error("Missing repository metadata.");
  const key = `${owner}/${repo}@${branch}`;
  if (ragIndex && ragIndex.key === key) return ragIndex;

  ragIndex = await loadIndex(key);
  if (ragIndex) {
    logStatus("Loaded cached semantic index.");
    return ragIndex;
  }

  logStatus("Building semantic chunks & embeddings (first run may take a while)...");
  ragIndex = await buildRagIndex({
    owner,
    repo,
    branch,
    token: lastToken,
    sampledFiles: lastAnalysis.sampledFiles || [],
    fetchFileContent
  });
  logStatus("Semantic index stored locally.");
  return ragIndex;
}

function escapeHtml(text) {
  return (text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function generatePresetDiagrams(analysis) {
  removeAutoDiagramSection();
  if (!analysis) return;
  try {
    const index = await ensureRagIndex();
    const features = describeFeatures(analysis);
    const summary = describeAnalysis(analysis);
    const queries = buildDiagramQueries(analysis);
    if (!queries.length) {
      logStatus("No diagram queries generated.");
      return;
    }
    const outputs = [];
    for (const query of queries) {
      logStatus(`Generating: ${query.label}`);
      const context = await retrieveContext(query.question, index, 4);
      const generation = await generateDiagramDescription({
        question: query.question,
        contextChunks: context,
        features,
        analysisSummary: summary
      });
      outputs.push({ ...query, generation, context });
    }
    renderAutoDiagramSection(outputs);
  } catch (error) {
    console.error(error);
    logStatus(error.message || "Unable to generate automated diagrams.", "error");
  }
}

function renderAutoDiagramSection(diagrams) {
  if (!diagrams.length) return;
  const section = document.createElement("section");
  section.className = "result-block";
  section.id = "auto-diagram-section";
  section.innerHTML = `
    <h2>AI-generated diagrams</h2>
    <p class="muted">Generated automatically via the semantic index: architecture overview and primary sequence flow.</p>
    ${diagrams
      .map((diagram) => {
        const copyId = `${diagram.id}-diagram-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const sources = diagram.context
          .map(
            (entry) =>
              `<li>${entry.chunk.path} <span class="muted">(score ${entry.score.toFixed(3)})</span></li>`
          )
          .join("");
        return `
          <div class="diagram-block">
            <div class="diagram-block__header">
              <strong>${diagram.label}</strong>
              <button class="button button--secondary button--compact copy-button" data-copy-target="${copyId}">
                Copy code
              </button>
            </div>
            <textarea id="${copyId}" class="code-block" rows="12" readonly>${escapeHtml(
              diagram.generation.result
            )}</textarea>
            <p class="muted">Model: ${diagram.generation.model} · ${
          diagram.generation.usedLLM ? "LLM" : "Heuristic fallback"
        }</p>
            <div class="diagram-sources">
              <strong>Sources</strong>
              <ul>${sources}</ul>
            </div>
          </div>
        `;
      })
      .join("")}
  `;
  resultsBox.appendChild(section);
  attachCopyHandlers(section);
}

function removeAutoDiagramSection() {
  const existing = document.getElementById("auto-diagram-section");
  if (existing) existing.remove();
}

function buildDiagramQueries(analysis) {
  if (!analysis) return [];
  const repoName = analysis.repo?.fullName || `${analysis.repo?.owner}/${analysis.repo?.name}` || "this repository";
  const languageSummary =
    analysis.languages?.slice(0, 5).map((lang) => lang.language).join(", ") || "mixed stack";

  const queries = [
    {
      id: "architecture",
      label: "Architecture Overview Diagram",
      question: `Generate an architecture overview Mermaid diagram for ${repoName}. Highlight the main building blocks (front-end, back-end services, infra, data stores) along with their dominant technologies and languages (${languageSummary}). Show external APIs and data flows between components. Use a graph/flow structure (graph TD) with descriptive labels.`
    }
  ];

  const scenarios = buildSequenceScenarios(analysis.architecture?.workflow);
  if (scenarios.length) {
    scenarios.forEach((scenario, index) => {
      const pathDescription = scenario.steps
        .map((step) => `${step.title} (${step.kind}: ${step.detail})`)
        .join(" -> ");
      queries.push({
        id: `sequence-${index}`,
        label: scenario.label,
        question: `Generate a detailed Mermaid sequence diagram for the user flow "${scenario.label}". The flow goes through: ${pathDescription}. Include the User actor, UI/page components, backend/services, and data stores referenced in the analysis. Show request/response interactions in order.`
      });
    });
  } else {
    queries.push({
      id: "sequence-0",
      label: "Primary User Flow Sequence",
      question: `Generate a Mermaid sequence diagram showing the primary user access flow across the application (login/UI -> backend/API -> database/external services) for ${repoName}.`
    });
  }
  return queries;
}

function buildSequenceScenarios(workflow = []) {
  if (!workflow || !workflow.length) return [];
  const scenarios = [];
  let current = [];

  workflow.forEach((step) => {
    if (step.kind === "page") {
      if (current.length) {
        scenarios.push(current);
      }
      current = [step];
    } else {
      current.push(step);
    }
  });

  if (current.length) scenarios.push(current);

  return scenarios.map((steps, idx) => {
    const page = steps.find((step) => step.kind === "page");
    const label = page ? `${page.title} Flow` : `Flow ${idx + 1}`;
    return { label, steps };
  });
}

