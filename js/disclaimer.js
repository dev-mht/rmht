/**
 * disclaimer.js
 * Blocking legal disclaimer popup for Robinhood Milestone HODL Token ($RMHT).
 * - Shows on every page load until the user has accepted.
 * - No close button, no click-outside-to-close, no ESC dismissal.
 * - "I Accept" button stays disabled until ALL checkboxes are checked.
 * - Consent is stored in localStorage with a timestamp and version,
 *   so re-showing it is easy if you ever update the legal terms.
 */

(function () {
  "use strict";

  var STORAGE_KEY = "rmht_legal_consent_v1"; // bump the _v1 if you ever change the terms, to force re-acceptance
  var LEGAL_PAGE_URL = "legal.html"; // legal.html lives at the root of the rmht repo

  var CHECK_ITEMS = [
    "I understand this is not financial, legal, or tax advice.",
    "I understand RMHT is a decentralized token with no issuing entity, no guarantee of profit, and that I may lose some or all of my funds.",
    "I am solely responsible for my own due diligence, wallet security, and compliance with the laws applicable to me."
  ];

  function hasConsented() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      var data = JSON.parse(raw);
      return data && data.accepted === true;
    } catch (e) {
      return false;
    }
  }

  function saveConsent() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ accepted: true, timestamp: new Date().toISOString() })
      );
    } catch (e) {
      // localStorage unavailable (private mode, etc.) — modal will simply show again next load.
    }
  }

  function buildModal() {
    var overlay = document.createElement("div");
    overlay.className = "disclaimer-overlay";
    overlay.id = "disclaimer-overlay";

    var modal = document.createElement("div");
    modal.className = "disclaimer-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", "disclaimer-title");

    var title = document.createElement("h2");
    title.id = "disclaimer-title";
    title.textContent = "Before You Continue";
    modal.appendChild(title);

    var intro = document.createElement("p");
    intro.className = "intro";
    intro.textContent =
      "Please read and confirm the following before accessing this site. RMHT is a decentralized utility token with no issuing entity — you must understand and accept the risks.";
    modal.appendChild(intro);

    var checksWrap = document.createElement("div");
    checksWrap.className = "disclaimer-checks";

    var checkboxes = [];

    CHECK_ITEMS.forEach(function (label, i) {
      var item = document.createElement("label");
      item.className = "disclaimer-check-item";

      var input = document.createElement("input");
      input.type = "checkbox";
      input.id = "disclaimer-check-" + i;

      var span = document.createElement("span");
      span.textContent = label;

      item.appendChild(input);
      item.appendChild(span);
      checksWrap.appendChild(item);
      checkboxes.push(input);
    });

    modal.appendChild(checksWrap);

    var linkPara = document.createElement("p");
    linkPara.className = "intro";
    var link = document.createElement("a");
    link.className = "disclaimer-link";
    link.textContent = "Read the full legal disclaimer";
    link.href = LEGAL_PAGE_URL;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    linkPara.appendChild(link);
    modal.appendChild(linkPara);

    var acceptBtn = document.createElement("button");
    acceptBtn.className = "disclaimer-accept-btn";
    acceptBtn.textContent = "I Accept";
    acceptBtn.disabled = true;
    modal.appendChild(acceptBtn);

    function refreshButtonState() {
      var allChecked = checkboxes.every(function (cb) {
        return cb.checked;
      });
      acceptBtn.disabled = !allChecked;
      if (allChecked) {
        acceptBtn.classList.add("enabled");
      } else {
        acceptBtn.classList.remove("enabled");
      }
    }

    checkboxes.forEach(function (cb) {
      cb.addEventListener("change", refreshButtonState);
    });

    acceptBtn.addEventListener("click", function () {
      if (acceptBtn.disabled) return; // safety guard, button is unclickable anyway via disabled attr
      saveConsent();
      overlay.setAttribute("hidden", "true");
      document.body.style.overflow = ""; // restore scroll
      overlay.remove();
    });

    overlay.appendChild(modal);

    // Deliberately NOT attaching any click-outside-to-close or ESC-key handlers,
    // and NOT adding a close (X) button. This popup is intentionally blocking.

    return overlay;
  }

  function showDisclaimer() {
    document.body.style.overflow = "hidden"; // prevent scrolling/interacting with the page behind it
    var overlay = buildModal();
    document.body.appendChild(overlay);
  }

  function init() {
    if (!hasConsented()) {
      showDisclaimer();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
