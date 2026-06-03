(function () {
  const KEY = "userSettings";
  const DEFAULTS = { showVision: true, showRange: true };

  function _read() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return { ...DEFAULTS };
      return { ...DEFAULTS, ...JSON.parse(raw) };
    } catch {
      return { ...DEFAULTS };
    }
  }
  function _write(s) {
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
  }

  window.userSettings = {
    getShowVision() { return _read().showVision; },
    setShowVision(v) { const s = _read(); s.showVision = !!v; _write(s); },
    getShowRange()  { return _read().showRange; },
    setShowRange(v)  { const s = _read(); s.showRange  = !!v; _write(s); },
  };
})();
