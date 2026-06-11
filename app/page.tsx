"use client";

import DOMPurify from "dompurify";
import { marked } from "marked";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  filterPromptCards,
  promptCards,
  promptTags,
  summarizePromptCategories,
  type PromptCard,
  type PromptCategoryFilter,
  type PromptTagFilter
} from "./prompts.js";

type DocumentKind = "markdown" | "html";
type DocumentCategory = "plan" | "spec" | "superpowers" | "doc";
type CategoryFilter = DocumentCategory | "all";
type DateFilter = "all" | "1" | "3" | "7" | "30";
type Accent = "Green" | "Blue" | "Violet" | "Amber";
type Density = "compact" | "regular" | "comfy";
type ActiveView = "documents" | "prompts";
type RepoSummary = { name: string; count: number };

interface ConfigRoot {
  path: string;
  expandedPath: string;
  exists: boolean;
}

interface ConfigInfo {
  configPath: string;
  roots: ConfigRoot[];
  explicitRoots: boolean;
  warnings: string[];
}

interface DraftRoot {
  id: string;
  path: string;
  initial: ConfigRoot | null;
}

interface DocumentMeta {
  id: string;
  title: string;
  sourceTitle: string;
  kind: DocumentKind;
  category: DocumentCategory;
  sourceName: string;
  absolutePath: string;
  relativePath: string;
  repoName: string;
  repoRoot: string;
  modifiedAt: string;
  mtimeMs: number;
  sizeBytes: number;
}

interface DocumentDetail extends DocumentMeta {
  rawUrl?: string;
  rawContent?: string;
  renderedHtml?: string;
}

interface DocumentPayload {
  docs: DocumentMeta[];
  repos: Array<{ name: string; count: number }>;
}

interface SpecHubState {
  favorites: string[];
  tags: Record<string, string[]>;
  hiddenRepos: string[];
}

interface AccentTokens {
  accent: string;
  strong: string;
  soft: string;
  line: string;
  softDark: string;
  lineDark: string;
}

const markedOptions = {
  async: false,
  breaks: false,
  gfm: true
} as const;

const accents: Record<Accent, AccentTokens> = {
  Green: {
    accent: "oklch(0.58 0.12 156)",
    strong: "oklch(0.50 0.13 156)",
    soft: "oklch(0.95 0.035 156)",
    line: "oklch(0.83 0.07 156)",
    softDark: "oklch(0.30 0.045 156)",
    lineDark: "oklch(0.45 0.07 156)"
  },
  Blue: {
    accent: "oklch(0.56 0.13 248)",
    strong: "oklch(0.48 0.14 248)",
    soft: "oklch(0.95 0.035 248)",
    line: "oklch(0.82 0.07 248)",
    softDark: "oklch(0.30 0.05 248)",
    lineDark: "oklch(0.45 0.08 248)"
  },
  Violet: {
    accent: "oklch(0.56 0.14 300)",
    strong: "oklch(0.48 0.15 300)",
    soft: "oklch(0.95 0.035 300)",
    line: "oklch(0.83 0.07 300)",
    softDark: "oklch(0.30 0.05 300)",
    lineDark: "oklch(0.45 0.08 300)"
  },
  Amber: {
    accent: "oklch(0.62 0.13 65)",
    strong: "oklch(0.54 0.14 60)",
    soft: "oklch(0.95 0.04 70)",
    line: "oklch(0.84 0.08 70)",
    softDark: "oklch(0.32 0.05 65)",
    lineDark: "oklch(0.48 0.08 65)"
  }
};

