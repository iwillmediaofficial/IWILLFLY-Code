// Safety net for a saved old copy of the page. Instagram's and Facebook's in-app browsers can open a copy of
// index.html saved before the latest deploy; it asks for app files that deploy removed, so the app never starts
// and the logo loader spins forever. If an app file fails to load, or the app has not started after a while,
// load the page once more with a fresh address so the browser has to fetch the current page.
// A plain file (not inline) so the Content-Security-Policy allows it; it never changes name between deploys.
(function () {
  var KEY = 'iwf-boot-reload';
  var PARAM = '_r';
  var started = false;
  window.__iwfStarted = function () {
    started = true;
  };

  function reloadFresh() {
    if (started) return;
    try {
      // Once per 30 seconds at most, so a real outage shows the loader instead of a reload loop.
      var last = Number(sessionStorage.getItem(KEY));
      if (last && Date.now() - last < 30000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
    } catch (e) {
      // No storage: the fresh-address marker stops a second reload instead.
      if (new RegExp('[?&]' + PARAM + '=').test(location.search)) return;
    }
    var url = new URL(location.href);
    url.searchParams.set(PARAM, Date.now().toString(36));
    location.replace(url.toString());
  }

  // A missing app file comes back as the HTML page, which the browser refuses to run as a script.
  window.addEventListener(
    'error',
    function (e) {
      var el = e.target;
      if (!el || el === window || (el.tagName !== 'SCRIPT' && el.tagName !== 'LINK')) return;
      if ((el.src || el.href || '').indexOf('/assets/') !== -1) reloadFresh();
    },
    true,
  );

  // Backstop in case the browser reports nothing; long enough for a slow mobile connection.
  setTimeout(reloadFresh, 12000);
})();
