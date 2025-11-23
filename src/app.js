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
const diagramPanel = document.getElementById("diagram-panel");
const diagramForm = document.getElementById("diagram-form");
const diagramQuestion = document.getElementById("diagram-question");
const diagramOutput = document.getElementById("diagram-output");
const diagramClearButton = document.getElementById("clear-diagram");
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
let ragIndexKey = "";

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
  diagramPanel.classList.add("hidden");
  diagramOutput.innerHTML = `<p class="muted">Run a query to see generated Mermaid / PlantUML snippets.</p>`;
  ragIndex = null;
  ragIndexKey = "";
  lastToken = token;

  try {
    const analysis = await analyzeRepository(repoUrl, token, handleProgressEvent);
    logStatus("Analysis complete.");
    completeProgress();
    renderAnalysis(resultsBox, analysis);
    resultsBox.classList.remove("hidden");
    attachCopyHandlers(resultsBox);
    lastAnalysis = analysis;
    pdfButton.disabled = false;
    diagramPanel.classList.remove("hidden");
    diagramOutput.innerHTML = `<p class="muted">Enter a question to generate Mermaid / PlantUML diagram code.</p>`;
  } catch (error) {
    console.error(error);
    logStatus(error.message || "Unable to analyze repository.", "error");
    failProgress(error.message);
    lastAnalysis = null;
    pdfButton.disabled = true;
    diagramPanel.classList.add("hidden");
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

diagramForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!lastAnalysis) {
    logStatus("Run an analysis before requesting diagrams.", "error");
    return;
  }
  const question = diagramQuestion.value.trim();
  if (!question) return;

  try {
    const index = await ensureRagIndex();
    logStatus("Retrieving semantic chunks…");
    const context = await retrieveContext(question, index, 4);
    logStatus("Generating diagram description…");
    const features = describeFeatures(lastAnalysis);
    const generation = await generateDiagramDescription({
      question,
      contextChunks: context,
      features,
      analysisSummary: describeAnalysis(lastAnalysis)
    });
    renderDiagramOutput({ generation, context });
    logStatus("Diagram generated.");
  } catch (error) {
    console.error(error);
    logStatus(error.message || "Unable to generate diagram.", "error");
  }
});

diagramClearButton.addEventListener("click", () => {
  diagramQuestion.value = "";
  diagramOutput.innerHTML = `<p class="muted">Output cleared.</p>`;
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
  ragIndexKey = key;
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

function renderDiagramOutput({ generation, context }) {
  if (!generation) {
    diagramOutput.innerHTML = `<p class="muted">No result generated.</p>`;
    return;
  }
  const sources = context
    .map(
      (entry) =>
        `<li>${entry.chunk.path} <span class="muted">(score ${entry.score.toFixed(3)})</span></li>`
    )
    .join("");
  const copyId = `diagram-${Date.now()}`;
  diagramOutput.innerHTML = `
    <div class="diagram-output__section">
      <p class="muted">Model: ${generation.model} · ${
        generation.usedLLM ? "LLM" : "Heuristic fallback"
      }</p>
      <pre class="diagram-output__code" id="${copyId}">${escapeHtml(generation.result)}</pre>
      <button class="button button--secondary button--compact copy-button" data-copy-target="${copyId}">
        Copy diagram code
      </button>
      <div class="diagram-output__sources">
        <strong>Sources</strong>
        <ul>${sources}</ul>
      </div>
    </div>
  `;
  attachCopyHandlers(diagramOutput);
}

function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

