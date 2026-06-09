export type PromptCategoryId =
  | "planning"
  | "code-review"
  | "design"
  | "prototyping"
  | "diagrams"
  | "decks"
  | "research"
  | "reports"
  | "custom-editors";

export type PromptCategoryFilter = PromptCategoryId | "all";
export type PromptTagFilter = string | "all";

export interface PromptCategory {
  id: PromptCategoryId;
  name: string;
  description: string;
}

export interface PromptCard {
  id: string;
  category: PromptCategoryId;
  title: string;
  description: string;
  sourceUrl: string;
  tags: string[];
}

const HTML_EFFECTIVENESS_BASE_URL = "https://thariqs.github.io/html-effectiveness";

function source(path: string) {
  return `${HTML_EFFECTIVENESS_BASE_URL}/${path}`;
}

export const promptCategories: PromptCategory[] = [
  {
    id: "planning",
    name: "Exploration & Planning",
    description: "Original html-effectiveness artifacts for comparing approaches and planning work."
  },
  {
    id: "code-review",
    name: "Code Review & Understanding",
    description: "Original review, PR, and code-understanding examples."
  },
  {
    id: "design",
    name: "Design",
    description: "Original UI system, component, and critique examples."
  },
  {
    id: "prototyping",
    name: "Prototyping",
    description: "Original interactive HTML prototype examples."
  },
  {
    id: "diagrams",
    name: "Diagrams",
    description: "Original architecture and flowchart diagram examples."
  },
  {
    id: "decks",
    name: "Decks",
    description: "Original decision and explainer deck examples."
  },
  {
    id: "research",
    name: "Research & Learning",
    description: "Original comparison and explainer research examples."
  },
  {
    id: "reports",
    name: "Reports",
    description: "Original status-report example."
  },
  {
    id: "custom-editors",
    name: "Custom Editing Interfaces",
    description: "Original prompt and structured-editor examples."
  }
];

