import { analyzeRepository } from "./analyzer.js";
import { renderAnalysis } from "./renderers.js";

const form = document.getElementById("repo-form");
const statusBox = document.getElementById("status");
const resultsBox = document.getElementById("results");
const submitButton = form.querySelector("button[type='submit']");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const repoUrl = form.elements["repo-url"].value.trim();
  const token = form.elements["token"].value.trim();

  if (!repoUrl) return;

  resetStatus();
  logStatus("Starting analysis…");
  resultsBox.classList.add("hidden");
  resultsBox.innerHTML = "";
  submitButton.disabled = true;
  submitButton.textContent = "Analyzing…";

  try {
    const analysis = await analyzeRepository(repoUrl, token, logStatus);
    logStatus("Analysis complete.");
    renderAnalysis(resultsBox, analysis);
  } catch (error) {
    console.error(error);
    logStatus(error.message || "Unable to analyze repository.", "error");
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = "Analyze repository";
  }
});

function logStatus(message, level = "info") {
  statusBox.classList.remove("hidden");
  const paragraph = document.createElement("p");
  paragraph.className = "status__log";
  if (level === "error") paragraph.classList.add("status__log--error");
  paragraph.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  statusBox.appendChild(paragraph);
  statusBox.scrollTop = statusBox.scrollHeight;
}

function resetStatus() {
  statusBox.classList.remove("hidden");
  statusBox.innerHTML = "";
}

