/* ==========================================================================
 * services/keywords.js — Keyword pre-screening with tier scoring
 *
 * Ported from arxiv_daily.py keyword tier logic.
 * ========================================================================== */

"use strict";

(function () {
  const DEFAULT_KEYWORDS = {
    core: {
      weight: 5,
      words: [
        "majorana", "topological superconductivity", "vortex", "andreev",
        "zero bias", "quantum spin hall", "quantum anomalous hall",
      ],
    },
    related: {
      weight: 2,
      words: [
        "superconductivity", "topological", "edge state", "transport",
        "tunneling", "scanning tunneling", "josephson",
      ],
    },
  };

  globalThis.ArxivDailyKeywords = {

    // Score a single paper against keyword tiers
    scorePaper: function (paper, tiers) {
      tiers = tiers || DEFAULT_KEYWORDS;
      var text = (paper.title + " " + (paper.abstract || "")).toLowerCase();
      var total = 0;

      for (var tierName in tiers) {
        var tier = tiers[tierName];
        var weight = tier.weight || 1;
        var words = tier.words || [];

        for (var i = 0; i < words.length; i++) {
          // Simple substring match (can be upgraded to regex)
          if (text.indexOf(words[i].toLowerCase()) >= 0) {
            total += weight;
          }
        }
      }

      return total;
    },

    // Filter papers by minimum keyword score
    prefilter: function (papers, minScore, tiers) {
      var results = [];
      for (var i = 0; i < papers.length; i++) {
        var score = this.scorePaper(papers[i], tiers);
        if (score >= minScore) {
          papers[i].keywordScore = score;
          results.push(papers[i]);
        }
      }
      log("keyword prefilter: " + papers.length + " → " + results.length + " (minScore=" + minScore + ")");
      return results;
    },
  };

  function log(msg) {
    const text = "[arxiv-interest-daily] " + msg;
    if (typeof Zotero.debug === "function") Zotero.debug(text);
    else if (typeof Zotero.log === "function") Zotero.log(text);
  }
})();
