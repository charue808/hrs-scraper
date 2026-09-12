/**
 * Search page behaviour. The only JavaScript the site ships.
 *
 * Two things Pagefind cannot do for this corpus:
 *
 * 1. **Find a section by its number.** Pagefind tokenizes `26-34` into the
 *    digits `26` and `34` and prefix-matches, so §263-4 outranks §26-34 and
 *    `1-1` does not return §1-1 at all. A section number is an address, not a
 *    query, so it is resolved as one.
 * 2. **Survive a typo.** Pagefind has no fuzzy matching, and its failure mode is
 *    worse than empty: `marijauna` returns 3 unrelated sections and `cannabus`
 *    returns 878, presented exactly like real results. Since we have the whole
 *    corpus, we can say plainly that a word does not appear in it.
 *
 * Written as a plain browser script rather than generated from a template
 * string, so it can be read and typechecked like the rest of the code.
 */
(function () {
  "use strict";

  var VOCABULARY_URL = "/search-vocabulary.txt";
  var DEBOUNCE_MS = 250;
  /** Beyond this, a "correction" is a different word, not a typo. */
  var MAX_EDITS = 2;

  var input = document.querySelector(".pagefind-ui__search-input");
  var jump = document.getElementById("jump");
  var spelling = document.getElementById("spelling");
  if (!input || !jump || !spelling) return;

  // --- jump to a section by number ---

  /**
   * A typed section number, cleaned, or null.
   *
   * The colon of the article form survives so the label reads §431:10C-301 as
   * the HRS writes it; it is folded to a hyphen only for the URL, which is the
   * same split `sectionSlug()` makes on the server.
   */
  function numberOf(query) {
    var t = query.trim().replace(/^§+\s*/, "").replace(/\s+/g, "").toUpperCase();
    if (!/^[0-9][0-9A-Z:.\-]*$/.test(t)) return null;
    // Proven against the corpus: every HRS section number contains a hyphen, so
    // a bare number is never one.
    if (t.indexOf("-") === -1) return null;
    return t;
  }

  var jumpToken = 0;

  function checkJump(query) {
    var number = numberOf(query);
    var mine = ++jumpToken;
    if (!number) {
      jump.hidden = true;
      return;
    }
    var slug = number.replace(/:/g, "-");
    // Verified before the link is offered, which is why no table of 22,972
    // section numbers has to ship to the browser.
    fetch("/hrs/" + slug, { method: "HEAD" })
      .then(function (response) {
        if (mine !== jumpToken) return; // a newer keystroke won
        if (!response.ok) {
          jump.hidden = true;
          return;
        }
        jump.innerHTML =
          'Go straight to <a href="/hrs/' + slug + '">§' + number + "</a>";
        jump.hidden = false;
      })
      .catch(function () {
        if (mine === jumpToken) jump.hidden = true;
      });
  }

  // --- spelling ---

  var vocabulary = null; // Set of every word in the corpus
  var byLength = null; // length -> words, so comparisons stay local

  fetch(VOCABULARY_URL)
    .then(function (response) {
      return response.ok ? response.text() : null;
    })
    .then(function (text) {
      if (!text) return;
      var words = text.split("\n");
      vocabulary = new Set();
      byLength = new Map();
      for (var i = 0; i < words.length; i++) {
        var word = words[i];
        if (!word) continue;
        vocabulary.add(word);
        var bucket = byLength.get(word.length);
        if (bucket) bucket.push(word);
        else byLength.set(word.length, [word]);
      }
      if (input.value) checkSpelling(input.value);
    })
    .catch(function () {
      // No vocabulary: the jump link and Pagefind still work.
    });

  /**
   * Damerau-Levenshtein distance (optimal string alignment), abandoned as soon
   * as it exceeds `max`.
   *
   * Transposition counts as one edit, not two, because it is the commonest typo
   * of all. Plain Levenshtein scores `marijauna` -> `marijuana` as 2, tying it
   * with `marijauna` -> `mariana` (two deletions) — and the wrong one wins on
   * bucket order. Counting the swap as one edit makes the right answer
   * strictly better.
   *
   * The cap keeps this cheap enough for every keystroke: most candidates are
   * abandoned after a row or two rather than completing the matrix.
   */
  function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    // Three rolling rows: the transposition rule reaches back two.
    var twoBack = new Array(b.length + 1);
    var previous = new Array(b.length + 1);
    var current = new Array(b.length + 1);
    for (var j = 0; j <= b.length; j++) previous[j] = j;

    for (var i = 1; i <= a.length; i++) {
      current[0] = i;
      var best = current[0];
      for (var k = 1; k <= b.length; k++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(k - 1) ? 0 : 1;
        var d = Math.min(current[k - 1] + 1, previous[k] + 1, previous[k - 1] + cost);
        if (
          i > 1 &&
          k > 1 &&
          a.charCodeAt(i - 1) === b.charCodeAt(k - 2) &&
          a.charCodeAt(i - 2) === b.charCodeAt(k - 1)
        ) {
          d = Math.min(d, twoBack[k - 2] + 1);
        }
        current[k] = d;
        if (d < best) best = d;
      }
      if (best > max) return max + 1;
      var spare = twoBack;
      twoBack = previous;
      previous = current;
      current = spare;
    }
    return previous[b.length];
  }

  /**
   * The closest corpus word to `word`, or null if nothing is close enough.
   *
   * Buckets are visited outward from the query's own length, because most typos
   * preserve it — so on a tie the candidate of the same length is reached first.
   */
  function suggest(word) {
    if (!byLength) return null;
    var lengths = [word.length];
    for (var d = 1; d <= MAX_EDITS; d++) lengths.push(word.length - d, word.length + d);

    var best = null;
    var bestDistance = MAX_EDITS + 1;
    for (var n = 0; n < lengths.length; n++) {
      var bucket = byLength.get(lengths[n]);
      if (!bucket) continue;
      for (var i = 0; i < bucket.length; i++) {
        var distance = editDistance(word, bucket[i], bestDistance - 1);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = bucket[i];
          if (distance === 1) return best; // cannot do better
        }
      }
    }
    return best;
  }

  function escapeHtml(text) {
    return text.replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }

  function checkSpelling(query) {
    if (!vocabulary) return;
    // A number-shaped query is an address, handled above.
    if (numberOf(query)) {
      spelling.hidden = true;
      return;
    }

    var words = query.toLowerCase().match(/[a-z][a-z'’-]{4,}/g) || [];
    for (var i = 0; i < words.length; i++) {
      var word = words[i].replace(/['’-]+$/, "");
      if (word.length < 5 || vocabulary.has(word)) continue;

      // Pagefind prefix-matches the last word, so a word the reader is still
      // typing is not a misspelling yet.
      var isLastWord = i === words.length - 1 && !/[\s.,;:]$/.test(query);
      if (isLastWord && hasPrefix(word)) {
        spelling.hidden = true;
        return;
      }

      var fix = suggest(word);
      var absent =
        "<strong>" + escapeHtml(word) + "</strong> does not appear anywhere in the statutes";
      if (fix) {
        spelling.innerHTML =
          absent +
          '. Did you mean <a href="#" data-fix="' +
          escapeHtml(fix) +
          '">' +
          escapeHtml(fix) +
          "</a>?";
      } else {
        spelling.innerHTML = absent + ", so any results below are partial matches.";
      }
      spelling.hidden = false;
      return;
    }
    spelling.hidden = true;
  }

  /** Whether any corpus word starts with `word` — i.e. it is still being typed. */
  function hasPrefix(word) {
    if (!byLength) return false;
    for (var length = word.length; length <= word.length + 12; length++) {
      var bucket = byLength.get(length);
      if (!bucket) continue;
      for (var i = 0; i < bucket.length; i++) {
        if (bucket[i].lastIndexOf(word, 0) === 0) return true;
      }
    }
    return false;
  }

  spelling.addEventListener("click", function (event) {
    var target = event.target;
    if (!target || !target.getAttribute) return;
    var fix = target.getAttribute("data-fix");
    if (!fix) return;
    event.preventDefault();
    var words = input.value.split(/(\s+)/);
    for (var i = 0; i < words.length; i++) {
      var bare = words[i].toLowerCase().replace(/['’-]+$/, "");
      if (bare.length >= 5 && vocabulary && !vocabulary.has(bare)) {
        words[i] = fix;
        break;
      }
    }
    input.value = words.join("");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.focus();
  });

  // --- wiring ---

  var timer = null;

  function run() {
    checkJump(input.value);
    checkSpelling(input.value);
  }

  input.addEventListener("input", function () {
    window.clearTimeout(timer);
    // Debounced: without this, typing "431:10C-301" fires eleven HEAD requests,
    // nine of them for prefixes that cannot exist.
    timer = window.setTimeout(run, DEBOUNCE_MS);
  });

  run();
})();
