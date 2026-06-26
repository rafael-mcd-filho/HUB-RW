(function () {
  "use strict";

  var dict = window.HUB_TEXTS || {};

  function format(s, vars) {
    s = String(s == null ? "" : s);
    if (vars) {
      Object.keys(vars).forEach(function (k) {
        s = s.split("{" + k + "}").join(String(vars[k]));
      });
    }
    return s;
  }

  function t(key, vars) {
    return format(dict[key] || key, vars);
  }

  function has(key) {
    return Object.prototype.hasOwnProperty.call(dict, key);
  }

  function applyTexts(root) {
    root = root || document;
    function set(selector, fn) {
      Array.prototype.forEach.call(root.querySelectorAll(selector), function (node) {
        fn(node, node.getAttribute(selector.slice(1, -1)));
      });
    }
    set("[data-text]", function (node, key) { node.textContent = t(key); });
    set("[data-text-html]", function (node, key) { node.innerHTML = t(key); });
    set("[data-text-ph]", function (node, key) { node.setAttribute("placeholder", t(key)); });
    set("[data-text-aria]", function (node, key) { node.setAttribute("aria-label", t(key)); });
    set("[data-text-title]", function (node, key) { node.setAttribute("title", t(key)); });
  }

  document.documentElement.setAttribute("lang", "pt");
  window.TEXTS = { t: t, has: has, applyTexts: applyTexts };
})();
