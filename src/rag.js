const TRANSFORMERS_SRC = "https://cdn.jsdelivr.net/npm/@xenova/transformers@2.14.1";
const DEFAULT_EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_TEXT_MODEL = "Xenova/phi-2";
const MAX_CHUNK_TOKENS = 260;
const MAX_FILES_FOR_INDEX = 60;

let transformersPromise;
let embeddingPipelinePromise;
let generationPipelinePromise;

export async function buildRagIndex({
  owner,
  repo,
  branch,
  token,
  sampledFiles,
  fetchFileContent
}) {
  const filesToProcess = (sampledFiles || []).slice(0, MAX_FILES_FOR_INDEX);
  const chunks = [];
  for (const file of filesToProcess) {
    try {
      const content = await fetchFileContent(owner, repo, file.path, branch, token);
      const fileChunks = chunkSourceFile(content, file.path);
      chunks.push(...fileChunks);
    } catch (error) {
      console.warn(`Unable to chunk ${file.path}`, error);
    }
  }

  const vectors = await embedChunks(chunks);
  const index = {
    key: `${owner}/${repo}@${branch}`,
    chunks,
    vectors,
    dims: vectors[0]?.length || 0
  };
  saveIndex(index);
  return index;
}

export async function loadIndex(key) {
  try {
    const payload = localStorage.getItem(`rag-index:${key}`);
    if (!payload) return null;
    const parsed = JSON.parse(payload);
    parsed.vectors = parsed.vectors.map((vector) => Float32Array.from(vector));
    return parsed;
  } catch {
    return null;
  }
}

export function saveIndex(index) {
  if (!index?.key) return;
  const serializable = {
    ...index,
    vectors: index.vectors.map((vector) => Array.from(vector))
  };
  try {
    localStorage.setItem(`rag-index:${index.key}`, JSON.stringify(serializable));
  } catch (error) {
    console.warn("Could not persist RAG index", error);
  }
}

