import { analyzeRepository } from "./analyzer.js";
import { renderAnalysis } from "./renderers.js";
import { generateAnalysisPdf } from "./pdf.js";

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

  try {
    const analysis = await analyzeRepository(repoUrl, token, handleProgressEvent);
    logStatus("Analysis complete.");
    completeProgress();
    renderAnalysis(resultsBox, analysis);
    resultsBox.classList.remove("hidden");
    lastAnalysis = analysis;
    pdfButton.disabled = false;
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

