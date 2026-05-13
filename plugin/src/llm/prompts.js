/* ==========================================================================
 * llm/prompts.js — LLM prompt templates
 *
 * Ported from arxiv_daily.py prompt logic.
 * ========================================================================== */

"use strict";

(function () {

  globalThis.ArxivDailyPrompts = {

    // Broad LLM prefilter — replaces keyword prefilter in LLM mode.
    prefilterPrompt: function (interestProfile) {
      return [
        "You are doing a broad first-pass prefilter for an arXiv daily report.",
        "The goal is high recall: do not reject a paper merely because it misses exact keywords.",
        "Keep papers that may be useful as direct relevance, weak background, adjacent method, material platform, observable, or cross-field inspiration.",
        "Reject only papers that are clearly outside the user's research interests and unlikely to be useful even for quick skimming.",
        "Write reasons in Simplified Chinese.",
        "",
        "Research interests:",
        interestProfile || "(not provided)",
        "",
        "Return only valid JSON. Do not include Markdown fences or extra commentary.",
        "For each paper below, return one object with this exact schema:",
        "[",
        '  { "arxiv_id": "2501.01234", "score": 1, "keep": true, "reason": "简短中文理由", "tags": ["标签"] }',
        "]",
        "",
        "Score meaning for this broad prefilter:",
        "5 = direct hit",
        "4 = strong adjacent relevance",
        "3 = plausible useful background or method",
        "2 = weak but worth keeping for skim",
        "1 = clearly outside scope",
        "",
        "Use keep=true for score >= 2 unless the paper is clearly irrelevant.",
      ].join("\n");
    },

    // Screening prompt — asks LLM to score papers against research interests
    screeningPrompt: function (interestProfile) {
      return [
        "You are screening arXiv papers for a condensed matter researcher.",
        "Judge each paper against the research profile, not just by category keywords.",
        "Write reasons in Simplified Chinese.",
        "",
        "Research interests:",
        interestProfile || "(not provided)",
        "",
        "Return only valid JSON. Do not include Markdown fences or extra commentary.",
        "For each paper below, return one object with this exact schema:",
        '[',
        '  { "arxiv_id": "2501.01234", "score": 1, "keep": false, "is_cross_discipline": false, "reason": "简短中文理由", "tags": ["标签"] }',
        ']',
        "",
        "Score meaning:",
        "5 = Directly relevant, worth reading immediately",
        "4 = Strongly relevant method/observable/material",
        "3 = Adjacent, potentially useful",
        "2 = Weak background",
        "1 = Outside focus",
        "",
        "Use keep=true for papers that should enter the daily report.",
        "Set is_cross_discipline=true only for adjacent papers that are useful but not a direct core hit.",
        "Be concise. Focus on observable connections to Majorana, vortices, PDW/CDW,",
        "STM/STS, transport, edge physics, or topological superconductivity.",
      ].join("\n");
    },

    // Deep read prompt — generates a detailed guide for a top-scored paper
    deepReadPrompt: function (paper, fullText) {
      return [
        "You are writing a readable long-form guide for a top-ranked arXiv paper.",
        "Be technically precise, but make the guide readable as connected Chinese prose.",
        "Do not simply output the checklist below as numbered bullets. You may reason with the checklist internally, then polish it into 2-4 coherent long paragraphs.",
        "",
        "Title: " + (paper.title || ""),
        "Authors: " + (paper.authors || ""),
        "arXiv: " + (paper.arxivId || ""),
        "Abstract:",
        paper.abstract || "(not provided)",
        "",
        "Full text available: " + (fullText ? fullText.length + " chars" : "No"),
        "Source text:",
        fullText || paper.abstract || "(not provided)",
        "",
        "The final guide must naturally cover:",
        "- The basic mental picture and background concepts needed to read this paper.",
        "- The paper's logic chain and narrative: what question it starts from, how it moves, and why each step matters.",
        "- The starting point, research method, experimental/theoretical setup, and observables.",
        "- The main conclusions, innovation, and value for related condensed-matter research.",
        "- If relevant, how it connects to Majorana physics, vortex physics, STM/STS, topological superconductivity, transport, edge states, or quantum materials.",
        "",
        "Write in Simplified Chinese. Prefer clear long paragraphs with a few compact transition phrases. Avoid generic praise and avoid empty template language.",
      ].join("\n");
    },

    // Cross read prompt — similar but shorter for cross-category papers
    crossReadPrompt: function (paper) {
      return [
        "You are writing a cross-field reading guide for a semi-outsider.",
        "The reader is a condensed-matter researcher, but may not know this paper's subfield well.",
        "Do not output a mechanical checklist. First understand the points below, then write 2-3 connected Chinese paragraphs.",
        "",
        "Title: " + (paper.title || ""),
        "Authors: " + (paper.authors || ""),
        "arXiv: " + (paper.arxivId || ""),
        "Categories: " + (paper.categories || paper.primaryCategory || ""),
        "Abstract:",
        paper.abstract || "(not provided)",
        "",
        "The guide must naturally include:",
        "- The core mental picture of the paper's field: what objects, degrees of freedom, or measurement logic matter.",
        "- The paper's logic chain: what problem it asks, what method or evidence it uses, and how the conclusion follows.",
        "- A picture of the research conclusion: what the reader should imagine after reading it, and why it might matter to adjacent directions.",
        "- A short note on how this may connect to topological superconductivity, Majorana physics, vortex bound states, STM/STS, transport, or quantum materials when the connection is real.",
        "",
        "Write in Simplified Chinese. Make it understandable without dumbing down the technical content.",
      ].join("\n");
    },

    // Profile building prompt
    profileBuildPrompt: function (extractedTexts) {
      return [
        "Based on the following collection of papers, notes, abstracts, project files, code, and configuration excerpts,",
        "synthesize a concise research interest profile for a condensed matter physicist.",
        "Format as a Markdown document titled 'Research Interests'.",
        "Group interests by theme, mention specific materials, methods, phenomena, instruments, simulations, and project goals when supported by the sources.",
        "When sources come from a user project folder, infer the real research direction from readable content, filenames, directory structure, and non-text artifact metadata.",
        "",
        "Source materials:",
        extractedTexts || "(not provided)",
      ].join("\n");
    },
  };
})();
