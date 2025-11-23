const API_ROOT = "https://api.github.com";
const SUPPORTED_CODE_EXTENSIONS = new Set([
  "js",
  "jsx",
  "ts",
  "tsx",
  "mjs",
  "cjs",
  "py",
  "java",
  "kt",
  "kts",
  "cs",
  "php",
  "rb",
  "go",
  "swift",
  "scala"
]);
const MAX_TREE_ITEMS = 20_000;
const MAX_FILES_FOR_ANALYSIS = 120;
const MAX_FILE_SIZE_BYTES = 200_000;
const FETCH_CONCURRENCY = 4;

const httpMethodRegex = /(get|post|put|delete|patch|options|head)/i;
const EXTENSION_TECH_MAP = {
  tsx: "React/TSX",
  ts: "TypeScript",
  js: "JavaScript",
  jsx: "React/JSX",
  css: "CSS",
  scss: "Sass",
  html: "HTML",
  md: "Markdown",
  json: "JSON",
  sql: "SQL",
  py: "Python",
  rb: "Ruby",
  go: "Go",
  java: "Java",
  kt: "Kotlin",
  cs: "C#",
  php: "PHP",
  sh: "Shell",
  yml: "YAML",
  yaml: "YAML",
  dockerfile: "Docker",
  toml: "TOML",
  ico: "Assets",
  svg: "SVG",
  txt: "Text",
  plpgsql: "PL/pgSQL"
};

export async function analyzeRepository(input, token, onProgress = () => {}) {
  const { owner, repo } = parseRepoInput(input);
  onProgress(`Repository detected: ${owner}/${repo}`);

  const [repoInfo, languages] = await Promise.all([
    fetchGitHubJson(`/repos/${owner}/${repo}`, token),
    fetchGitHubJson(`/repos/${owner}/${repo}/languages`, token)
  ]);

  const defaultBranch = repoInfo.default_branch;
  onProgress(`Default branch: ${defaultBranch}`);

  const tree = await fetchRepositoryTree(owner, repo, defaultBranch, token);
  onProgress(`Scanned ${tree.length.toLocaleString()} files from git tree`);

  const structure = summarizeStructure(tree);
  const formattedLanguages = formatLanguages(languages);
  const candidateFiles = selectFilesForAnalysis(tree);
  onProgress(`Inspecting ${candidateFiles.length} source files for classes and API usage...`);

  const codeStats = await inspectCodeFiles({
    owner,
    repo,
    branch: defaultBranch,
    files: candidateFiles,
    token,
    onProgress
  });

  return {
    repo: {
      owner,
      name: repoInfo.name,
      fullName: repoInfo.full_name,
      description: repoInfo.description,
      homepage: repoInfo.homepage,
      stars: repoInfo.stargazers_count,
      forks: repoInfo.forks_count,
      watchers: repoInfo.subscribers_count,
      openIssues: repoInfo.open_issues_count,
      defaultBranch
    },
    languages: formattedLanguages,
    structure,
    architecture: buildArchitecture(structure, formattedLanguages, repoInfo.full_name, tree),
    classes: {
      total: codeStats.totalClasses,
      files: codeStats.classDetails
    },
    externalApis: codeStats.externalApis,
    exposedApis: codeStats.exposedApis,
    meta: {
      analyzedFiles: candidateFiles.length,
      treeEntries: tree.length,
      generatedAt: new Date().toISOString()
    }
  };
}

function parseRepoInput(value) {
  if (!value || typeof value !== "string") throw new Error("Enter a GitHub repository URL or slug.");
  const trimmed = value.trim();

  const slugMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/);
  if (slugMatch) {
    return { owner: slugMatch[1], repo: slugMatch[2] };
  }

  let url;
  try {
    url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
  } catch {
    throw new Error("Invalid GitHub URL.");
  }

  if (!url.hostname.endsWith("github.com")) throw new Error("URL must point to github.com");

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length < 2) throw new Error("URL must include both owner and repository name.");
  return { owner: segments[0], repo: segments[1].replace(/\.git$/, "") };
}

