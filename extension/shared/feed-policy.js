(function initializeFeedPolicy(root, factory) {
  "use strict";

  const feedPolicy = factory();
  root.BlockInstaFeedPolicy = feedPolicy;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = feedPolicy;
  }
})(globalThis, function createFeedPolicy() {
  "use strict";

  const FALLBACK_POST_LIMIT = 25;
  const STATES = Object.freeze({
    INACTIVE: "inactive",
    ROUTING: "routing",
    SEEKING_BOUNDARY: "seeking_boundary",
    CUTOFF_REACHED: "cutoff_reached",
    FEED_UNAVAILABLE: "feed_unavailable",
  });
  const CUTOFF_REASONS = Object.freeze({
    CAUGHT_UP: "caught_up",
    RECOMMENDATIONS: "recommendations",
    LOCAL_LIMIT: "local_limit",
  });

  const SIGNALS = Object.freeze({
    en: Object.freeze({
      caughtUp: Object.freeze([
        "you're all caught up",
        "you’re all caught up",
        "all caught up",
      ]),
      recommendation: Object.freeze([
        "suggested posts",
        "suggested for you",
        "suggestions for you",
        "recommended posts",
        "recommended for you",
      ]),
      sponsored: Object.freeze(["sponsored", "advertisement", "ad"]),
      error: Object.freeze([
        "couldn't refresh feed",
        "couldn’t refresh feed",
        "something went wrong",
        "try again later",
      ]),
    }),
    es: Object.freeze({
      caughtUp: Object.freeze([
        "estás al día",
        "ya estás al día",
        "estás al corriente",
      ]),
      recommendation: Object.freeze([
        "publicaciones sugeridas",
        "sugerencias para ti",
        "sugerido para ti",
        "recomendado para ti",
      ]),
      sponsored: Object.freeze(["patrocinado", "publicidad", "anuncio"]),
      error: Object.freeze([
        "no se pudo actualizar el feed",
        "algo salió mal",
        "inténtalo de nuevo más tarde",
      ]),
    }),
  });

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase();
  }

  function languageFor(value) {
    const language = String(value || "en").toLowerCase().split(/[-_]/)[0];
    return Object.prototype.hasOwnProperty.call(SIGNALS, language)
      ? language
      : "en";
  }

  function textMatchesSignal(value, signalName, language) {
    const normalized = normalizeText(value);
    if (!normalized || normalized.length > 120) {
      return false;
    }
    const dictionary = SIGNALS[languageFor(language)];
    const phrases = dictionary[signalName] || [];
    return phrases.some((phrase) => normalized === phrase
      || normalized.startsWith(`${phrase} `)
      || normalized.endsWith(` ${phrase}`));
  }

  function classifyTexts(values, language) {
    const texts = Array.isArray(values) ? values : [values];
    return Object.freeze({
      caughtUp: texts.some((value) => textMatchesSignal(
        value,
        "caughtUp",
        language,
      )),
      recommendation: texts.some((value) => textMatchesSignal(
        value,
        "recommendation",
        language,
      )),
      sponsored: texts.some((value) => textMatchesSignal(
        value,
        "sponsored",
        language,
      )),
      error: texts.some((value) => textMatchesSignal(
        value,
        "error",
        language,
      )),
    });
  }

  function getFeedMode(value) {
    let url;
    try {
      url = new URL(value);
    } catch {
      return "other";
    }

    const hostname = url.hostname.toLowerCase();
    const isInstagram = hostname === "instagram.com"
      || hostname.endsWith(".instagram.com");
    if (!isInstagram || url.pathname.replace(/\/+$/, "") !== "") {
      return "other";
    }
    if (url.searchParams.get("variant") === "following") {
      return "following";
    }
    return url.search === "" ? "home_bare" : "home";
  }

  function getFollowingUrl(value) {
    try {
      const url = new URL(value);
      return `${url.origin}/?variant=following`;
    } catch {
      return null;
    }
  }

  function decideFeedRoute(value, candidateSettings, attemptedRecently = false) {
    const settings = candidateSettings || {};
    const mode = getFeedMode(value);
    if (!settings.enabled || !settings.limitHomeFeed || mode === "other") {
      return Object.freeze({ action: "ignore", mode, target: null });
    }
    if (mode === "home_bare"
      && settings.preferFollowingFeed
      && !attemptedRecently) {
      return Object.freeze({
        action: "replace",
        mode,
        target: getFollowingUrl(value),
      });
    }
    return Object.freeze({ action: "observe", mode, target: null });
  }

  function getPostIdentity(value, baseUrl = "https://www.instagram.com/") {
    let url;
    try {
      url = new URL(value, baseUrl);
    } catch {
      return null;
    }
    const match = url.pathname.match(/^\/(p|reel)\/([A-Za-z0-9_-]+)\/?$/i);
    return match ? `${match[1].toLowerCase()}:${match[2]}` : null;
  }

  function classifyObservation(candidate) {
    const observation = candidate || {};
    if (!observation.inFeed || observation.inDialog) {
      return Object.freeze({ action: "ignore", reason: null });
    }
    if (observation.error) {
      return Object.freeze({ action: "unavailable", reason: "feed_error" });
    }
    if (observation.loading) {
      return Object.freeze({ action: "wait", reason: "loading" });
    }
    if (observation.caughtUp) {
      return Object.freeze({
        action: "cutoff",
        reason: CUTOFF_REASONS.CAUGHT_UP,
      });
    }
    if (observation.recommendationBoundary) {
      return Object.freeze({
        action: "cutoff",
        reason: CUTOFF_REASONS.RECOMMENDATIONS,
      });
    }
    if (observation.sponsored) {
      return Object.freeze({ action: "hide", reason: "sponsored" });
    }
    if (observation.suggested) {
      return Object.freeze({ action: "hide", reason: "suggested" });
    }
    if (observation.article) {
      const nextCount = Math.max(0, Number(observation.acceptedCount) || 0) + 1;
      if (nextCount >= (observation.limit || FALLBACK_POST_LIMIT)) {
        return Object.freeze({
          action: "keep_and_cutoff",
          reason: CUTOFF_REASONS.LOCAL_LIMIT,
          acceptedCount: nextCount,
        });
      }
      return Object.freeze({
        action: "keep",
        reason: null,
        acceptedCount: nextCount,
      });
    }
    return Object.freeze({ action: "ignore", reason: null });
  }

  function nextState(currentState, eventName) {
    if (eventName === "deactivate") {
      return STATES.INACTIVE;
    }
    if (eventName === "route") {
      return STATES.ROUTING;
    }
    if (eventName === "available") {
      return STATES.SEEKING_BOUNDARY;
    }
    if (eventName === "cutoff") {
      return STATES.CUTOFF_REACHED;
    }
    if (eventName === "unavailable") {
      return STATES.FEED_UNAVAILABLE;
    }
    return currentState;
  }

  function getEndCopy(reason, limit = FALLBACK_POST_LIMIT) {
    if (reason === CUTOFF_REASONS.CAUGHT_UP) {
      return "BlockInsta stopped at Instagram's caught-up point.";
    }
    if (reason === CUTOFF_REASONS.RECOMMENDATIONS) {
      return "That is the end of posts BlockInsta could verify for this feed.";
    }
    return `BlockInsta stopped after ${limit} viewed posts because Instagram did not provide a clear end point.`;
  }

  return Object.freeze({
    FALLBACK_POST_LIMIT,
    STATES,
    CUTOFF_REASONS,
    SIGNALS,
    normalizeText,
    languageFor,
    textMatchesSignal,
    classifyTexts,
    getFeedMode,
    getFollowingUrl,
    decideFeedRoute,
    getPostIdentity,
    classifyObservation,
    nextState,
    getEndCopy,
  });
});