export const promptCards: PromptCard[] = [
  {
    id: "01-exploration-code-approaches",
    category: "planning",
    title: "Exploration: Code Approaches",
    description: "Embedded original page for comparing implementation approaches.",
    sourceUrl: source("01-exploration-code-approaches.html"),
    tags: ["planning", "architecture", "tradeoff"]
  },
  {
    id: "02-exploration-visual-designs",
    category: "planning",
    title: "Exploration: Visual Designs",
    description: "Embedded original page for comparing visual design directions.",
    sourceUrl: source("02-exploration-visual-designs.html"),
    tags: ["planning", "design", "options"]
  },
  {
    id: "16-implementation-plan",
    category: "planning",
    title: "Implementation Plan",
    description: "Embedded original page for turning a chosen direction into an implementation plan.",
    sourceUrl: source("16-implementation-plan.html"),
    tags: ["planning", "spec", "handoff"]
  },
  {
    id: "03-code-review-pr",
    category: "code-review",
    title: "Code Review: Pull Request",
    description: "Embedded original pull-request review example.",
    sourceUrl: source("03-code-review-pr.html"),
    tags: ["code-review", "pr", "review"]
  },
  {
    id: "17-pr-writeup",
    category: "code-review",
    title: "Pull Request Writeup",
    description: "Embedded original PR writeup example.",
    sourceUrl: source("17-pr-writeup.html"),
    tags: ["code-review", "pr", "summary"]
  },
  {
    id: "04-code-understanding",
    category: "code-review",
    title: "Code Understanding",
    description: "Embedded original example for explaining an unfamiliar code area.",
    sourceUrl: source("04-code-understanding.html"),
    tags: ["code-review", "code-understanding", "architecture"]
  },
  {
    id: "05-design-system",
    category: "design",
    title: "Design System",
    description: "Embedded original design-system example.",
    sourceUrl: source("05-design-system.html"),
    tags: ["design", "system", "ui"]
  },
  {
    id: "06-component-variants",
    category: "design",
    title: "Component Variants",
    description: "Embedded original component-variant example.",
    sourceUrl: source("06-component-variants.html"),
    tags: ["design", "component", "states"]
  },
  {
    id: "07-prototype-animation",
    category: "prototyping",
    title: "Prototype: Animation",
    description: "Embedded original animated prototype example.",
    sourceUrl: source("07-prototype-animation.html"),
    tags: ["prototype", "animation", "html"]
  },
  {
    id: "08-prototype-interaction",
    category: "prototyping",
    title: "Prototype: Interaction",
    description: "Embedded original interactive prototype example.",
    sourceUrl: source("08-prototype-interaction.html"),
    tags: ["prototype", "interactive", "html"]
  },
  {
    id: "10-svg-illustrations",
    category: "diagrams",
    title: "SVG Illustrations",
    description: "Embedded original SVG illustration example.",
    sourceUrl: source("10-svg-illustrations.html"),
    tags: ["diagram", "illustration", "svg"]
  },
  {
    id: "13-flowchart-diagram",
    category: "diagrams",
    title: "Diagram: Flowchart",
    description: "Embedded original flowchart example.",
    sourceUrl: source("13-flowchart-diagram.html"),
    tags: ["diagram", "flowchart", "workflow"]
  },
  {
    id: "09-slide-deck",
    category: "decks",
    title: "Slide Deck",
    description: "Embedded original slide-deck example.",
    sourceUrl: source("09-slide-deck.html"),
    tags: ["deck", "presentation", "slides"]
  },
  {
    id: "14-research-feature-explainer",
    category: "research",
    title: "Research: Feature Explainer",
    description: "Embedded original feature research explainer example.",
    sourceUrl: source("14-research-feature-explainer.html"),
    tags: ["research", "feature", "explainer"]
  },
  {
    id: "15-research-concept-explainer",
    category: "research",
    title: "Research: Concept Explainer",
    description: "Embedded original concept research explainer example.",
    sourceUrl: source("15-research-concept-explainer.html"),
    tags: ["research", "explainer", "learning"]
  },
  {
    id: "11-status-report",
    category: "reports",
    title: "Status Report",
    description: "Embedded original status-report example.",
    sourceUrl: source("11-status-report.html"),
    tags: ["report", "status", "update"]
  },
  {
    id: "12-incident-report",
    category: "reports",
    title: "Incident Report",
    description: "Embedded original incident-report example.",
    sourceUrl: source("12-incident-report.html"),
    tags: ["report", "incident", "postmortem"]
  },
  {
    id: "18-editor-triage-board",
    category: "custom-editors",
    title: "Editor: Triage Board",
    description: "Embedded original triage-board editor example.",
    sourceUrl: source("18-editor-triage-board.html"),
    tags: ["editor", "triage", "structured"]
  },
  {
    id: "19-editor-feature-flags",
    category: "custom-editors",
    title: "Editor: Feature Flags",
    description: "Embedded original feature-flag editor example.",
    sourceUrl: source("19-editor-feature-flags.html"),
    tags: ["editor", "feature-flags", "structured"]
  },
  {
    id: "20-editor-prompt-tuner",
    category: "custom-editors",
    title: "Editor: Prompt Tuner",
    description: "Embedded original prompt tuning editor example.",
    sourceUrl: source("20-editor-prompt-tuner.html"),
    tags: ["editor", "prompt", "custom"]
  }
];

export const promptTags = Array.from(new Set(promptCards.flatMap((card) => card.tags))).sort();

export function filterPromptCards(
  cards: PromptCard[],
  filters: { category: PromptCategoryFilter; query: string; tag: PromptTagFilter }
) {
  const normalizedQuery = filters.query.trim().toLowerCase();
  return cards.filter((card) => {
    if (filters.category !== "all" && card.category !== filters.category) return false;
    if (filters.tag !== "all" && !card.tags.includes(filters.tag)) return false;
    if (!normalizedQuery) return true;

    const haystack = [
      card.title,
      card.description,
      card.sourceUrl,
      ...card.tags
    ].join(" ").toLowerCase();

    return haystack.includes(normalizedQuery);
  });
}

export function summarizePromptCategories(cards: PromptCard[]) {
  return promptCategories.map((category) => ({
    ...category,
    count: cards.filter((card) => card.category === category.id).length
  }));
}
