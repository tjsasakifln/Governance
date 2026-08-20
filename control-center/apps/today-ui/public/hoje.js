/* Classic script. Safe on file:. No Node loader, no fetch. */
(function (global) {
  "use strict";

  function bindShortcuts(doc) {
    var buttons = doc.querySelectorAll("[data-shortcut]");
    var i;
    for (i = 0; i < buttons.length; i += 1) {
      buttons[i].addEventListener("click", function (event) {
        var btn = event.currentTarget;
        var kind = btn.getAttribute("data-shortcut") || "";
        var out = doc.getElementById("registrar-feedback");
        if (!out) return;
        out.hidden = false;
        out.textContent =
          "Intenção local registrada: " +
          kind +
          " (não envia para Warmbly, Asaas ou GitHub; persisted=false)";
      });
    }
  }

  function paintIfEmpty(doc) {
    var root = doc.getElementById("root");
    var payload = doc.getElementById("hoje-view");
    if (!root || !payload) return;
    if (root.querySelector("main#hoje")) return;
    try {
      var view = JSON.parse(payload.textContent || "{}");
      if (!view || !view.bands) return;
      root.textContent = "HOJE · " + (view.headline || "");
    } catch (err) {
      root.textContent = "HOJE: falha ao ler o recorte local.";
    }
  }

  function start(doc) {
    if (!doc) return;
    paintIfEmpty(doc);
    bindShortcuts(doc);
  }

  global.__CONFENGE_HOJE__ = {
    start: start,
    bindShortcuts: bindShortcuts,
  };

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        start(document);
      });
    } else {
      start(document);
    }
  }
})(typeof window !== "undefined" ? window : this);