async function fetchRepositoryTree(owner, repo, branch, token) {
  const tree = await fetchGitHubJson(
    `/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
    token
  );
  if (!tree.tree) throw new Error("Could not read repository tree.");
  if (tree.truncated) {
    console.warn("Git tree truncated by GitHub API; analysis may be partial.");
  }
  const entries = tree.tree.slice(0, MAX_TREE_ITEMS).filter((item) => item.type === "blob");
  return entries;
}

async function inspectCodeFiles({ owner, repo, branch, files, token, onProgress }) {
  const work = [...files];
  const classDetails = [];
  const externalApisMap = new Map();
  const exposedApisMap = new Map();
  let totalClasses = 0;

  const workers = Array.from({ length: FETCH_CONCURRENCY }, async () => {
    while (work.length) {
      const file = work.shift();
      if (!file) break;
      onProgress(`→ ${file.path}`);

      try {
        const content = await fetchFileContent(owner, repo, file.path, branch, token);
        const classes = countClasses(content, file.extension);
        if (classes > 0) {
          totalClasses += classes;
          classDetails.push({
            path: file.path,
            classes,
            language: file.extension
          });
        }

        const externalCalls = detectExternalApis(content).map((entry) => ({
          ...entry,
          sourceFile: file.path
        }));
        for (const call of externalCalls) {
          const key = `${call.method}_${call.url}_${call.sourceFile}`;
          if (!externalApisMap.has(key)) externalApisMap.set(key, call);
        }

        const exposed = detectExposedApis(content).map((entry) => ({
          ...entry,
          sourceFile: file.path
        }));
        for (const route of exposed) {
          const key = `${route.method}_${route.endpoint}_${route.framework}_${route.sourceFile}`;
          if (!exposedApisMap.has(key)) exposedApisMap.set(key, route);
        }
      } catch (error) {
        console.warn(`Could not scan ${file.path}:`, error.message);
      }
    }
  });

  await Promise.all(workers);

  classDetails.sort((a, b) => b.classes - a.classes);

  return {
    totalClasses,
    classDetails,
    externalApis: Array.from(externalApisMap.values()).sort(sortEndpoints),
    exposedApis: Array.from(exposedApisMap.values()).sort(sortEndpoints)
  };
}

function selectFilesForAnalysis(tree) {
  const prioritized = tree
    .filter((item) => SUPPORTED_CODE_EXTENSIONS.has(getExtension(item.path)))
    .filter((item) => item.size <= MAX_FILE_SIZE_BYTES)
    .map((item) => ({
      path: item.path,
      size: item.size ?? MAX_FILE_SIZE_BYTES,
      extension: getExtension(item.path)
    }))
    .sort((a, b) => a.size - b.size);

  return prioritized.slice(0, MAX_FILES_FOR_ANALYSIS);
}

function summarizeStructure(tree) {
  const directories = new Map();
  const rootFiles = [];

  for (const entry of tree) {
    const parts = entry.path.split("/");
    if (parts.length === 1) {
      rootFiles.push(parts[0]);
      continue;
    }

    const top = parts[0];
    if (!directories.has(top)) {
      directories.set(top, {
        name: top,
        files: 0,
        samples: new Set(),
        extensions: new Map()
      });
    }

    const dirInfo = directories.get(top);
    dirInfo.files += 1;
    if (dirInfo.samples.size < 5) {
      dirInfo.samples.add(parts.slice(1).join("/"));
    }
    const ext = getExtension(entry.path) || "other";
    dirInfo.extensions.set(ext, (dirInfo.extensions.get(ext) ?? 0) + 1);
  }

  return {
    directories: Array.from(directories.values())
      .map((dir) => ({
        name: dir.name,
        files: dir.files,
        samples: Array.from(dir.samples),
        topExtensions: Array.from(dir.extensions.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([extension, count]) => ({ extension, count }))
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    rootFiles: rootFiles.sort((a, b) => a.localeCompare(b))
  };
}

function buildArchitecture(structure, languages = [], repoName, tree = []) {
  const components = structure.directories
    .slice()
    .sort((a, b) => b.files - a.files)
    .slice(0, 6)
    .map((dir) => ({
      name: dir.name,
      files: dir.files,
      technologies: dir.topExtensions.map((item) => mapExtensionToTech(item.extension)),
      samples: dir.samples.slice(0, 2),
      type: inferComponentType(dir.name)
    }));

  const flow = buildWorkflow(components, extractPageWorkflow(tree));

  return {
    repo: {
      name: repoName,
      languages: (languages || []).slice(0, 4).map((lang) => lang.language)
    },
    components,
    workflow: flow
  };
}

function inferComponentType(name = "") {
  const normalized = name.toLowerCase();
  if (/(src|app|client|web|frontend|ui)/.test(normalized)) return "ui";
  if (/(backend|server|api|functions|services)/.test(normalized)) return "api";
  if (/(database|db|migrations|schema|models)/.test(normalized)) return "data";
  if (/(docs|documentation|wiki)/.test(normalized)) return "docs";
  if (/(public|assets|static)/.test(normalized)) return "assets";
  if (/(supabase|infra|deploy|config)/.test(normalized)) return "infra";
  return "misc";
}

function buildWorkflow(components = [], pages = []) {
  const workflow = [];
  pages.forEach((page) => {
    workflow.push({
      kind: "page",
      title: page.title,
      detail: page.route,
      source: page.file
    });
  });

  const addComponentToFlow = (type, label) => {
    const component = components.find((entry) => entry.type === type);
    if (!component) return;
    workflow.push({
      kind: "component",
      title: label || component.name,
      detail: component.technologies.slice(0, 3).join(", ") || "Mixed stack"
    });
  };

  addComponentToFlow("api", "API / Services");
  addComponentToFlow("infra", "Edge & config");
  addComponentToFlow("data", "Database & migrations");

  if (!workflow.length && components.length) {
    workflow.push({
      kind: "component",
      title: components[0].name,
      detail: components[0].technologies.slice(0, 3).join(", ")
    });
  }

  return workflow.slice(0, 8);
}

function extractPageWorkflow(tree = []) {
  const supported = new Set(["tsx", "jsx", "ts", "js"]);
  const directories = /(src\/(?:pages|screens|routes|views|app)\/)(.+)/i;
  const seen = new Set();
  const pages = [];

  for (const entry of tree) {
    if (!entry?.path) continue;
    const ext = getExtension(entry.path);
    if (!supported.has(ext)) continue;
    const match = entry.path.match(directories);
    if (!match) continue;
    const relative = match[2].replace(/\.[^.]+$/, "");
    const cleanRoute = `/${relative.replace(/index$/i, "").replace(/\\/g, "/")}`
      .replace(/\/+/g, "/")
      .replace(/\/$/, "") || "/";
    const title = toTitleCase(relative.split("/").pop()?.replace(/[-_]/g, " ") || "Page");
    const key = `${title}-${cleanRoute}`;
    if (seen.has(key)) continue;
    seen.add(key);
    pages.push({
      title,
      route: cleanRoute || "/",
      file: entry.path
    });
  }

  if (!pages.length) {
    const appFile = tree.find((entry) => /src\/App\.(tsx|ts|jsx|js)$/i.test(entry.path || ""));
    if (appFile) {
      pages.push({
        title: "App Shell",
        route: "/",
        file: appFile.path
      });
    }
  }

  return pages.slice(0, 5);
}

function toTitleCase(value = "") {
  return value
    .split(/[\s-_]+/)
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function mapExtensionToTech(extension) {
  if (!extension) return "Other";
  const normalized = extension.toLowerCase();
  return EXTENSION_TECH_MAP[normalized] || normalized.toUpperCase();
}

function formatLanguages(languages) {
  const total = Object.values(languages).reduce((sum, bytes) => sum + bytes, 0);
  return Object.entries(languages)
    .map(([language, bytes]) => ({
      language,
      bytes,
      share: total ? (bytes / total) * 100 : 0
    }))
    .sort((a, b) => b.bytes - a.bytes);
}

function sortEndpoints(a, b) {
  if (a.host && b.host && a.host !== b.host) return a.host.localeCompare(b.host);
  const left = a.url || a.endpoint || "";
  const right = b.url || b.endpoint || "";
  if (left !== right) return left.localeCompare(right);
  return (a.method || "").localeCompare(b.method || "");
}

async function fetchGitHubJson(path, token) {
  const headers = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${API_ROOT}${path}`, { headers });
  if (!response.ok) {
    const payload = await safeJson(response);
    const message = payload?.message || response.statusText;
    if (response.status === 403 && response.headers.get("x-ratelimit-remaining") === "0") {
      throw new Error("GitHub rate limit exceeded. Provide a personal access token to continue.");
    }
    if (response.status === 404) {
      throw new Error(
        "Repository or resource not found. Double-check the owner/repo slug and ensure the token has access if the repo is private."
      );
    }
    if (response.status === 401) {
      throw new Error("GitHub rejected the token. Verify it is valid and has the required scopes.");
    }
    throw new Error(`GitHub API error (${response.status}): ${message}`);
  }
  return response.json();
}

