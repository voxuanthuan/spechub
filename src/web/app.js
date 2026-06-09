const state = {
  docs: [],
  selectedId: null,
  repo: "all",
  query: "",
  kind: "all",
  date: "all",
  path: "",
  sidebarCollapsed: localStorage.getItem("spechub:sidebar-collapsed") === "true"
};

const elements = {
  shell: document.querySelector(".shell"),
  toggleSidebar: document.querySelector("#toggle-sidebar"),
  repoList: document.querySelector("#repo-list"),
  allCount: document.querySelector("#all-count"),
  docList: document.querySelector("#doc-list"),
  resultSummary: document.querySelector("#result-summary"),
  search: document.querySelector("#search"),
  kindFilter: document.querySelector("#kind-filter"),
  dateFilter: document.querySelector("#date-filter"),
  pathFilter: document.querySelector("#path-filter"),
  refresh: document.querySelector("#refresh"),
  preview: document.querySelector("#preview"),
  previewKicker: document.querySelector("#preview-kicker"),
  previewTitle: document.querySelector("#preview-title"),
  previewPath: document.querySelector("#preview-path"),
  copyPath: document.querySelector("#copy-path"),
  openFolder: document.querySelector("#open-folder"),
  openSource: document.querySelector("#open-source"),
  openRaw: document.querySelector("#open-raw")
};

await loadDocs();
wireControls();
applySidebarState();

function wireControls() {
  elements.toggleSidebar.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    localStorage.setItem("spechub:sidebar-collapsed", String(state.sidebarCollapsed));
    applySidebarState();
  });
  elements.search.addEventListener("input", () => {
    state.query = elements.search.value.trim().toLowerCase();
    render();
  });
  elements.kindFilter.addEventListener("change", () => {
    state.kind = elements.kindFilter.value;
    render();
  });
  elements.dateFilter.addEventListener("change", () => {
    state.date = elements.dateFilter.value;
    render();
  });
  elements.pathFilter.addEventListener("input", () => {
    state.path = elements.pathFilter.value.trim().toLowerCase();
    render();
  });
  elements.refresh.addEventListener("click", loadDocs);
  elements.copyPath.addEventListener("click", copySelectedPath);
  elements.openFolder.addEventListener("click", () => openSelected("open-folder"));
  elements.openSource.addEventListener("click", () => openSelected("open-source"));
}

async function loadDocs() {
  setSummary("Indexing local files...");
  const response = await fetch("/api/docs");
  const payload = await response.json();
  state.docs = payload.docs ?? [];
  if (!state.selectedId || !state.docs.some((doc) => doc.id === state.selectedId)) {
    state.selectedId = state.docs[0]?.id ?? null;
  }
  render();
  if (state.selectedId) await showDetail(state.selectedId);
}

function render() {
  renderRepos();
  const docs = filteredDocs();
  elements.docList.replaceChildren(...docs.map(renderDocCard));
  setSummary(`${docs.length} of ${state.docs.length} documents`);
}

function renderRepos() {
  const counts = new Map();
  for (const doc of state.docs) counts.set(doc.repoName, (counts.get(doc.repoName) ?? 0) + 1);
  elements.allCount.textContent = String(state.docs.length);
  document.querySelector('[data-repo="all"]').classList.toggle("is-active", state.repo === "all");
  const buttons = [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([repo, count]) => {
      const button = document.createElement("button");
      button.className = `repo-pill${state.repo === repo ? " is-active" : ""}`;
      button.type = "button";
      button.dataset.repo = repo;
      button.innerHTML = `<span></span><strong>${count}</strong>`;
      button.querySelector("span").textContent = repo;
      button.addEventListener("click", () => {
        state.repo = repo;
        render();
      });
      return button;
    });
  elements.repoList.replaceChildren(...buttons);
  document.querySelector('[data-repo="all"]').onclick = () => {
    state.repo = "all";
    render();
  };
}