export default function Home() {
  const [activeView, setActiveView] = useState<ActiveView>("documents");
  const [docs, setDocs] = useState<DocumentMeta[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDoc, setSelectedDoc] = useState<DocumentDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [repo, setRepo] = useState("all");
  const [hiddenRepos, setHiddenRepos] = useState<string[]>(() => readStoredHiddenRepos());
  const [hiddenReposExpanded, setHiddenReposExpanded] = useState(false);
  const [appState, setAppState] = useState<SpecHubState>(() => emptySpecHubState(readStoredHiddenRepos()));
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [tag, setTag] = useState("all");
  const [tagDraft, setTagDraft] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [date, setDate] = useState<DateFilter>("all");
  const [path, setPath] = useState("");
  const [summary, setSummary] = useState("Indexing local files...");
  const [error, setError] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState("");
  const [copyState, setCopyState] = useState("Copy path");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dark, setDark] = useState(false);
  const [accent, setAccent] = useState<Accent>("Green");
  const [density, setDensity] = useState<Density>("regular");
  const [fullView, setFullView] = useState(false);
  const [promptCategory, setPromptCategory] = useState<PromptCategoryFilter>("all");
  const [promptQuery, setPromptQuery] = useState("");
  const [promptTag, setPromptTag] = useState<PromptTagFilter>("all");
  const [selectedPromptId, setSelectedPromptId] = useState(promptCards[0]?.id ?? "");
  const [promptCopyState, setPromptCopyState] = useState(false);
  const [isTauri, setIsTauri] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInfo, setSettingsInfo] = useState<ConfigInfo | null>(null);
  const [draftRoots, setDraftRoots] = useState<DraftRoot[]>([]);
  const [addRootDraft, setAddRootDraft] = useState("");
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<number | null>(null);
  const [livePulse, setLivePulse] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const livePulseTimer = useRef<number | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fullViewCloseRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const filteredDocsRef = useRef<DocumentMeta[]>([]);

  useEffect(() => {
    setActiveView(readStoredView());
    setSidebarCollapsed(window.localStorage.getItem("spechub:sidebar-collapsed") === "true");
    setDark(window.localStorage.getItem("spechub:theme") === "dark");
    setAccent(readStoredAccent());
    setDensity(readStoredDensity());
    setIsTauri(isDesktop());
    void loadDocs();
    if (!isDesktop()) void loadState();
  }, []);

  useEffect(() => {
    if (isDesktop() || typeof EventSource === "undefined") return;
    const source = new EventSource("/api/events");
    source.addEventListener("docs-changed", () => {
      void loadDocs({ quiet: true });
    });
    return () => source.close();
  }, []);

  useEffect(() => {
    return () => {
      if (livePulseTimer.current) window.clearTimeout(livePulseTimer.current);
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    function closeOnPointerDown(event: PointerEvent) {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }

    document.addEventListener("pointerdown", closeOnPointerDown);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  useEffect(() => {
    window.localStorage.setItem("spechub:hidden-repos", JSON.stringify(hiddenRepos));
  }, [hiddenRepos]);

  useEffect(() => {
    window.localStorage.setItem("spechub:view", activeView);
  }, [activeView]);

  useEffect(() => {
    const root = document.documentElement;
    const tokens = accents[accent];
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.density = density;
    root.style.setProperty("--accent", tokens.accent);
    root.style.setProperty("--accent-strong", tokens.strong);
    root.style.setProperty("--accent-soft", dark ? tokens.softDark : tokens.soft);
    root.style.setProperty("--accent-line", dark ? tokens.lineDark : tokens.line);
    window.localStorage.setItem("spechub:theme", dark ? "dark" : "light");
    window.localStorage.setItem("spechub:accent", accent);
    window.localStorage.setItem("spechub:density", density);
  }, [accent, dark, density]);

  useEffect(() => {
    if (!selectedId) {
      setSelectedDoc(null);
      return;
    }
    void showDetail(selectedId);
  }, [selectedId]);

  useEffect(() => {
    setDraftTitle(selectedDoc?.title ?? "");
    setEditingTitle(false);
    setCopyState("Copy path");
    setMenuOpen(false);
  }, [selectedDoc?.id, selectedDoc?.title]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping = target && ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName);
      if (event.key === "Escape" && settingsOpen) {
        setSettingsOpen(false);
        return;
      }
      if (event.key === "Escape" && fullView) {
        setFullView(false);
        return;
      }
      if (isTyping) return;
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      const currentFilteredDocs = filteredDocsRef.current;
      if (activeView === "documents" && !fullView && !settingsOpen && currentFilteredDocs.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const currentIndex = Math.max(0, currentFilteredDocs.findIndex((doc) => doc.id === selectedId));
          const nextIndex = event.key === "ArrowDown"
            ? Math.min(currentFilteredDocs.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
          const nextId = currentFilteredDocs[nextIndex]?.id;
          if (nextId) {
            setSelectedId(nextId);
            window.requestAnimationFrame(() => {
              document.querySelector(`[data-doc-id="${nextId}"]`)?.scrollIntoView({ block: "nearest" });
            });
          }
        }
        if (event.key === "Enter" && selectedDoc) {
          event.preventDefault();
          setFullView(true);
        }
      }
      if ((event.key === "f" || event.key === "F") && activeView === "documents" && selectedDoc) {
        event.preventDefault();
        setFullView(true);
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [activeView, fullView, selectedDoc, selectedId, settingsOpen]);

  useFocusTrap(fullView, fullViewCloseRef);
  useFocusTrap(settingsOpen, settingsCloseRef);

  useEffect(() => {
    document.body.style.overflow = fullView || settingsOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [fullView, settingsOpen]);

  const repos = useMemo(() => summarizeRepos(docs), [docs]);
  const deferredQuery = useDeferredValue(query);
  const deferredPromptQuery = useDeferredValue(promptQuery);
  const hiddenRepoSet = useMemo(() => new Set(hiddenRepos), [hiddenRepos]);
  const visibleRepos = useMemo(() => repos.filter((item) => !hiddenRepoSet.has(item.name)), [hiddenRepoSet, repos]);
  const hiddenRepoSummaries = useMemo(() => repos.filter((item) => hiddenRepoSet.has(item.name)), [hiddenRepoSet, repos]);
  const visibleDocCount = useMemo(() => docs.filter((doc) => !hiddenRepoSet.has(doc.repoName)).length, [docs, hiddenRepoSet]);
  const favoriteSet = useMemo(() => new Set(appState.favorites), [appState.favorites]);
  const favoriteCount = useMemo(
    () => docs.filter((doc) => favoriteSet.has(doc.absolutePath) && !hiddenRepoSet.has(doc.repoName)).length,
    [docs, favoriteSet, hiddenRepoSet]
  );
  const tagOptions = useMemo(() => {
    const tags = new Set<string>();
    Object.values(appState.tags).forEach((items) => items.forEach((item) => tags.add(item)));
    return [...tags].sort((left, right) => left.localeCompare(right));
  }, [appState.tags]);
  const filteredDocs = useMemo(
    () => filterDocs(docs, { repo, query: deferredQuery, category, date, path, hiddenRepos, state: appState, favoritesOnly, tag }),
    [appState, category, date, deferredQuery, docs, favoritesOnly, hiddenRepos, path, repo, tag]
  );
  filteredDocsRef.current = filteredDocs;
  const promptCategorySummaries = useMemo(() => summarizePromptCategories(promptCards), []);
  const filteredPrompts = useMemo(
    () => filterPromptCards(promptCards, { category: promptCategory, query: deferredPromptQuery, tag: promptTag }),
    [deferredPromptQuery, promptCategory, promptTag]
  );
  const selectedPrompt = useMemo(
    () => promptCards.find((card) => card.id === selectedPromptId) ?? filteredPrompts[0] ?? promptCards[0],
    [filteredPrompts, selectedPromptId]
  );
  const selectedDocTags = selectedDoc ? appState.tags[selectedDoc.absolutePath] ?? [] : [];
  const selectedDocIsFavorite = Boolean(selectedDoc && favoriteSet.has(selectedDoc.absolutePath));

  useEffect(() => {
    if (!filteredPrompts.some((card) => card.id === selectedPromptId)) {
      setSelectedPromptId(filteredPrompts[0]?.id ?? promptCards[0]?.id ?? "");
    }
  }, [filteredPrompts, selectedPromptId]);

  useEffect(() => {
    if (selectedDoc && hiddenRepoSet.has(selectedDoc.repoName)) {
      setSelectedId(filteredDocs[0]?.id ?? null);
    }
  }, [filteredDocs, hiddenRepoSet, repo, selectedDoc]);

  async function loadDocs(options: { quiet?: boolean; force?: boolean } = {}) {
    if (!options.quiet) {
      setSummary("Indexing local files...");
      setError(null);
    }
    try {
      const payload = await fetchDocs(options.force);
      setDocs(payload.docs);
      setSelectedId((current) => {
        if (current && payload.docs.some((doc) => doc.id === current)) return current;
        return payload.docs[0]?.id ?? null;
      });
      setSummary(`${payload.docs.length} documents indexed`);
      markLiveUpdated();
      if (options.force) showToast("Index refreshed");
    } catch (reason) {
      if (options.quiet) {
        setError(reason instanceof Error ? reason.message : "Unable to refresh local files.");
        return;
      }
      setDocs([]);
      setSelectedId(null);
      setSelectedDoc(null);
      setError(reason instanceof Error ? reason.message : "Unable to index local files.");
      setSummary("Index failed");
    }
  }

  async function loadState() {
    try {
      const state = await fetchState();
      const storedHidden = readStoredHiddenRepos();
      if (
        state.hiddenRepos.length === 0
        && storedHidden.length > 0
        && window.localStorage.getItem("spechub:hidden-repos:migrated") !== "true"
      ) {
        const migrated = await patchState({ hiddenRepos: storedHidden });
        setAppState(migrated);
        setHiddenRepos(migrated.hiddenRepos);
        window.localStorage.setItem("spechub:hidden-repos:migrated", "true");
        return;
      }
      setAppState(state);
      setHiddenRepos(state.hiddenRepos);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to load dashboard state.");
    }
  }

  function markLiveUpdated() {
    setLiveUpdatedAt(Date.now());
    setLivePulse(true);
    if (livePulseTimer.current) window.clearTimeout(livePulseTimer.current);
    livePulseTimer.current = window.setTimeout(() => setLivePulse(false), 1500);
  }

  async function showDetail(id: string) {
    setDetailLoading(true);
    try {
      const doc = await fetchDocument(id);
      setSelectedDoc(doc);
    } catch {
      setSelectedDoc(null);
      setError("Document no longer exists. Refresh the index to remove stale entries.");
    } finally {
      setDetailLoading(false);
    }
  }

  async function copySelectedPath() {
    if (!selectedDoc) return;
    await navigator.clipboard.writeText(selectedDoc.absolutePath);
    setCopyState("Copied");
    showToast("Path copied");
    window.setTimeout(() => setCopyState("Copy path"), 1000);
  }

  async function copyPromptSource() {
    if (!selectedPrompt) return;
    await navigator.clipboard.writeText(selectedPrompt.sourceUrl);
    setPromptCopyState(true);
    showToast("Source copied");
    window.setTimeout(() => setPromptCopyState(false), 1000);
  }

  async function openSelected(action: "open_document_source" | "open_document_folder", httpAction: "open-source" | "open-folder") {
    if (!selectedDoc) return;
    if (isDesktop()) {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke(action, { id: selectedDoc.id });
      return;
    }
    await fetch(`/api/docs/${selectedDoc.id}/${httpAction}`, { method: "POST" });
  }

  async function saveSelectedTitle(title: string) {
    if (!selectedDoc) return;
    const id = selectedDoc.id;
    setError(null);
    try {
      if (isDesktop()) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("update_document_title", { id, title });
      } else {
        const response = await fetch(`/api/docs/${id}/title`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title })
        });
        if (!response.ok) throw new Error("Unable to update title.");
      }
      await loadDocs();
      setSelectedId(id);
      await showDetail(id);
      setEditingTitle(false);
      showToast(title.trim() ? "Title saved" : "Title cleared");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to update title.");
    }
  }

  function showToast(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  }

  function hideRepo(name: string) {
    const nextHiddenRepos = normalizeRepoNames([...hiddenRepos, name]);
    const nextHiddenRepoSet = new Set(nextHiddenRepos);
    setHiddenRepos(nextHiddenRepos);
    commitState({ hiddenRepos: nextHiddenRepos });
    if (repo === name) {
      setRepo("all");
    }
    if (selectedDoc?.repoName === name) {
      setSelectedId(docs.find((doc) => !nextHiddenRepoSet.has(doc.repoName))?.id ?? null);
    }
  }

  function reopenRepo(name: string) {
    const nextHiddenRepos = hiddenRepos.filter((item) => item !== name);
    setHiddenRepos(nextHiddenRepos);
    commitState({ hiddenRepos: nextHiddenRepos });
    setRepo(name);
  }

  function toggleFavorite(doc: DocumentMeta) {
    const favorites = favoriteSet.has(doc.absolutePath)
      ? appState.favorites.filter((item) => item !== doc.absolutePath)
      : normalizeRepoNames([...appState.favorites, doc.absolutePath]);
    commitState({ favorites });
  }

  function addSelectedTag() {
    if (!selectedDoc) return;
    const trimmed = tagDraft.trim();
    if (!trimmed) return;
    const nextTags = normalizeRepoNames([...(appState.tags[selectedDoc.absolutePath] ?? []), trimmed]);
    saveTags(selectedDoc.absolutePath, nextTags);
    setTagDraft("");
  }

  function removeSelectedTag(tagName: string) {
    if (!selectedDoc) return;
    saveTags(selectedDoc.absolutePath, (appState.tags[selectedDoc.absolutePath] ?? []).filter((item) => item !== tagName));
  }

  function saveTags(absolutePath: string, tags: string[]) {
    const nextTags = { ...appState.tags };
    const normalized = normalizeRepoNames(tags);
    if (normalized.length > 0) {
      nextTags[absolutePath] = normalized;
    } else {
      delete nextTags[absolutePath];
    }
    commitState({ tags: nextTags });
  }

  function commitState(patch: Partial<SpecHubState>) {
    const nextState = normalizeClientState({ ...appState, ...patch });
    setAppState(nextState);
    if (patch.hiddenRepos) setHiddenRepos(nextState.hiddenRepos);
    if (!isDesktop()) {
      void patchState(patch)
        .then((saved) => {
          setAppState(saved);
          setHiddenRepos(saved.hiddenRepos);
          showToast("Saved");
        })
        .catch((reason) => setError(reason instanceof Error ? reason.message : "Unable to save dashboard state."));
    }
  }

  function clearDocFilters() {
    setRepo("all");
    setFavoritesOnly(false);
    setTag("all");
    setQuery("");
    setCategory("all");
    setDate("all");
    setPath("");
  }

  async function openSettings() {
    setSettingsError(null);
    setAddRootDraft("");
    setSettingsOpen(true);
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error("Unable to load settings.");
      const info = (await response.json()) as ConfigInfo;
      setSettingsInfo(info);
      setDraftRoots(info.roots.map(toDraftRoot));
    } catch (reason) {
      setSettingsInfo(null);
      setDraftRoots([]);
      setSettingsError(reason instanceof Error ? reason.message : "Unable to load settings.");
    }
  }

  function closeSettings() {
    if (settingsSaving) return;
    setSettingsOpen(false);
    setSettingsError(null);
  }

  function updateDraftRoot(id: string, value: string) {
    setDraftRoots((current) => current.map((entry) => (entry.id === id ? { ...entry, path: value } : entry)));
  }

  function removeDraftRoot(id: string) {
    setDraftRoots((current) => current.filter((entry) => entry.id !== id));
  }

  function addDraftRoot() {
    const trimmed = addRootDraft.trim();
    if (!trimmed) return;
    setDraftRoots((current) => [...current, { id: createDraftId(), path: trimmed, initial: null }]);
    setAddRootDraft("");
  }

  async function saveSettings() {
    const candidate = draftRoots.map((entry) => entry.path.trim()).filter((entry) => entry.length > 0);
    if (candidate.length === 0) {
      setSettingsError("Add at least one workspace root before saving.");
      return;
    }
    setSettingsError(null);
    setSettingsSaving(true);
    try {
      const response = await fetch("/api/config/roots", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roots: candidate })
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? "Unable to save workspace roots.");
      }
      const info = (await response.json()) as ConfigInfo;
      setSettingsInfo(info);
      setDraftRoots(info.roots.map(toDraftRoot));
      setSettingsOpen(false);
      await loadDocs({ force: true });
    } catch (reason) {
      setSettingsError(reason instanceof Error ? reason.message : "Unable to save workspace roots.");
    } finally {
      setSettingsSaving(false);
    }
  }

  const rawHref = useMemo(() => {
    if (!selectedDoc) return "#";
    if (selectedDoc.rawUrl) return selectedDoc.rawUrl;
    if (!selectedDoc.rawContent) return "#";
    const type = selectedDoc.kind === "html" ? "text/html" : "text/markdown";
    return URL.createObjectURL(new Blob([selectedDoc.rawContent], { type }));
  }, [selectedDoc]);

  const renderedPreview = useMemo(() => renderPreview(selectedDoc), [selectedDoc]);
  const selectedRepo = selectedDoc?.repoName ?? "No repo";
  const selectedCategory = selectedDoc?.category ?? "document";
  const activeSearch = activeView === "documents" ? query : promptQuery;
  const activeSearchPlaceholder = activeView === "documents"
    ? "Search title, repo, path, or type..."
    : "Search prompt pages, tags, or source URLs...";

  return (
    <>
      <div className="app" data-sidebar={sidebarCollapsed ? "collapsed" : "expanded"}>
        <aside className="sidebar" aria-label="Repositories">
          <div className="brand">
            <div className="mark">SH</div>
            <div className="who">
              <b>SpecHub</b>
              <span>Local docs index</span>
            </div>
            {isTauri ? null : (
              <button
                className="settings-btn"
                type="button"
                title="Workspace settings"
                aria-label="Open workspace settings"
                onClick={() => void openSettings()}
              >
                <SettingsIcon />
              </button>
            )}
            <button
              className="collapse-btn"
              type="button"
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              aria-pressed={sidebarCollapsed}
              onClick={() => {
                const next = !sidebarCollapsed;
                setSidebarCollapsed(next);
                window.localStorage.setItem("spechub:sidebar-collapsed", String(next));
              }}
            >
              &lsaquo;
            </button>
          </div>

          <div className="view-tabs" role="tablist" aria-label="SpecHub views">
            <button type="button" role="tab" data-short="Docs" aria-selected={activeView === "documents"} onClick={() => setActiveView("documents")}>
              Documents
            </button>
            <button type="button" role="tab" data-short="Ask" aria-selected={activeView === "prompts"} onClick={() => setActiveView("prompts")}>
              Prompts
            </button>
          </div>

          {activeView === "documents" ? (
            <>
              <nav className="repo-scroll" aria-label="Repository filters">
                <div className="section-label">Repositories</div>
                <button className="repo" type="button" aria-selected={repo === "all"} onClick={() => setRepo("all")}>
                  <span className="dot" />
                  <span className="name">All repos</span>
                  <span className="count">{visibleDocCount}</span>
                </button>
                <button className="repo" type="button" aria-selected={favoritesOnly} onClick={() => setFavoritesOnly((current) => !current)}>
                  <span className="dot star-dot" />
                  <span className="name">Favorites</span>
                  <span className="count">{favoriteCount}</span>
                </button>
                {visibleRepos.map((item) => (
                  <RepoFilterRow
                    item={item}
                    key={item.name}
                    selected={repo === item.name}
                    onSelect={() => setRepo(item.name)}
                    onToggle={() => hideRepo(item.name)}
                    toggleLabel={`Hide ${item.name}`}
                    toggleTitle="Hide repository"
                    icon={<EyeOffIcon />}
                  />
                ))}
              </nav>
              {hiddenRepoSummaries.length > 0 ? (
                <div className="hidden-group" data-open={hiddenReposExpanded}>
                  <button
                    className="hidden-toggle"
                    type="button"
                    aria-expanded={hiddenReposExpanded}
                    aria-controls="hidden-repos-list"
                    onClick={() => setHiddenReposExpanded((expanded) => !expanded)}
                  >
                    <span className="chev"><ChevronIcon /></span>
                    <span>Hidden</span>
                    <b className="hcount">{hiddenRepoSummaries.length}</b>
                  </button>
                  {hiddenReposExpanded ? (
                    <div id="hidden-repos-list" className="hidden-list">
                      {hiddenRepoSummaries.map((item) => (
                        <RepoFilterRow
                          item={item}
                          key={item.name}
                          selected={repo === item.name}
                          muted
                          onSelect={() => setRepo(item.name)}
                          onToggle={() => reopenRepo(item.name)}
                          toggleLabel={`Show ${item.name}`}
                          toggleTitle="Show repository"
                          icon={<PlusCircleIcon />}
                        />
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : (
            <nav className="repo-scroll" aria-label="Prompt category filters">
              <div className="section-label">Prompt categories</div>
              <button className="repo" type="button" aria-selected={promptCategory === "all"} onClick={() => setPromptCategory("all")}>
                <span className="dot" />
                <span className="name">All prompts</span>
                <span className="count">{promptCards.length}</span>
              </button>
              {promptCategorySummaries.map((item) => (
                <button className="repo" key={item.id} type="button" aria-selected={promptCategory === item.id} onClick={() => setPromptCategory(item.id)}>
                  <span className="dot" />
                  <span className="name">{item.name}</span>
                  <span className="count">{item.count}</span>
                </button>
              ))}
            </nav>
          )}
        </aside>

        <header className="topbar" aria-label={activeView === "documents" ? "Document filters" : "Prompt filters"}>
          <div className="search">
            <SearchIcon />
            <input
              ref={searchRef}
              type="search"
              placeholder={activeSearchPlaceholder}
              aria-label="Search"
              value={activeSearch}
              onChange={(event) => activeView === "documents" ? setQuery(event.target.value) : setPromptQuery(event.target.value)}
            />
            <kbd>/</kbd>
          </div>

          <div className="filters">
            {activeView === "documents" ? (
              <>
                <label className="field">
                  <span>Date</span>
                  <span className="select-wrap">
                    <select value={date} onChange={(event) => setDate(event.target.value as DateFilter)}>
                      <option value="all">Any time</option>
                      <option value="1">Today</option>
                      <option value="3">3 days</option>
                      <option value="7">7 days</option>
                      <option value="30">30 days</option>
                    </select>
                    <ChevronIcon />
                  </span>
                </label>
                <label className="field">
                  <span>Tag</span>
                  <span className="select-wrap">
                    <select value={tag} onChange={(event) => setTag(event.target.value)}>
                      <option value="all">All tags</option>
                      {tagOptions.map((item) => <option key={item} value={item}>{item}</option>)}
                    </select>
                    <ChevronIcon />
                  </span>
                </label>
              </>
            ) : (
              <>
                <label className="field">
                  <span>Category</span>
                  <span className="select-wrap">
                    <select value={promptCategory} onChange={(event) => setPromptCategory(event.target.value as PromptCategoryFilter)}>
                      <option value="all">All</option>
                      {promptCategoriesOptions(promptCategorySummaries)}
                    </select>
                    <ChevronIcon />
                  </span>
                </label>
                <label className="field">
                  <span>Tag</span>
                  <span className="select-wrap">
                    <select value={promptTag} onChange={(event) => setPromptTag(event.target.value)}>
                      <option value="all">All tags</option>
                      {promptTags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                    </select>
                    <ChevronIcon />
                  </span>
                </label>
              </>
            )}
            {activeView === "documents" ? (
              <button className="icon-btn" type="button" title="Refresh index" aria-label="Refresh index" onClick={() => void loadDocs({ force: true })}>
                <RefreshIcon />
              </button>
            ) : null}
          </div>
        </header>

        <section className="list" aria-label={activeView === "documents" ? "Documents" : "Prompts"}>
          <div className="list-head">
            <h1>{activeView === "documents" ? "Specs & plans" : "Prompt library"}</h1>
            <div className="meta">
              {activeView === "documents"
                ? error ? error : <><span className="live-pill" data-pulse={livePulse}>{liveUpdatedAt ? `Updated ${formatLiveTime(liveUpdatedAt)}` : "Live"}</span><b>{filteredDocs.length}</b> of {docs.length} documents</>
                : <><b>{filteredPrompts.length}</b> of {promptCards.length} prompts</>}
            </div>
          </div>
          <div className="list-scroll" aria-live="polite">
            {activeView === "documents" ? (
              filteredDocs.length > 0 ? filteredDocs.map((doc) => (
                <div
                  className="doc"
                  key={doc.id}
                  role="button"
                  tabIndex={0}
                  data-doc-id={doc.id}
                  aria-selected={doc.id === selectedId}
                  onClick={() => setSelectedId(doc.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(doc.id);
                    }
                  }}
                >
                  <div className="doc-top">
                    <span className="doc-title">{doc.title}</span>
                    <button
                      className="star-btn"
                      type="button"
                      title={favoriteSet.has(doc.absolutePath) ? "Remove favorite" : "Add favorite"}
                      aria-label={favoriteSet.has(doc.absolutePath) ? `Remove ${doc.title} from favorites` : `Add ${doc.title} to favorites`}
                      aria-pressed={favoriteSet.has(doc.absolutePath)}
                      onClick={(event) => {
                        event.stopPropagation();
                        toggleFavorite(doc);
                      }}
                    >
                      <StarIcon />
                    </button>
                    <span className="fmt" data-fmt={doc.kind === "markdown" ? "MD" : "HTML"}>
                      {doc.kind === "markdown" ? "MD" : "HTML"}
                    </span>
                  </div>
                  <div className="doc-bottom">
                    <span className="repo-tag">{doc.repoName}</span>
                    <span className="kind" data-kind={doc.category}>
                      {doc.category}
                    </span>
                    <span className="date">{formatDate(doc.modifiedAt)}</span>
                  </div>
                </div>
              )) : (
                <div className="empty-filter">
                  <strong>No documents match your filters</strong>
                  <button className="btn" type="button" onClick={clearDocFilters}>Clear filters</button>
                </div>
              )
            ) : (
              filteredPrompts.map((card) => (
                <button className="doc prompt-card" key={card.id} type="button" aria-selected={card.id === selectedPrompt?.id} onClick={() => setSelectedPromptId(card.id)}>
                  <div className="doc-top">
                    <span className="doc-title">{card.title}</span>
                    <span className="fmt prompt-fmt">PROMPT</span>
                  </div>
                  <p>{card.description}</p>
                  <div className="prompt-tags">
                    {card.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                  </div>
                </button>
              ))
            )}
          </div>
        </section>

        <main className="main" aria-label="Document view">
          {activeView === "documents" ? (
            <>
          <div className="doc-header">
            <div className="breadcrumb">
              <b>{selectedRepo}</b>
              <span>/</span>
              <span>{selectedCategory}</span>
              <span className="summary-text">{summary}</span>
            </div>
            <div className="dh-row">
              <div className="titleblock">
                {editingTitle && selectedDoc ? (
                  <form
                    className="title-editor"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void saveSelectedTitle(draftTitle);
                    }}
                  >
                    <input aria-label="Document title" value={draftTitle} onChange={(event) => setDraftTitle(event.target.value)} />
                    <button className="btn primary" type="submit">Save</button>
                    <button className="btn" type="button" onClick={() => setEditingTitle(false)}>Cancel</button>
                    <button className="btn" type="button" onClick={() => void saveSelectedTitle("")}>Clear</button>
                  </form>
                ) : (
                  <h2>{selectedDoc?.title ?? "No document selected"}</h2>
                )}
                <div className="doc-path">
                  <FileIcon />
                  <span>{selectedDoc?.absolutePath ?? "Select a document to preview its contents."}</span>
                  {selectedDoc ? (
                    <button className="path-copy" type="button" title={copyState} aria-label={copyState} onClick={copySelectedPath}>
                      <CopyIcon />
                    </button>
                  ) : null}
                </div>
                {selectedDoc ? (
                  <div className="tag-editor" aria-label="Document tags">
                    <div className="tag-chips">
                      {selectedDocTags.map((item) => (
                        <button key={item} type="button" className="tag-chip" onClick={() => removeSelectedTag(item)}>
                          {item}
                          <CloseIcon />
                        </button>
                      ))}
                    </div>
                    <form
                      className="tag-add"
                      onSubmit={(event) => {
                        event.preventDefault();
                        addSelectedTag();
                      }}
                    >
                      <input aria-label="Add tag" value={tagDraft} placeholder="Add tag" onChange={(event) => setTagDraft(event.target.value)} />
                      <button className="btn" type="submit" disabled={!tagDraft.trim()}>
                        <PlusIcon />
                        Add tag
                      </button>
                    </form>
                  </div>
                ) : null}
              </div>

              <div className="actions">
                <button className="btn icon-label" type="button" disabled={!selectedDoc} aria-pressed={selectedDocIsFavorite} onClick={() => selectedDoc && toggleFavorite(selectedDoc)}>
                  <StarIcon />
                  {selectedDocIsFavorite ? "Favorited" : "Favorite"}
                </button>
                <a className={`btn${selectedDoc ? "" : " is-disabled"}`} href={rawHref} target="_blank" rel="noreferrer">
                  <ExternalIcon />
                  Raw
                </a>
                <div className="menu" ref={menuRef}>
                  <button
                    className="btn menu-toggle"
                    type="button"
                    disabled={!selectedDoc}
                    aria-haspopup="menu"
                    aria-expanded={menuOpen}
                    title="More actions"
                    onClick={() => setMenuOpen((current) => !current)}
                  >
                    <MoreIcon />
                  </button>
                  <div className="menu-pop" role="menu" data-open={menuOpen}>
                    <button className="menu-item" type="button" role="menuitem" onClick={() => { setEditingTitle(true); setMenuOpen(false); }}>
                      Edit title
                    </button>
                    <button className="menu-item" type="button" role="menuitem" onClick={() => { void openSelected("open_document_folder", "open-folder"); setMenuOpen(false); }}>
                      <FolderIcon />
                      Open folder
                    </button>
                    <button className="menu-item" type="button" role="menuitem" onClick={() => { void openSelected("open_document_source", "open-source"); setMenuOpen(false); }}>
                      <CodeIcon />
                      Open source
                    </button>
                  </div>
                </div>
                <button className="btn primary" type="button" disabled={!selectedDoc} title="Open full reading view (F)" onClick={() => setFullView(true)}>
                  <FullscreenIcon />
                  Full view
                </button>
              </div>
            </div>
          </div>

          <div className={`preview-wrap${selectedDoc ? "" : " empty"}`} title={selectedDoc ? "Double-click for full view" : undefined} onDoubleClick={() => selectedDoc && setFullView(true)}>
            {detailLoading ? <PreviewSkeleton /> : renderedPreview}
          </div>
            </>
          ) : (
            <>
              <div className="doc-header prompt-header">
                <div className="breadcrumb">
                  <b>Prompts</b>
                  <span>/</span>
                  <span>{selectedPrompt ? categoryName(selectedPrompt.category) : "library"}</span>
                  <span className="summary-text">Embedded from html-effectiveness</span>
                </div>
                <div className="dh-row">
                  <div className="titleblock">
                    <h2>{selectedPrompt?.title ?? "No prompt selected"}</h2>
                    <div className="doc-path">
                      <FileIcon />
                      <span>{selectedPrompt?.description ?? "Choose a prompt page to inspect."}</span>
                    </div>
                  </div>
                  <div className="actions">
                    <button className="btn" type="button" disabled={!selectedPrompt} onClick={copyPromptSource}>
                      <CopyIcon />
                      {promptCopyState ? "Copied" : "Copy source URL"}
                    </button>
                    <a className={`btn primary${selectedPrompt ? "" : " is-disabled"}`} href={selectedPrompt?.sourceUrl ?? "#"} target="_blank" rel="noreferrer">
                      <ExternalIcon />
                      Open original
                    </a>
                  </div>
                </div>
              </div>
              <div className="preview-wrap prompt-preview-wrap">
                {selectedPrompt ? <PromptSourcePreview card={selectedPrompt} /> : null}
              </div>
            </>
          )}
        </main>
      </div>

      <div className="modal-backdrop" data-open={fullView} onClick={(event) => event.target === event.currentTarget && setFullView(false)}>
        <div className="modal doc-modal" role="dialog" aria-modal="true" aria-label="Document full view">
          <div className="modal-bar">
            <div className="mb-title">
              <b>{selectedDoc?.title ?? "No document selected"}</b>
              <span>{selectedDoc?.absolutePath ?? ""}</span>
            </div>
            <div className="mb-actions">
              <kbd>Esc</kbd>
              <button ref={fullViewCloseRef} className="modal-close" type="button" title="Close" aria-label="Close full view" onClick={() => setFullView(false)}>
                <CloseIcon />
              </button>
            </div>
          </div>
          <div className="modal-body">{fullView ? renderPreview(selectedDoc) : null}</div>
        </div>
      </div>

      <div className="modal-backdrop" data-open={settingsOpen} onClick={(event) => event.target === event.currentTarget && closeSettings()}>
        <div className="modal settings-modal" role="dialog" aria-modal="true" aria-label="Workspace settings">
          <div className="modal-bar">
            <div className="mb-title">
              <b>Workspace settings</b>
              <span>{settingsInfo?.configPath ?? "Loading config..."}</span>
            </div>
            <div className="mb-actions">
              <kbd>Esc</kbd>
              <button
                ref={settingsCloseRef}
                className="modal-close"
                type="button"
                title="Close"
                aria-label="Close settings"
                disabled={settingsSaving}
                onClick={closeSettings}
              >
                <CloseIcon />
              </button>
            </div>
          </div>
          <div className="settings-body">
            {settingsInfo?.warnings?.map((warning) => (
              <div key={warning} className="settings-warning">{warning}</div>
            ))}

            <div className="settings-section">
              <h3>Workspace roots</h3>
              {draftRoots.length === 0 ? (
                <p className="settings-hint">No workspace roots yet. Add at least one folder below.</p>
              ) : (
                <ul className="roots-list">
                  {draftRoots.map((entry) => {
                    const status = rootDisplayStatus(entry);
                    return (
                      <li className="root-row" key={entry.id}>
                        <input
                          type="text"
                          aria-label="Workspace root path"
                          spellCheck={false}
                          value={entry.path}
                          placeholder="/path/to/workspace"
                          onChange={(event) => updateDraftRoot(entry.id, event.target.value)}
                        />
                        <span className="root-status" data-state={status.state}>{status.label}</span>
                        <button
                          type="button"
                          className="root-remove"
                          title="Remove root"
                          aria-label={`Remove ${entry.path || "workspace root"}`}
                          onClick={() => removeDraftRoot(entry.id)}
                        >
                          <TrashIcon />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div className="settings-section">
              <h3>Add workspace</h3>
              <form
                className="add-root"
                onSubmit={(event) => {
                  event.preventDefault();
                  addDraftRoot();
                }}
              >
                <input
                  type="text"
                  aria-label="New workspace root"
                  spellCheck={false}
                  value={addRootDraft}
                  placeholder="~/work or /absolute/path"
                  onChange={(event) => setAddRootDraft(event.target.value)}
                />
                <button className="btn" type="submit" disabled={!addRootDraft.trim()}>
                  <PlusIcon />
                  Add
                </button>
              </form>
              <p className="settings-hint">Tip: use ~ to reference your home directory. Restart spechub if you ran it with --roots.</p>
            </div>

            <div className="settings-section">
              <h3>Appearance</h3>
              <div className="appearance-controls">
                <label className="field">
                  <span>Accent</span>
                  <span className="select-wrap">
                    <select value={accent} onChange={(event) => setAccent(event.target.value as Accent)}>
                      <option>Green</option>
                      <option>Blue</option>
                      <option>Violet</option>
                      <option>Amber</option>
                    </select>
                    <ChevronIcon />
                  </span>
                </label>
                <label className="switch-field" title="Toggle dark chrome">
                  <span>Dark</span>
                  <input type="checkbox" checked={dark} onChange={(event) => setDark(event.target.checked)} />
                </label>
                <label className="field">
                  <span>Density</span>
                  <span className="select-wrap">
                    <select value={density} onChange={(event) => setDensity(event.target.value as Density)}>
                      <option value="compact">Compact</option>
                      <option value="regular">Regular</option>
                      <option value="comfy">Comfy</option>
                    </select>
                    <ChevronIcon />
                  </span>
                </label>
              </div>
            </div>

            {settingsError ? <div className="settings-error">{settingsError}</div> : null}

            <div className="settings-actions">
              <button className="btn" type="button" disabled={settingsSaving} onClick={closeSettings}>Cancel</button>
              <button className="btn primary" type="button" disabled={settingsSaving} onClick={() => void saveSettings()}>
                {settingsSaving ? "Saving..." : "Save changes"}
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="toast" aria-live="polite" data-open={Boolean(toast)}>
        {toast}
      </div>
    </>
  );
}

async function fetchDocs(force = false): Promise<DocumentPayload> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<DocumentPayload>("scan_documents");
  }
  const response = await fetch(force ? "/api/docs?refresh=1" : "/api/docs");
  if (!response.ok) throw new Error("Unable to index local files.");
  return response.json() as Promise<DocumentPayload>;
}

async function fetchDocument(id: string): Promise<DocumentDetail> {
  if (isDesktop()) {
    const { invoke } = await import("@tauri-apps/api/core");
    const payload = await invoke<{ doc: DocumentDetail }>("get_document", { id });
    return payload.doc;
  }
  const response = await fetch(`/api/docs/${id}`);
  if (!response.ok) throw new Error("Document not found.");
  const payload = (await response.json()) as { doc: DocumentDetail };
  return payload.doc;
}

async function fetchState(): Promise<SpecHubState> {
  const response = await fetch("/api/state");
  if (!response.ok) throw new Error("Unable to load dashboard state.");
  return response.json() as Promise<SpecHubState>;
}

async function patchState(patch: Partial<SpecHubState>): Promise<SpecHubState> {
  const response = await fetch("/api/state", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch)
  });
  if (!response.ok) throw new Error("Unable to save dashboard state.");
  return response.json() as Promise<SpecHubState>;
}

function isDesktop() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function useFocusTrap(open: boolean, initialRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const dialog = initialRef.current?.closest<HTMLElement>("[role='dialog']");
    window.requestAnimationFrame(() => initialRef.current?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab" || !dialog) return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"
      )].filter((element) => !element.hasAttribute("disabled") && element.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus();
    };
  }, [initialRef, open]);
}

export function filterDocs(
  docs: DocumentMeta[],
  filters: {
    repo: string;
    query: string;
    category: CategoryFilter;
    date: DateFilter;
    path: string;
    hiddenRepos?: readonly string[];
    state?: SpecHubState;
    favoritesOnly?: boolean;
    tag?: string;
  }
) {
  const now = Date.now();
  const query = filters.query.trim().toLowerCase();
  const pathFilter = filters.path.trim().toLowerCase();
  const maxAge = filters.date === "all" ? null : Number(filters.date) * 24 * 60 * 60 * 1000;
  const hiddenRepoSet = new Set(filters.hiddenRepos ?? filters.state?.hiddenRepos ?? []);
  const favoriteSet = new Set(filters.state?.favorites ?? []);
  const tagFilter = filters.tag && filters.tag !== "all" ? filters.tag : null;

  return docs.filter((doc) => {
    const haystack = `${doc.title} ${doc.repoName} ${doc.relativePath} ${doc.kind} ${doc.category}`.toLowerCase();
    if (filters.repo === "all" && hiddenRepoSet.has(doc.repoName)) return false;
    if (filters.repo !== "all" && doc.repoName !== filters.repo) return false;
    if (filters.favoritesOnly && !favoriteSet.has(doc.absolutePath)) return false;
    if (tagFilter && !(filters.state?.tags[doc.absolutePath] ?? []).includes(tagFilter)) return false;
    if (filters.category !== "all" && doc.category !== filters.category) return false;
    if (query && !haystack.includes(query)) return false;
    if (pathFilter && !doc.relativePath.toLowerCase().includes(pathFilter)) return false;
    if (maxAge && now - new Date(doc.modifiedAt).getTime() > maxAge) return false;
    return true;
  });
}

function summarizeRepos(docs: DocumentMeta[]): RepoSummary[] {
  const counts = new Map<string, number>();
  for (const doc of docs) counts.set(doc.repoName, (counts.get(doc.repoName) ?? 0) + 1);
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function RepoFilterRow({
  item,
  selected,
  muted = false,
  onSelect,
  onToggle,
  toggleLabel,
  toggleTitle,
  icon
}: {
  item: RepoSummary;
  selected: boolean;
  muted?: boolean;
  onSelect: () => void;
  onToggle: () => void;
  toggleLabel: string;
  toggleTitle: string;
  icon: ReactNode;
}) {
  return (
    <div className={`repo-row${muted ? " is-muted" : ""}`}>
      <button className="repo repo-main" type="button" aria-selected={selected} onClick={onSelect}>
        <span className="dot" />
        <span className="name">{item.name}</span>
        <span className="count">{item.count}</span>
      </button>
      <button className="repo-visibility-btn" type="button" title={toggleTitle} aria-label={toggleLabel} onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}>
        {icon}
      </button>
    </div>
  );
}

function renderPreview(doc: DocumentDetail | null) {
  if (!doc) {
    return (
      <div className="empty-state">
        <strong>Pick a document from the index.</strong>
        <span>Markdown renders here. HTML files open in a locked-down preview frame.</span>
      </div>
    );
  }

  if (doc.kind === "markdown") {
    const html = doc.renderedHtml ?? sanitizeMarkdown(doc.rawContent ?? "");
    return <article className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />;
  }

  return <iframe className="html-frame" sandbox="" src={doc.rawUrl} srcDoc={doc.rawContent} title={doc.title} />;
}

function PreviewSkeleton() {
  return (
    <div className="preview-skeleton" aria-label="Loading document preview">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

function sanitizeMarkdown(markdown: string) {
  const rendered = marked.parse(markdown, markedOptions) as string;
  return DOMPurify.sanitize(rendered, {
    ADD_ATTR: ["checked", "target"],
    ADD_TAGS: ["input"]
  });
}

function formatDate(input: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  }).format(new Date(input));
}

function formatLiveTime(input: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(input));
}

function promptCategoriesOptions(categories: ReturnType<typeof summarizePromptCategories>) {
  return categories.map((category) => (
    <option key={category.id} value={category.id}>
      {category.name}
    </option>
  ));
}

function categoryName(categoryId: PromptCard["category"]) {
  return summarizePromptCategories(promptCards).find((category) => category.id === categoryId)?.name ?? "Prompt";
}

function PromptSourcePreview({ card }: { card: PromptCard }) {
  return (
    <article className="prompt-source-shell">
      <div className="source-note">
        <span>Original source</span>
        <a href={card.sourceUrl} target="_blank" rel="noreferrer">{card.sourceUrl}</a>
      </div>
      <iframe
        className="prompt-source-frame"
        title={`${card.title} from html-effectiveness`}
        src={card.sourceUrl}
        sandbox="allow-forms allow-popups allow-same-origin allow-scripts"
      />
    </article>
  );
}

function readStoredAccent(): Accent {
  const stored = window.localStorage.getItem("spechub:accent");
  return stored === "Blue" || stored === "Violet" || stored === "Amber" ? stored : "Green";
}

function readStoredDensity(): Density {
  const stored = window.localStorage.getItem("spechub:density");
  return stored === "compact" || stored === "comfy" ? stored : "regular";
}

function readStoredView(): ActiveView {
  return window.localStorage.getItem("spechub:view") === "prompts" ? "prompts" : "documents";
}

function readStoredHiddenRepos() {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem("spechub:hidden-repos") ?? "[]");
    return Array.isArray(parsed) ? normalizeRepoNames(parsed) : [];
  } catch {
    return [];
  }
}

function emptySpecHubState(hiddenRepos: string[] = []): SpecHubState {
  return {
    favorites: [],
    tags: {},
    hiddenRepos
  };
}

function normalizeClientState(state: SpecHubState): SpecHubState {
  const tags = Object.fromEntries(
    Object.entries(state.tags)
      .map(([key, value]) => [key, normalizeRepoNames(value)] as const)
      .filter(([, value]) => value.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );
  return {
    favorites: normalizeRepoNames(state.favorites),
    tags,
    hiddenRepos: normalizeRepoNames(state.hiddenRepos)
  };
}

function normalizeRepoNames(names: unknown[]) {
  return [...new Set(names
    .filter((name): name is string => typeof name === "string" && name.trim().length > 0)
    .map((name) => name.trim()))]
    .sort((left, right) => left.localeCompare(right));
}

function toDraftRoot(root: ConfigRoot): DraftRoot {
  return { id: createDraftId(), path: root.path, initial: root };
}

function createDraftId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `draft-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

function rootDisplayStatus(entry: DraftRoot): { state: "ok" | "missing" | "new"; label: string } {
  const trimmed = entry.path.trim();
  if (!entry.initial || trimmed !== entry.initial.path.trim()) {
    return { state: "new", label: "Unsaved" };
  }
  return entry.initial.exists
    ? { state: "ok", label: "Found" }
    : { state: "missing", label: "Missing" };
}

function SearchIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>;
}

function ChevronIcon() {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="m6 9 6 6 6-6" /></svg>;
}

function RefreshIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.6-6.4" /><path d="M21 3v5h-5" /></svg>;
}

function StarIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z" /></svg>;
}

function MoreIcon() {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>;
}

function EyeOffIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m3 3 18 18" /><path d="M10.6 10.6A3 3 0 0 0 13.4 13.4" /><path d="M9.9 4.2A10.7 10.7 0 0 1 12 4c6.5 0 10 8 10 8a17.4 17.4 0 0 1-2.7 3.7" /><path d="M6.6 6.6C3.6 8.7 2 12 2 12s3.5 8 10 8a10.9 10.9 0 0 0 4.7-1" /></svg>;
}

function PlusCircleIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg>;
}

function FileIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5z" /><path d="M14 2v6h6" /></svg>;
}

function CopyIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>;
}

function FolderIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></svg>;
}

function CodeIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m18 16 4-4-4-4" /><path d="m6 8-4 4 4 4" /><path d="m14.5 4-5 16" /></svg>;
}

function ExternalIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6" /><path d="M10 14 21 3" /><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /></svg>;
}

function FullscreenIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3" /><path d="M21 8V5a2 2 0 0 0-2-2h-3" /><path d="M3 16v3a2 2 0 0 0 2 2h3" /><path d="M16 21h3a2 2 0 0 0 2-2v-3" /></svg>;
}

function CloseIcon() {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>;
}

function SettingsIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.13.34.2.7.2 1.06a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" /></svg>;
}

function PlusIcon() {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>;
}

function TrashIcon() {
  return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="m19 6-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /></svg>;
}
