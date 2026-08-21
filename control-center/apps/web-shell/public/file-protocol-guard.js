(function () {
  if (typeof location === "undefined" || location.protocol !== "file:") return;
  var root = document.getElementById("root");
  if (!root) return;
  root.innerHTML =
    '<main class="file-protocol" role="alert">' +
    "<h1>Control Center precisa de um servidor local</h1>" +
    "<p>Abrir este arquivo via <code>file:</code> não carrega o módulo ES. " +
    "No diretório <code>control-center/apps/web-shell</code> execute:</p>" +
    "<pre>npm install\nnpm run dev\n# ou\nnpm run preview</pre>" +
    "</main>";
})();