export async function retrieveContext(question, index, topK = 4) {
  if (!index) throw new Error("No semantic index loaded.");
  const questionVector = await embedText(question);
  const scored = index.vectors
    .map((vector, idx) => ({
      score: cosineSimilarity(vector, questionVector),
      chunk: index.chunks[idx]
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
  return scored;
}

export async function generateDiagramDescription({ question, contextChunks, features }) {
  const prompt = buildDiagramPrompt(question, contextChunks, features);
  try {
    const generator = await getGenerationPipeline();
    const output = await generator(prompt, {
      max_new_tokens: 420,
      temperature: 0.2,
      top_k: 20,
      repetition_penalty: 1.05
    });
    const text = output[0]?.generated_text || "";
    return {
      prompt,
      result: sanitizeDiagramOutput(text),
      model: DEFAULT_TEXT_MODEL,
      usedLLM: true
    };
  } catch (error) {
    console.warn("Falling back to heuristic diagram", error);
    return {
      prompt,
      result: fallbackDiagram(question, contextChunks, features),
      model: "heuristic-template",
      usedLLM: false
    };
  }
}

export function describeFeatures(analysis) {
  if (!analysis?.architecture?.components) return [];
  return analysis.architecture.components.map((component) => ({
    name: component.name,
    technologies: component.technologies.slice(0, 3),
    files: component.files
  }));
}

function chunkSourceFile(content, path) {
  if (!content) return [];
  const sections = content
    .split(/\n{2,}/)
    .map((section) => section.trim())
    .filter(Boolean);
  const chunks = [];
  let buffer = "";
  sections.forEach((section) => {
    if (buffer.length + section.length < MAX_CHUNK_TOKENS) {
      buffer += `${section}\n\n`;
    } else {
      chunks.push(buffer.trim());
      buffer = `${section}\n\n`;
    }
  });
  if (buffer.trim()) {
    chunks.push(buffer.trim());
  }
  return chunks.map((text, idx) => ({
    id: `${path}::${idx}`,
    path,
    content: text
  }));
}

async function embedChunks(chunks) {
  const extractor = await getEmbeddingPipeline();
  const vectors = [];
  for (const chunk of chunks) {
    const embedding = await extractor(chunk.content, { pooling: "mean", normalize: true });
    vectors.push(toFloat32Array(embedding.data));
  }
  return vectors;
}

async function embedText(text) {
  const extractor = await getEmbeddingPipeline();
  const embedding = await extractor(text, { pooling: "mean", normalize: true });
  return toFloat32Array(embedding.data);
}

async function getEmbeddingPipeline() {
  if (!embeddingPipelinePromise) {
    const { pipeline, env } = await loadTransformers();
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    embeddingPipelinePromise = pipeline("feature-extraction", DEFAULT_EMBEDDING_MODEL);
  }
  return embeddingPipelinePromise;
}

async function getGenerationPipeline() {
  if (!generationPipelinePromise) {
    const { pipeline, env } = await loadTransformers();
    env.allowLocalModels = false;
    env.useBrowserCache = true;
    generationPipelinePromise = pipeline("text-generation", DEFAULT_TEXT_MODEL);
  }
  return generationPipelinePromise;
}

async function loadTransformers() {
  if (!transformersPromise) {
    transformersPromise = import(/* webpackIgnore: true */ TRANSFORMERS_SRC);
  }
  return transformersPromise;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) + 1e-9);
}

function toFloat32Array(data) {
  if (data instanceof Float32Array) return data;
  if (Array.isArray(data)) return Float32Array.from(data);
  return new Float32Array(data);
}

function buildDiagramPrompt(question, chunks, features) {
  const chunkText = chunks
    .map(
      (entry, idx) =>
        `Chunk ${idx + 1} (file: ${entry.chunk.path}):\n${truncate(entry.chunk.content, 900)}`
    )
    .join("\n\n");
  const featureText = features
    .map(
      (feature) =>
        `- ${feature.name}: ${feature.technologies.join(", ") || "Unknown"} (${feature.files} files)`
    )
    .join("\n");

  return `
You are an expert software architect. Using the provided repository context chunks and component features,
respond to the user's request with a Mermaid or PlantUML diagram description. Always include the diagram
code in a fenced block (mermaid preferred) and keep explanations concise.

Question: ${question}

Component summary:
${featureText}

Context chunks:
${chunkText}

Diagram:
`;
}

function sanitizeDiagramOutput(text) {
  if (!text) return "";
  const startMermaid = text.indexOf("```");
  if (startMermaid !== -1) {
    return text.slice(startMermaid).trim();
  }
  return text.trim();
}

function fallbackDiagram(question, chunks, features) {
  const steps = features.slice(0, 4).map((feature, idx) => ({
    id: `F${idx + 1}`,
    label: feature.name,
    tech: feature.technologies.join(", ") || "Mixed"
  }));
  const participants = ["participant U as User"];
  const lines = [];
  steps.forEach((step, idx) => {
    const participant = `${step.id}`;
    participants.push(`participant ${participant} as ${step.label}\\n${step.tech}`);
    if (idx === 0) {
      lines.push(`U->>${participant}: Initiate flow`);
    } else {
      const prev = steps[idx - 1].id;
      lines.push(`${prev}->>${participant}: Pass control`);
    }
  });
  if (!steps.length) {
    steps.push({ id: "F1", label: "Application", tech: "N/A" });
    participants.push(`participant F1 as Application`);
    lines.push("U->>F1: Interact");
  }

  return [
    "```mermaid",
    "sequenceDiagram",
    "    autonumber",
    ...participants.map((line) => `    ${line}`),
    ...lines.map((line) => `    ${line}`),
    "```",
    "",
    "_Generated via heuristic fallback for request:_",
    question
  ].join("\n");
}

function truncate(text, max) {
  if (!text || text.length <= max) return text;
  return `${text.slice(0, max)}…`;
}

