(function () {
  const KEY = "userSettings";
  const DEFAULTS = { showVision: true, showRange: true, showHeroReticle: true, audioEnabled: true, audioVolume: 0.8 };

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
    getShowVision()    { return _read().showVision; },
    setShowVision(v)   { const s = _read(); s.showVision = !!v; _write(s); },
    getShowRange()        { return _read().showRange; },
    setShowRange(v)       { const s = _read(); s.showRange       = !!v; _write(s); },
    getShowHeroReticle()  { return _read().showHeroReticle; },
    setShowHeroReticle(v) { const s = _read(); s.showHeroReticle = !!v; _write(s); },
    getAudioEnabled()  { return _read().audioEnabled; },
    setAudioEnabled(v) { const s = _read(); s.audioEnabled = !!v; _write(s); },
    getAudioVolume()   { return _read().audioVolume; },
    setAudioVolume(v)  { const s = _read(); s.audioVolume = Math.max(0, Math.min(1, Number(v))); _write(s); },
  };
})();