async function fetchFileContent(owner, repo, path, ref, token) {
  const encodedPath = path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const payload = await fetchGitHubJson(
    `/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    token
  );
  if (!payload.content) throw new Error("Missing file contents.");
  return decodeBase64(payload.content);
}

function decodeBase64(base64) {
  const clean = base64.replace(/\n/g, "");
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function getExtension(path) {
  const segments = path.split(".");
  return segments.length > 1 ? segments.pop()?.toLowerCase() ?? "" : "";
}

function countClasses(content, extension) {
  if (!content) return 0;
  let regex = /\bclass\s+[A-Za-z0-9_]+/g;
  if (extension === "go") {
    regex = /\b(type)\s+[A-Za-z0-9_]+\s+struct\b/g;
  }
  if (extension === "rb") {
    regex = /\bclass\s+[A-Za-z0-9_:]+/g;
  }
  if (extension === "py") {
    regex = /\bclass\s+[A-Za-z0-9_]+/g;
  }
  const matches = content.match(regex);
  return matches ? matches.length : 0;
}

function detectExternalApis(content) {
  if (!content) return [];
  const urls = new Set();
  const discoveries = [];
  const urlRegex = /https?:\/\/[^\s"'`)+}]+/gi;
  let urlMatch;
  while ((urlMatch = urlRegex.exec(content)) !== null) {
    const url = urlMatch[0].replace(/[),;]+$/, "");
    try {
      const parsed = new URL(url);
      // Skip GitHub itself to avoid noise
      if (parsed.hostname.includes("github.com")) continue;
      const snippet = buildSnippet(content, urlMatch.index);
      const method = inferHttpMethod(content, urlMatch.index);
      const key = `${method}_${parsed.origin}${parsed.pathname}`;
      if (urls.has(key)) continue;
      urls.add(key);
      discoveries.push({
        method,
        url: `${parsed.origin}${parsed.pathname}`,
        host: parsed.hostname,
        snippet
      });
    } catch {
      continue;
    }
  }
  return discoveries;
}

