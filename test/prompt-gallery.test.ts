describe("prompt gallery", () => {
  it("ships external html-effectiveness prompt references for the planned work categories", async () => {
    const prompts = await import("../app/prompts.js");
    const categories = new Set(prompts.promptCategories.map((category) => category.id));

    expect(categories).toEqual(new Set([
      "planning",
      "code-review",
      "design",
      "prototyping",
      "diagrams",
      "decks",
      "research",
      "reports",
      "custom-editors"
    ]));

    expect(prompts.promptCards.length).toBeGreaterThanOrEqual(20);
    for (const card of prompts.promptCards) {
      expect(categories.has(card.category)).toBe(true);
      expect(card.title.trim().length).toBeGreaterThan(0);
      expect(card.description.trim().length).toBeGreaterThan(0);
      expect(card.tags.length).toBeGreaterThan(0);
      expect(card.sourceUrl).toMatch(/^https:\/\/thariqs\.github\.io\/html-effectiveness\/.+\.html$/);
      expect("template" in card).toBe(false);
      expect("examplePrompt" in card).toBe(false);
      expect("sampleArtifact" in card).toBe(false);
    }
  });

  it("filters prompt cards by category, tag, and search text", async () => {
    const prompts = await import("../app/prompts.js");

    const codeReview = prompts.filterPromptCards(prompts.promptCards, {
      category: "code-review",
      query: "",
      tag: "all"
    });
    expect(codeReview.every((card) => card.category === "code-review")).toBe(true);
    expect(codeReview.some((card) => card.id === "03-code-review-pr")).toBe(true);

    const diagram = prompts.filterPromptCards(prompts.promptCards, {
      category: "all",
      query: "",
      tag: "diagram"
    });
    expect(diagram.length).toBeGreaterThan(0);
    expect(diagram.every((card) => card.tags.includes("diagram"))).toBe(true);

    const search = prompts.filterPromptCards(prompts.promptCards, {
      category: "all",
      query: "implementation plan",
      tag: "all"
    });
    expect(search.map((card) => card.id)).toContain("16-implementation-plan");
  });
});