function filteredDocs() {
  const now = Date.now();
  const maxAge = state.date === "all" ? null : Number(state.date) * 24 * 60 * 60 * 1000;
  return state.docs.filter((doc) => {
    const haystack = `${doc.title} ${doc.repoName} ${doc.relativePath} ${doc.kind} ${doc.category}`.toLowerCase();
    if (state.repo !== "all" && doc.repoName !== state.repo) return false;
    if (state.kind !== "all" && doc.kind !== state.kind) return false;
    if (state.query && !haystack.includes(state.query)) return false;
    if (state.path && !doc.relativePath.toLowerCase().includes(state.path)) return false;
    if (maxAge && now - new Date(doc.modifiedAt).getTime() > maxAge) return false;
    return true;
  });
}

function renderDocCard(doc) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `doc-card${doc.id === state.selectedId ? " is-selected" : ""}`;
  button.innerHTML = `
    <div class="doc-title-row">
      <h3></h3>
      <span class="badge ${doc.kind}">${doc.kind === "markdown" ? "MD" : "HTML"}</span>
    </div>
    <div class="doc-meta-row">
      <span class="meta-chip repo-chip"></span>
      <span class="meta-chip category-chip"></span>
      <span class="meta-chip date-chip"></span>
    </div>
  `;
  button.querySelector("h3").textContent = doc.title;
  const [repo, category, date] = button.querySelectorAll(".doc-meta-row span");
  repo.textContent = doc.repoName;
  category.textContent = doc.category;
  date.textContent = formatDate(doc.modifiedAt);
  button.addEventListener("click", async () => {
    state.selectedId = doc.id;
    render();
    await showDetail(doc.id);
  });
  return button;
}

async function showDetail(id) {
  const response = await fetch(`/api/docs/${id}`);
  if (!response.ok) {
    showEmpty("Document no longer exists", "Refresh the index to remove stale entries.");
    return;
  }

  const { doc } = await response.json();
  elements.previewKicker.textContent = `${doc.repoName} / ${doc.kind}`;
  elements.previewTitle.textContent = doc.title;
  elements.previewPath.textContent = doc.absolutePath;
  setActions(doc);

  elements.preview.className = "preview";
  if (doc.kind === "markdown") {
    const article = document.createElement("article");
    article.className = "markdown-body";
    article.innerHTML = doc.renderedHtml;
    elements.preview.replaceChildren(article);
    return;
  }

  const frame = document.createElement("iframe");
  frame.className = "html-frame";
  frame.sandbox = "";
  frame.src = doc.rawUrl;
  frame.title = doc.title;
  elements.preview.replaceChildren(frame);
}

function setActions(doc) {
  for (const button of [elements.copyPath, elements.openFolder, elements.openSource]) button.disabled = false;
  elements.openRaw.classList.remove("is-disabled");
  elements.openRaw.href = doc.rawUrl;
}

async function copySelectedPath() {
  const doc = state.docs.find((item) => item.id === state.selectedId);
  if (!doc) return;
  await navigator.clipboard.writeText(doc.absolutePath);
  const original = elements.copyPath.textContent;
  elements.copyPath.textContent = "Copied";
  window.setTimeout(() => {
    elements.copyPath.textContent = original;
  }, 900);
}

async function openSelected(action) {
  if (!state.selectedId) return;
  await fetch(`/api/docs/${state.selectedId}/${action}`, { method: "POST" });
}

function showEmpty(title, text) {
  elements.preview.className = "preview empty";
  elements.preview.replaceChildren();
  const empty = document.createElement("div");
  empty.className = "empty-state";
  empty.innerHTML = "<strong></strong><span></span>";
  empty.querySelector("strong").textContent = title;
  empty.querySelector("span").textContent = text;
  elements.preview.append(empty);
}

function setSummary(text) {
  elements.resultSummary.textContent = text;
}

function formatDate(input) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(input));
}

function applySidebarState() {
  elements.shell.classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
  elements.toggleSidebar.setAttribute("aria-pressed", String(state.sidebarCollapsed));
  elements.toggleSidebar.setAttribute("aria-label", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  elements.toggleSidebar.setAttribute("title", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  elements.toggleSidebar.textContent = state.sidebarCollapsed ? "›" : "‹";
}