function detectExposedApis(content) {
  if (!content) return [];
  const results = [];
  const expressPattern =
    /(app|router)\.(get|post|put|delete|patch|options|head)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const decoratorPattern =
    /@(app|router)\.(get|post|put|delete|patch|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  const flaskPattern =
    /@app\.route\(\s*['"`]([^'"`]+)['"`](?:\s*,\s*methods\s*=\s*\[([^\]]+)\])?/gi;
  const djangoPattern = /(path|re_path)\(\s*['"`]([^'"`]+)['"`]/gi;

  collectEndpoint(expressPattern, content, results, (match) => ({
    framework: "express/fastify",
    method: match[2].toUpperCase(),
    endpoint: match[3],
    snippet: buildSnippet(content, match.index)
  }));

  collectEndpoint(decoratorPattern, content, results, (match) => ({
    framework: "python router",
    method: match[2].toUpperCase(),
    endpoint: match[3],
    snippet: buildSnippet(content, match.index)
  }));

  collectEndpoint(flaskPattern, content, results, (match) => ({
    framework: "flask",
    method: normalizeFlaskMethods(match[2]),
    endpoint: match[1],
    snippet: buildSnippet(content, match.index)
  }));

  collectEndpoint(djangoPattern, content, results, (match) => ({
    framework: "django",
    method: "VIEW",
    endpoint: match[2],
    snippet: buildSnippet(content, match.index)
  }));

  return dedupeRoutes(results);
}

function collectEndpoint(regex, content, target, mapper) {
  let match;
  while ((match = regex.exec(content)) !== null) {
    target.push(mapper(match));
  }
}

function dedupeRoutes(routes) {
  const map = new Map();
  for (const route of routes) {
    const key = `${route.method}_${route.endpoint}_${route.framework}`;
    if (!map.has(key)) map.set(key, route);
  }
  return Array.from(map.values());
}

function normalizeFlaskMethods(methodSection) {
  if (!methodSection) return "GET";
  const match = methodSection.match(/['"`](get|post|put|delete|patch|options)['"`]/i);
  return match ? match[1].toUpperCase() : "GET";
}

function inferHttpMethod(content, index) {
  const start = Math.max(0, index - 80);
  const windowText = content.slice(start, index).toLowerCase();
  const methodMatch = windowText.match(httpMethodRegex);
  return methodMatch ? methodMatch[1].toUpperCase() : "GET";
}

function buildSnippet(content, index) {
  const start = Math.max(0, index - 60);
  const end = Math.min(content.length, index + 160);
  return content
    .slice(start, end)
    .replace(/\s+/g, " ")
    .trim();
}

async function safeJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

