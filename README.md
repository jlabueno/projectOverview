# GitHub Project Analyzer

Inspect any public GitHub repository from the browser without extra infrastructure. Paste a repository URL (or `owner/repo` slug) and the page will call the GitHub REST API directly to summarize languages, class declarations, folder structure, external API calls, and exposed HTTP routes.

## Features

- **Language mix** – mirrors GitHub's `/languages` endpoint and shows share per language.
- **Class counter** – fetches a representative sample of source files (up to 120, <200 KB each) and counts class-like constructs per file.
- **Structure map** – highlights top-level directories, top extensions, and root files.
- **Architecture & workflow diagram** – highlights key building blocks, dominant stacks, and inferred user/page flow.
- **Draw.io-ready Mermaid exports** – copy/pasteable snippets to recreate architecture and sequence diagrams directly in draw.io (Arrange → Insert → Mermaid).
- **RAG-powered diagram assistant** – chunk repositories, build local embeddings/indices, retrieve relevant context, and use a local LLM to author Mermaid/PlantUML snippets on demand.
- **Outbound APIs** – scans sampled files for hard-coded `http(s)` URLs plus their surrounding snippets.
- **Exposed endpoints** – heuristically detects common route declarations (Express, FastAPI, Flask, Django, etc.).
- **Progress log** – live status panel detailing each step and any API/rate-limit issues.
- **One-click PDF report** – export the current analysis snapshot as a portable summary.

## Getting started

```bash
cd /Users/jlabueno/projectOverview
npm run dev
```

This uses Python's built-in HTTP server to host the static files at `http://localhost:5173`. Any static server will work; you can also run `python3 -m http.server 5173` directly.

## Docker & Compose

```bash
cd /Users/jlabueno/projectOverview
docker compose up --build
```

The Compose stack builds the `nginx:alpine`-based image defined in `Dockerfile` and serves the site at `http://localhost:4173`. Hot reload is not enabled in this container; rebuild when you change source files.

## Using the analyzer

1. Open `http://localhost:5173` in your browser.
2. Enter a GitHub URL (`https://github.com/org/project`) or `owner/repo` slug.
3. (Optional) Provide a personal access token if you expect to exceed unauthenticated rate limits or need access to private repos. Tokens stay in the browser.
4. Click **Analyze repository** and watch the progress log for each API call.
5. (Optional) After results render, click **Download PDF summary**. The app silently prepares a print-ready version of the existing layout and triggers your browser’s “Save as PDF” dialog—no pop-up windows required.

## Diagram assistant (chunk → embed → retrieve → generate)

1. Run an analysis; the **Diagram assistant** panel appears below the results.
2. Enter a request such as “Generate a sequence diagram for user login” and submit.
   - On the first run per repo the app performs:
     - **Chunking:** downloads the sampled files (up to 60) and splits them into semantic blocks (functions/classes/doc sections).
     - **Embedding & Index:** loads the open-source `Xenova/all-MiniLM-L6-v2` embedding model (via `@xenova/transformers`), generates vectors locally, and persists them in browser storage as a lightweight vector DB.
3. For every question it then executes:
   - **Retrieval:** embeds the query, finds the top-k relevant chunks, and notes other discovered components/features.
   - **LLM generation:** feeds the retrieved context into a local `Xenova/phi-2` text-generation pipeline to produce Mermaid (preferred) or PlantUML code. If the LLM cannot load, a heuristic fallback outputs a best-effort sequence diagram.
4. Copy the generated snippet and paste it into draw.io using **Arrange → Insert → Mermaid**, following the [draw.io “diagrams from code” workflow](https://www.drawio.com/blog/diagrams-from-code).

> **Tip:** The first embedding/LLM download can take a minute and uses your device’s CPU/GPU. Subsequent runs reuse the cached models and stored index.

## Implementation notes

- Pure front-end app (vanilla JS modules). No build step or server code required.
- Uses the GitHub REST API: `/repos`, `/languages`, `/git/trees`, and `/contents`.
- Limits deep inspections to a manageable subset to reduce API churn and latency.
- Class detection looks for `class`, `struct`, and similar keywords; it's heuristic.
- External/exposed API detection relies on regexes for popular frameworks and may produce false positives/negatives—treat results as leads, not guarantees.
- If the GitHub tree endpoint truncates very large repos, the UI warns that the snapshot is partial.

## Future ideas

- Add offline caching or worker-based concurrency controls.
- Enrich endpoint detection with AST parsing per language.
- Support downloadable JSON reports for CI or governance workflows.

