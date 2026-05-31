/**
 * Maps each troop type + owner to its sprite filename. Every sprite gets its
 * white background keyed out at load time via a border flood-fill, so the
 * original asset can be either a JPG with white fill or a PNG with white
 * (or already-transparent) background — both render the same.
 */
const troopSpriteFiles = {
  swordsman:    { player1: "blueSwordsman.jpg", player2: "redSwordsman.jpg" },
  archer:       { player1: "blueArcher.jpg",    player2: "redArcher.jpg" },
  heavy:        { player1: "blueHeavy.jpg",     player2: "redHeavy.jpg" },
  militia:      { player1: "blueMilitia.jpg",   player2: "redMilitia.jpg" },
  settler:      { player1: "blueSettler.jpg",   player2: "redSettler.jpg" },
  sentinel:     { player1: "blueSentinel.jpg",  player2: "redSentinel.jpg" },
  brute:        { player1: "blueBrute.jpg",     player2: "redBrute2.png" },
  brickMcStick: { player1: "BrickMcStick_Blue.png", player2: "BrickMcStick_Red.png" },
  strategia:    { player1: "Strategia_Blue.png",    player2: "Strategia_Red.png" },
};

/**
 * Renderer - Handles game rendering
 * @class
 */
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");

    // Color lookup for building types
    this.buildingColors = {
      wall:          "#888888",
      farm:          "#6b8e23",
      archerTower:   "#8a2be2",
      sniperOutpost: "#4169e1",
      warCamp:       "#8b4513",
      missileSilo:   "#cc3300",
      towerTurret:   "#5a6578",
    };

    // Color lookup for troop types
    this.troopColors = {
      player1: "#3399ff",
      player2: "#ff4444",
    };

    // Sprite cache: "type:owner" -> { ready, drawable }
    this.troopSprites = {};
    this._loadTroopSprites();
  }

  /**
   * Preload every troop sprite. Each image's white background is keyed out
   * by a border flood-fill (safe no-op for already-transparent PNGs). Each
   * entry flips to ready when its image loads, so drawTroops falls back to
   * a colored circle until then.
   */
  _loadTroopSprites() {
    for (const type in troopSpriteFiles) {
      for (const owner of ["player1", "player2"]) {
        const file = troopSpriteFiles[type][owner];
        const entry = { ready: false, drawable: null };
        this.troopSprites[type + ":" + owner] = entry;

        const img = new Image();
        img.onload = () => {
          entry.drawable = this._removeWhiteBackground(img);
          entry.ready = true;
        };
        img.onerror = () => { entry.ready = false; };
        img.src = "images/" + file;
      }
    }
  }

  /**
   * Make a sprite's white background transparent via flood-fill from the
   * border, so we don't punch holes in light-colored interior details (e.g. a
   * sword blade). Returns a canvas; on a tainted context (file:// origin) it
   * falls back to the raw image. Run from an http server for keying to work.
   * @param {HTMLImageElement} img
   * @returns {HTMLCanvasElement|HTMLImageElement}
   */
  _removeWhiteBackground(img) {
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const cx = c.getContext("2d");
    cx.drawImage(img, 0, 0);

    let imageData;
    try {
      imageData = cx.getImageData(0, 0, w, h);
    } catch (e) {
      console.warn("[Renderer] Canvas tainted, skipping white-key (serve over http):", e);
      return img;
    }

    const px = imageData.data;
    const isWhite = (i) => px[i] > 235 && px[i + 1] > 235 && px[i + 2] > 235;
    const visited = new Uint8Array(w * h);
    const stack = [];

    for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
    for (let y = 0; y < h; y++) { stack.push(y * w, y * w + (w - 1)); }

    while (stack.length) {
      const p = stack.pop();
      if (visited[p]) continue;
      visited[p] = 1;
      if (!isWhite(p * 4)) continue;
      px[p * 4 + 3] = 0;
      const x = p % w;
      const y = (p / w) | 0;
      if (x > 0) stack.push(p - 1);
      if (x < w - 1) stack.push(p + 1);
      if (y > 0) stack.push(p - w);
      if (y < h - 1) stack.push(p + w);
    }

    cx.putImageData(imageData, 0, 0);
    return c;
  }

  /**
   * Render the game
   */
  render() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (window.gameSetupResult && window.gameSetupResult.gameState) {
      const gs = window.gameSetupResult.gameState;
      this.drawGrid(gs);
      this.drawBuildings(gs);
      this.drawStrategems(gs);
      this.drawRangeRings(gs);
      this.drawTroops(gs);
      this.drawDamagePopups(gs);
      this.drawTargetingLines(gs);
      this._drawCursorPreview(gs);

      if (gs.gameOver) {
        const { ctx } = this;
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        ctx.fillStyle = "#fff";
        ctx.font = "bold 48px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const msg = gs.winner === "player1" ? "You Win!" : "CPU Wins!";
        ctx.fillText(msg, this.canvas.width / 2, this.canvas.height / 2);
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  /**
   * Draw the tile grid
   * @param {GameState} gs
   */
  drawGrid(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;
    const midCol = Math.floor(gs.cols / 2);

    for (let row = 0; row < gs.rows; row++) {
      for (let col = 0; col < gs.cols; col++) {
        ctx.fillStyle = (row + col) % 2 === 0 ? "#2a2a2a" : "#252525";
        ctx.fillRect(col * ts, row * ts, ts, ts);

        // Spawn-zone overlay: persistent baseline showing where each player
        // can place units (cols 1..midCol-1 blue, cols midCol..cols-2 red).
        // Drawn under the influence tint so claims still dominate visually.
        let zoneFill = null;
        if (col >= 1 && col < midCol) zoneFill = "rgba(51,153,255,0.06)";
        else if (col >= midCol && col <= gs.cols - 2) zoneFill = "rgba(255,68,68,0.06)";
        if (zoneFill) {
          ctx.fillStyle = zoneFill;
          ctx.fillRect(col * ts, row * ts, ts, ts);
        }

        // Influence tint: 0 invisible, +/-0.5 mid (claim threshold), +/-1 saturated.
        const tile = gs.grid[row][col];
        const inf = tile && tile.influence;
        if (inf) {
          const a = 0.05 + 0.30 * Math.abs(inf);
          ctx.fillStyle = inf > 0 ? `rgba(51,153,255,${a})` : `rgba(255,68,68,${a})`;
          ctx.fillRect(col * ts, row * ts, ts, ts);
        }

        // Claimed-tile border: makes spawnable tiles read at a glance. Unclaimed
        // tiles keep the faint grid line; claimed tiles get a thicker owner-color line.
        if (tile && tile.owner) {
          ctx.strokeStyle = tile.owner === "player1" ? "rgba(102,170,255,0.75)" : "rgba(255,102,102,0.75)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(col * ts + 0.75, row * ts + 0.75, ts - 1.5, ts - 1.5);
        } else {
          ctx.strokeStyle = "#1a1a1a";
          ctx.lineWidth = 0.5;
          ctx.strokeRect(col * ts, row * ts, ts, ts);
        }
      }
    }
  }

  /**
   * Draw all buildings
   * @param {GameState} gs
   */
  drawBuildings(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;

    for (const b of gs.buildings) {
      const x = b.col * ts;
      const y = b.row * ts;
      const w = (b.width || 1) * ts;
      const h = (b.height || 1) * ts;

      // Body
      ctx.fillStyle = this.buildingColors[b.type] || "#777";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = b.owner === "player1" ? "#66aaff" : "#ff6666";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);

      // Dim if not yet active
      if (!b.active) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(x, y, w, h);
      }

      // HP bar
      const hpFrac = b.hp / b.maxHP;
      ctx.fillStyle = "#333";
      ctx.fillRect(x, y - 5, w, 3);
      ctx.fillStyle = hpFrac > 0.5 ? "#4caf50" : hpFrac > 0.25 ? "#ff9800" : "#f44336";
      ctx.fillRect(x, y - 5, w * hpFrac, 3);

      // Tower Turrets print their current HP centered in the cell so the
      // player can read damage taken at a glance without eyeballing the
      // 3px bar. Incoming damage shows via floating popups, not a stat.
      if (b.type === "towerTurret") {
        const bcx = x + w / 2;
        const bcy = y + h / 2;
        ctx.font = "bold " + Math.round(ts * 0.4) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = "#000";
        ctx.fillText(Math.ceil(b.hp), bcx + 1, bcy + 1);
        ctx.fillStyle = "#fff";
        ctx.fillText(Math.ceil(b.hp), bcx, bcy);
      }
    }
  }

  /**
   * Draw all troops
   * @param {GameState} gs
   */
  drawTroops(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;
    const r = ts * 0.35;

    for (const t of gs.troops) {
      const cx = (t.col + 0.5) * ts;
      const cy = (t.row + 0.5) * ts;
      const inactive = t.active === false;
      const isHero = !!t.isHero;
      const auraR  = isHero ? ts * 0.75 : ts * 0.5;
      const boxSize = isHero ? ts * 2.0 : ts * 1.3;

      // Owner aura — keeps blue/red ownership readable under busy sprite art.
      // Heroes get a larger, brighter ring so they're easy to spot.
      ctx.beginPath();
      ctx.arc(cx, cy, auraR, 0, Math.PI * 2);
      if (isHero) {
        ctx.fillStyle = t.owner === "player1" ? "rgba(51,153,255,0.55)" : "rgba(255,68,68,0.55)";
      } else {
        ctx.fillStyle = t.owner === "player1" ? "rgba(51,153,255,0.35)" : "rgba(255,68,68,0.35)";
      }
      ctx.fill();
      if (isHero) {
        ctx.strokeStyle = "#ffd54a";
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      const sprite = this.troopSprites[t.type + ":" + t.owner];
      if (sprite && sprite.ready) {
        const d = sprite.drawable;
        const iw = d.naturalWidth || d.width;
        const ih = d.naturalHeight || d.height;
        const scale = Math.min(boxSize / iw, boxSize / ih);
        const dw = iw * scale;
        const dh = ih * scale;
        if (inactive) ctx.globalAlpha = 0.45;
        ctx.drawImage(d, cx - dw / 2, cy - dh / 2, dw, dh);
        if (inactive) ctx.globalAlpha = 1.0;
      } else {
        // Fallback: colored circle (sprite not loaded / failed)
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = this.troopColors[t.owner] || "#aaa";
        if (inactive) ctx.globalAlpha = 0.45;
        ctx.fill();
        if (inactive) ctx.globalAlpha = 1.0;
        ctx.strokeStyle = "#fff";
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      // HP bar — heroes get a wider bar so the bigger HP pool reads clearly.
      const hpFrac = t.hp / t.maxHP;
      const barHalf = isHero ? auraR : r;
      const barY = cy + (isHero ? ts * 0.75 : ts * 0.5) + 2;
      const barH = isHero ? 3 : 2;
      ctx.fillStyle = "#333";
      ctx.fillRect(cx - barHalf, barY, barHalf * 2, barH);
      ctx.fillStyle = hpFrac > 0.5 ? "#4caf50" : "#f44336";
      ctx.fillRect(cx - barHalf, barY, barHalf * 2 * hpFrac, barH);

      // Heroes: print current HP centered below the bar so the player can
      // read it during combat. Incoming damage shows via floating popups.
      if (isHero) {
        const hpLabel = Math.ceil(t.hp);
        const hpY = barY + barH + 1;
        ctx.font = "bold " + Math.round(ts * 0.28) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle = "#000";
        ctx.fillText(hpLabel, cx + 1, hpY + 1);
        ctx.fillStyle = "#fff";
        ctx.fillText(hpLabel, cx, hpY);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }

      // Activation indicator: arc + numeric countdown, owner-colored.
      if (inactive && t.activationDuration > 0) {
        const frac = Math.max(0, Math.min(1, t.activationTime / t.activationDuration));
        const arcRadius = ts * 0.55;
        ctx.beginPath();
        ctx.arc(cx, cy, arcRadius, -Math.PI / 2, -Math.PI / 2 + (1 - frac) * Math.PI * 2);
        ctx.strokeStyle = t.owner === "player1" ? "#66aaff" : "#ff6666";
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.font = "bold 11px monospace";
        ctx.fillStyle = "#fff";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = t.activationTime.toFixed(1);
        ctx.strokeText(label, cx, cy);
        ctx.fillText(label, cx, cy);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
    }
  }

  /**
   * Draw floating damage popups spawned by applyDamage. Each popup rises
   * ~1.5 tiles and fades to alpha 0 over its 1-second TTL. The GC pass in
   * troopSystem.update removes expired entries, so we just render whatever's
   * still in the array.
   */
  drawDamagePopups(gs) {
    if (!gs.damagePopups || gs.damagePopups.length === 0) return;
    const { ctx } = this;
    const ts = gs.tileSize;
    const now = (typeof performance !== "undefined" ? performance.now() : Date.now()) / 1000;
    const ttl = 1.0;

    ctx.save();
    ctx.font = "bold " + Math.round(ts * 0.32) + "px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const p of gs.damagePopups) {
      const age = now - p.spawnTime;
      if (age < 0 || age > ttl) continue;
      const x = (p.col + 0.5) * ts;
      const y = (p.row + 0.5) * ts - age * ts * 1.5;
      const label = "-" + (Math.round(p.dmg * 10) / 10);
      ctx.globalAlpha = Math.max(0, 1 - age / ttl);
      ctx.fillStyle = "#000";
      ctx.fillText(label, x + 1, y + 1);
      ctx.fillStyle = "#ff5050";
      ctx.fillText(label, x, y);
    }
    ctx.restore();
  }

  /** Draw every persistent strategem entity by type. */
  drawStrategems(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;
    if (!gs.strategems || !gs.strategems.length) return;

    for (const s of gs.strategems) {
      const cx = (s.col + 0.5) * ts;
      const cy = (s.row + 0.5) * ts;
      switch (s.type) {
        case "heal": {
          // Pulse: brighter on age phases 0.0-0.5 / 2.0-2.5 / 4.0-4.5 / 6.0-6.5
          const phase = s.age % 2;
          const onPhase = phase < 1;
          const pulse = onPhase ? (0.35 + 0.25 * Math.sin(phase * Math.PI * 4)) : 0.18;
          ctx.beginPath();
          ctx.arc(cx, cy, 3 * ts, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(124, 255, 124, ${pulse})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(80, 200, 80, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          break;
        }
        case "blizzard": {
          ctx.beginPath();
          ctx.arc(cx, cy, 5 * ts, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(160, 216, 255, 0.22)";
          ctx.fill();
          ctx.strokeStyle = "rgba(120, 180, 240, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          break;
        }
        case "divineWind": {
          const len = 8 * ts, wid = 4 * ts;
          const ang = Math.atan2(s.dirRow, s.dirCol);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          ctx.fillStyle = "rgba(160, 224, 255, 0.22)";
          ctx.fillRect(-len / 2, -wid / 2, len, wid);
          ctx.strokeStyle = "rgba(110, 170, 220, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-len / 2, -wid / 2, len, wid);
          // Arrow indicating direction
          ctx.fillStyle = "rgba(255,255,255,0.85)";
          ctx.beginPath();
          ctx.moveTo(len / 2 - 8, -6);
          ctx.lineTo(len / 2, 0);
          ctx.lineTo(len / 2 - 8, 6);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
          break;
        }
        case "blast": {
          // 0.5s flash, fading
          const a = 1 - s.age / s.duration;
          ctx.fillStyle = `rgba(255, 220, 80, ${0.7 * a})`;
          ctx.fillRect((s.col - 1) * ts, (s.row - 1) * ts, 3 * ts, 3 * ts);
          ctx.strokeStyle = `rgba(255, 160, 0, ${a})`;
          ctx.lineWidth = 3;
          ctx.strokeRect(s.col * ts, s.row * ts, ts, ts);
          break;
        }
      }
    }
  }

  /**
   * Two dashed rings per troop:
   *   • inner  — attack range (bright, big dashes)
   *   • outer  — vision (faint, sparse dots) — drawn only when vision > range
   * Skipped entirely for range-0/vision-0 utility units (e.g. settler).
   */
  drawRangeRings(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;

    // Outer pass: vision rings (faint dotted)
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1;
    for (const t of gs.troops) {
      const v = t.vision || 0;
      const r = t.range || 0;
      if (v <= 0 || v <= r) continue;
      const cx = (t.col + 0.5) * ts;
      const cy = (t.row + 0.5) * ts;
      ctx.strokeStyle = t.owner === "player1"
        ? "rgba(120,200,255,0.35)"
        : "rgba(255,140,140,0.35)";
      ctx.beginPath();
      ctx.arc(cx, cy, v * ts, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Inner pass: attack range rings (bright dashed)
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = 2;
    for (const t of gs.troops) {
      if (!t.range || t.range <= 0) continue;
      const cx = (t.col + 0.5) * ts;
      const cy = (t.row + 0.5) * ts;
      ctx.strokeStyle = t.owner === "player1"
        ? "rgba(120,200,255,0.85)"
        : "rgba(255,140,140,0.85)";
      ctx.beginPath();
      ctx.arc(cx, cy, t.range * ts, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
  }

  /**
   * Dashed line from each attacker to its enemy-troop target. Two states:
   *   • bright (fades from full alpha) for ~150 ms after an attack actually fires
   *   • faint (alpha ~0.22) while the troop just has a target in range
   * troopSystem stamps `lastTarget` every frame and `attackFlashUntil` only on
   * an attack tick.
   */
  drawTargetingLines(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;
    const now = performance.now() / 1000;
    const FLASH = 0.15; // seconds, must match troopSystem

    ctx.setLineDash([6, 4]);
    ctx.lineWidth = 2;
    for (const troop of gs.troops) {
      const flashing = troop.attackFlashUntil && troop.attackFlashUntil > now;
      const tgt = flashing ? troop.attackFlashTarget : troop.lastTarget;
      if (!tgt) continue;
      // Skip stale targets (already removed from world)
      const isTroopTgt = gs.troops.includes(tgt);
      const isBldgTgt  = gs.buildings.includes(tgt);
      if (!isTroopTgt && !isBldgTgt) continue;

      const alpha = flashing
        ? Math.max(0, Math.min(1, (troop.attackFlashUntil - now) / FLASH))
        : 0.22;
      const ax = (troop.col + 0.5) * ts;
      const ay = (troop.row + 0.5) * ts;
      const bx = isBldgTgt ? (tgt.col + (tgt.width  || 1) / 2) * ts
                           : (tgt.col + 0.5) * ts;
      const by = isBldgTgt ? (tgt.row + (tgt.height || 1) / 2) * ts
                           : (tgt.row + 0.5) * ts;
      ctx.strokeStyle = troop.owner === "player1"
        ? `rgba(51,153,255,${alpha})`
        : `rgba(255,68,68,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }

    // Tower turrets: same dashed-line pattern (faint while tracking, bright on attack)
    for (const b of gs.buildings) {
      if (b.type !== "towerTurret") continue;
      const flashing = b.attackFlashUntil && b.attackFlashUntil > now;
      const tgt = flashing ? b.attackFlashTarget : b.lastTarget;
      if (!tgt) continue;
      if (!gs.troops.includes(tgt)) continue; // turrets only ever target troops

      const alpha = flashing
        ? Math.max(0, Math.min(1, (b.attackFlashUntil - now) / FLASH))
        : 0.22;
      const ax = (b.col + (b.width  || 1) / 2) * ts;
      const ay = (b.row + (b.height || 1) / 2) * ts;
      const bx = (tgt.col + 0.5) * ts;
      const by = (tgt.row + 0.5) * ts;
      ctx.strokeStyle = b.owner === "player1"
        ? `rgba(51,153,255,${alpha})`
        : `rgba(255,68,68,${alpha})`;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /**
   * Ghost preview of whatever placement mode is active at the cursor tile.
   * Reads from uiState (`spawnMode`, `buildMode`, `strategemMode`,
   * `pendingStrategem`, `cursorCol`/`cursorRow`).
   */
  _drawCursorPreview(gs) {
    const ui = window.gameSetupResult && window.gameSetupResult.uiState;
    if (!ui) return;
    const c = ui.cursorCol, r = ui.cursorRow;
    if (c == null || r == null) return;
    const ts = gs.tileSize;
    const { ctx } = this;
    const cx = (c + 0.5) * ts;
    const cy = (r + 0.5) * ts;

    if (ui.spawnMode) {
      // Eligibility + activation rule come from uiState so the cursor stays in
      // lockstep with what _trySpawnTroop actually accepts.
      const elig = ui.getSpawnEligibility(c, r, ui.spawnMode.owner, ui.spawnMode.troopType);
      const ok = elig.zoneOK && elig.affordOK;
      // Three states: green (spawn, instant) | amber (spawn, delayed) | red (no).
      const state = !ok ? "no" : elig.instant ? "instant" : "delayed";
      const palette = {
        instant: { fill: "rgba(80,220,120,0.22)", line: "rgba(80,220,120,0.95)" },
        delayed: { fill: "rgba(255,180,60,0.22)", line: "rgba(255,180,60,0.95)" },
        no:      { fill: "rgba(240,80,80,0.22)",  line: "rgba(240,80,80,0.95)" },
      }[state];

      ctx.fillStyle = palette.fill;
      ctx.fillRect(c * ts, r * ts, ts, ts);
      ctx.strokeStyle = palette.line;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(c * ts, r * ts, ts, ts);
      ctx.setLineDash([]);

      if (state === "no") {
        // Diagonal slash for the "forbidden" reading even at a glance.
        ctx.beginPath();
        ctx.moveTo(c * ts + 4, r * ts + 4);
        ctx.lineTo((c + 1) * ts - 4, (r + 1) * ts - 4);
        ctx.strokeStyle = palette.line;
        ctx.lineWidth = 2;
        ctx.stroke();
      } else if (state === "delayed") {
        // Small "1.2s" tag in the corner so the player sees the activation cost.
        ctx.font = "bold 10px monospace";
        ctx.fillStyle = "#ffd060";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const label = "1.2s";
        ctx.strokeText(label, (c + 0.5) * ts, (r + 0.5) * ts);
        ctx.fillText(label, (c + 0.5) * ts, (r + 0.5) * ts);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
      return;
    }

    if (ui.buildMode) {
      const def = (this.gameLogic || (window.gameSetupResult && window.gameSetupResult.gameLogic.buildingTypes));
      const bDef = (window.gameSetupResult.gameLogic.buildingTypes || {})[ui.buildMode.buildingType] || {};
      const w = (bDef.width || 1), h = (bDef.height || 1);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(c * ts, r * ts, w * ts, h * ts);
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(c * ts, r * ts, w * ts, h * ts);
      ctx.setLineDash([]);
      return;
    }

    if (ui.strategemMode) {
      const sDef = (window.gameSetupResult.gameLogic.strategemTypes || {})[ui.strategemMode.strategemType] || {};
      const owner = ui.strategemMode.owner;
      switch (ui.strategemMode.strategemType) {
        case "heal":
        case "blizzard": {
          const radius = (sDef.radius || 3) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = ui.strategemMode.strategemType === "heal"
            ? "rgba(124,255,124,0.18)" : "rgba(160,216,255,0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "blast": {
          ctx.fillStyle = "rgba(255,220,80,0.18)";
          ctx.fillRect((c - 1) * ts, (r - 1) * ts, 3 * ts, 3 * ts);
          ctx.strokeStyle = "rgba(255,200,40,0.7)";
          ctx.setLineDash([5, 3]);
          ctx.strokeRect(c * ts, r * ts, ts, ts);
          ctx.setLineDash([]);
          break;
        }
        case "divineWind": {
          // If center pending, show the rectangle pointed at the cursor.
          // Otherwise show a small "click for center" indicator.
          if (ui.pendingStrategem && ui.pendingStrategem.strategemType === "divineWind") {
            const ccol = ui.pendingStrategem.col, crow = ui.pendingStrategem.row;
            const ccx = (ccol + 0.5) * ts, ccy = (crow + 0.5) * ts;
            const dCol = c - ccol, dRow = r - crow;
            const ang = Math.atan2(dRow || 0, dCol || (owner === "player1" ? 1 : -1));
            const len = (sDef.length || 8) * ts;
            const wid = (sDef.width || 4) * ts;
            ctx.save();
            ctx.translate(ccx, ccy);
            ctx.rotate(ang);
            ctx.fillStyle = "rgba(160,224,255,0.18)";
            ctx.fillRect(-len / 2, -wid / 2, len, wid);
            ctx.strokeStyle = "rgba(255,255,255,0.6)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([5, 3]);
            ctx.strokeRect(-len / 2, -wid / 2, len, wid);
            ctx.setLineDash([]);
            ctx.restore();
          } else {
            // Indicator at cursor
            ctx.strokeStyle = "rgba(160,224,255,0.8)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(c * ts, r * ts, ts, ts);
            ctx.setLineDash([]);
          }
          break;
        }
      }
    }
  }
}

// Export for browser
window.Renderer = Renderer;
