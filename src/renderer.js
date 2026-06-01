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
  bannerman:    { player1: "Blue_Bannerman.png", player2: "Red_Bannerman.png" },
  gustKnight:   { player1: "Blue_GustKnight.png", player2: "Red_GustKnight.png" },
  skeleton:     { player1: "Blue_Skeleton.png", player2: "Red_Skeleton.png" },
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
      wall:            "#888888",
      farm:            "#6b8e23",
      cannon:          "#5a3a2a",
      bunker:          "#4a4a4a",
      supplyDepot:     "#c08040",
      warBonesFactory: "#dcdcdc",
      chillTurret:     "#a0d8ff",
      lavaMortar:      "#cc3300",
      towerTurret:     "#5a6578",
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
      this._drawStrategemCooldowns(gs);

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

      // Attack cooldown bar for attack-capable buildings (Cannon, Chill
      // Turret, Lava Mortar, Tower Turret). Sits immediately above the HP
      // bar. Skipped for Wall / Farm / Bunker / Supply Depot / War Bones
      // Factory (no attackCooldown on their def).
      const bDef = (window.buildingTypes || {})[b.type];
      if (bDef && bDef.attackCooldown != null) {
        const cdH = 2;
        const cdY = y - 5 - cdH - 1;
        const cdFrac = Math.max(0, Math.min(1, (b.attackTimer || 0) / bDef.attackCooldown));
        ctx.fillStyle = "#333";
        ctx.fillRect(x, cdY, w, cdH);
        const ready = cdFrac >= 1;
        ctx.fillStyle = ready ? "#ffe082" : "#ffb74d";
        ctx.fillRect(x, cdY, w * cdFrac, cdH);
        if (ready) {
          ctx.strokeStyle = "rgba(255, 240, 180, 0.9)";
          ctx.lineWidth = 1;
          ctx.strokeRect(x, cdY, w, cdH);
        }
      }

      // Bunker garrison slots: two stacked dots, colored by occupant troop
      // type so the player can read at a glance who's inside. Empty slots
      // show as a dim well. Sits inside the 1x2 footprint (one dot per row).
      if (b.type === "bunker") {
        const slotColors = {
          archer: "#f0e090",
          sentinel: "#a0d8a0",
        };
        const dotR = ts * 0.18;
        const slots = (window.buildingTypes && window.buildingTypes.bunker && window.buildingTypes.bunker.garrisonSlots) || 2;
        for (let i = 0; i < slots; i++) {
          const dotX = x + w / 2;
          const dotY = y + ts * (0.5 + i);
          const occ = b.occupants && b.occupants[i];
          ctx.beginPath();
          ctx.arc(dotX, dotY, dotR, 0, Math.PI * 2);
          ctx.fillStyle = occ ? (slotColors[occ.type] || "#cccccc") : "#1f1f1f";
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

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
      // Garrisoned troops live "inside" their bunker — the bunker's slot dots
      // represent them. Teleporting troops are out of phase entirely.
      // Skip the entire on-field render block in either case. Cloaked
      // (Strategia's Ambush) is also `invisible: true` but renders translucent
      // so the player can still see the silhouette as it moves.
      if (t.garrisonedIn) continue;
      if (t.invisible && !t.cloakActive) continue;
      const cloakAlpha = (t.invisible && t.cloakActive) ? 0.35 : 1.0;
      ctx.save();
      ctx.globalAlpha = cloakAlpha;
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

      // Chill stack visual: blue ring whose alpha scales with stack count.
      // Frozen troops get a saturated white-blue overlay during the 1s freeze.
      const now = performance.now() / 1000;
      const frozen = t.frozenUntil && t.frozenUntil > now;
      const stacks = t.chillStacks || 0;
      if (stacks > 0 || frozen) {
        const ringR = auraR * 1.05;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        if (frozen) {
          ctx.strokeStyle = "rgba(220, 240, 255, 0.95)";
          ctx.lineWidth = 3;
        } else {
          ctx.strokeStyle = `rgba(120, 200, 255, ${Math.min(1, 0.25 + stacks / 80 * 0.75)})`;
          ctx.lineWidth = 2;
        }
        ctx.stroke();
      }

      // Berserker active visual: pulsing red ring that throbs at ~6 Hz and
      // dims as the buff expires, so the player can read both "is berserk"
      // and "for how much longer" at a glance.
      if (t.berserkerUntil && t.berserkerUntil > now) {
        const remaining = t.berserkerUntil - now;
        const fade = Math.min(1, remaining / 0.4);
        const pulse = 0.7 + 0.3 * Math.sin(now * 12);
        const ringR = auraR * 1.18;
        ctx.beginPath();
        ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 60, 40, ${fade * pulse})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(cx, cy, ringR * 0.92, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255, 180, 60, ${fade * pulse * 0.6})`;
        ctx.lineWidth = 1.5;
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

      // Attack cooldown bar — sits immediately above the HP bar. Fills as
      // attackTimer climbs to attackInterval; brightens when ready to fire.
      // chill/haste/slow mirror troopSystem so the bar fills at the actual
      // attack rate. Skipped for utility units (Settler).
      if (t.attackSpeed > 0) {
        const cdY = barY - barH - 1;
        const slowedT = t.slowUntil  && t.slowUntil  > now;
        const hastedT = t.hasteUntil && t.hasteUntil > now;
        const berserkT = t.berserkerUntil && t.berserkerUntil > now;
        const slowAtkT  = slowedT ? (t.slowAttackFactor  || 1) : 1;
        const hasteAtkT = hastedT ? (t.hasteAttackFactor || 1) : 1;
        const berserkAtkT = berserkT ? (t.berserkerAttackFactor || 1) : 1;
        const chillMul = Math.max(0.2, 1 - 0.01 * (t.chillStacks || 0));
        const attackInterval = 1 / (t.attackSpeed * slowAtkT * hasteAtkT * chillMul * berserkAtkT);
        const cdFrac = Math.max(0, Math.min(1, (t.attackTimer || 0) / attackInterval));
        ctx.fillStyle = "#333";
        ctx.fillRect(cx - barHalf, cdY, barHalf * 2, barH);
        const ready = cdFrac >= 1;
        ctx.fillStyle = ready ? "#ffe082" : "#ffb74d";
        ctx.fillRect(cx - barHalf, cdY, barHalf * 2 * cdFrac, barH);
        if (ready) {
          ctx.strokeStyle = "rgba(255, 240, 180, 0.9)";
          ctx.lineWidth = 1;
          ctx.strokeRect(cx - barHalf, cdY, barHalf * 2, barH);
        }
      }

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

      // Chill stack count: numeric label above the aura. Shown when chilled
      // or frozen so the player can read the exact stack count (the ring
      // already shows the ambient signal; this gives them the precise value).
      if (stacks > 0 || frozen) {
        const labelY = cy - auraR - 4;
        const chillLabel = "❄" + stacks;
        ctx.font = "bold " + Math.round(ts * 0.28) + "px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.strokeStyle = "rgba(0,0,0,0.85)";
        ctx.lineWidth = 3;
        ctx.strokeText(chillLabel, cx, labelY);
        ctx.fillStyle = frozen ? "#e0f4ff" : "#88ccff";
        ctx.fillText(chillLabel, cx, labelY);
        ctx.textAlign = "start";
        ctx.textBaseline = "alphabetic";
      }
      ctx.restore();
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
      const label = p.label != null ? p.label : "-" + (Math.round(p.dmg * 10) / 10);
      ctx.globalAlpha = Math.max(0, 1 - age / ttl);
      ctx.fillStyle = "#000";
      ctx.fillText(label, x + 1, y + 1);
      ctx.fillStyle = p.color || "#ff5050";
      ctx.fillText(label, x, y);
    }
    ctx.restore();
  }

  /** Draw every persistent strategem entity by type. */
  drawStrategems(gs) {
    const { ctx } = this;
    const ts = gs.tileSize;
    if (!gs.strategems || !gs.strategems.length) return;
    const defs = (window.strategemTypes || {});

    for (const s of gs.strategems) {
      const cx = (s.col + 0.5) * ts;
      const cy = (s.row + 0.5) * ts;
      const def = defs[s.type] || {};
      switch (s.type) {
        case "heal": {
          // Pulse on the 7 heal-pulse ages (every 0.5s for 3.5s).
          const phase = (s.age * 2) % 1;
          const pulse = 0.32 + 0.22 * Math.cos(phase * Math.PI * 2);
          const r = (def.radius || 3) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(124, 255, 124, ${pulse * 0.5})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(80, 200, 80, 0.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          break;
        }
        case "wind": {
          const len = (def.length || 8) * ts;
          const wid = (def.width  || 4) * ts;
          const ang = Math.atan2(s.dirRow, s.dirCol);
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(ang);
          ctx.fillStyle = "rgba(160, 224, 255, 0.22)";
          ctx.fillRect(-len / 2, -wid / 2, len, wid);
          ctx.strokeStyle = "rgba(110, 170, 220, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.strokeRect(-len / 2, -wid / 2, len, wid);
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
        case "necromancy": {
          const r = (def.radius || 6) * ts;
          // Dim greenish-purple disk + faint swirling ring.
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(70, 30, 90, 0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(160, 100, 200, 0.55)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // Tombstone glyph at center.
          const tw = ts * 0.55, th = ts * 0.85;
          ctx.fillStyle = "rgba(60, 60, 70, 0.95)";
          ctx.beginPath();
          ctx.moveTo(cx - tw / 2, cy + th / 2);
          ctx.lineTo(cx - tw / 2, cy - th / 3);
          ctx.quadraticCurveTo(cx - tw / 2, cy - th / 2, cx, cy - th / 2);
          ctx.quadraticCurveTo(cx + tw / 2, cy - th / 2, cx + tw / 2, cy - th / 3);
          ctx.lineTo(cx + tw / 2, cy + th / 2);
          ctx.closePath();
          ctx.fill();
          ctx.strokeStyle = "rgba(0,0,0,0.85)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          // RIP marker.
          ctx.font = "bold " + Math.round(ts * 0.22) + "px serif";
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillStyle = "rgba(200, 200, 220, 0.9)";
          ctx.fillText("R.I.P", cx, cy - th / 8);
          ctx.textAlign = "start";
          ctx.textBaseline = "alphabetic";
          break;
        }
        case "ruin": {
          const r = (def.radius || 1.5) * ts;
          const at = def.activationTime != null ? def.activationTime : 4;
          const frac = Math.min(1, s.age / at);
          // Ramp red intensity as the strike approaches; final 0.25s flashes.
          const flashing = s.age >= at - 0.25;
          const fill = flashing
            ? `rgba(255, 80, 40, ${0.45 + 0.25 * Math.sin(s.age * 30)})`
            : `rgba(180, 80, 40, ${0.12 + 0.25 * frac})`;
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ctx.strokeStyle = flashing ? "rgba(255, 220, 80, 0.95)" : `rgba(200, 120, 60, ${0.5 + 0.5 * frac})`;
          ctx.lineWidth = 2;
          ctx.stroke();
          // Crosshair so the cast tile reads precisely.
          ctx.strokeStyle = "rgba(255, 220, 200, 0.7)";
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(cx - r, cy); ctx.lineTo(cx + r, cy);
          ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r);
          ctx.stroke();
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
        case "chainLightning": {
          // Hot-pink ring marker that subtly pulses.
          const ringR = ts * 0.4 * (1 + 0.08 * Math.sin(s.age * 6));
          ctx.beginPath();
          ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(255, 64, 192, 0.95)";
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = "rgba(255, 64, 192, 0.18)";
          ctx.fill();
          // Polyline through the most recent strike's victims, fading over 0.3s.
          if (s.lastHits && s.lastHits.length && s.lastHitsAge < 0.3) {
            const a = 1 - (s.lastHitsAge / 0.3);
            ctx.save();
            ctx.strokeStyle = `rgba(255, 96, 220, ${a})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            const sx = (s.col + 0.5) * ts;
            const sy = (s.row + 0.5) * ts;
            ctx.moveTo(sx, sy);
            for (const [hc, hr] of s.lastHits) {
              ctx.lineTo((hc + 0.5) * ts, (hr + 0.5) * ts);
            }
            ctx.stroke();
            ctx.restore();
          }
          break;
        }
        case "gravityField": {
          const r = (def.radius || 4) * ts;
          // Three concentric rings rotating, getting tighter toward center.
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(s.age * 1.2);
          ctx.fillStyle = "rgba(40, 60, 120, 0.20)";
          ctx.beginPath();
          ctx.arc(0, 0, r, 0, Math.PI * 2);
          ctx.fill();
          for (let i = 0; i < 3; i++) {
            const rr = r * (0.85 - i * 0.25);
            ctx.strokeStyle = `rgba(120, 160, 255, ${0.5 - i * 0.12})`;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(0, 0, rr, 0, Math.PI * 2);
            ctx.stroke();
          }
          // Dark singularity point.
          ctx.fillStyle = "rgba(0,0,0,0.85)";
          ctx.beginPath();
          ctx.arc(0, 0, ts * 0.12, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          break;
        }
        case "lesserTeleport":
        case "greaterTeleport": {
          this._drawTeleportRunes(gs, s, def, s.type === "greaterTeleport" ? (def.zoneRadius || 1) : 0);
          break;
        }
        case "chronoHaste":
        case "chronoSlow":
        case "chronoStop": {
          this._drawChronoClock(gs, s, def);
          break;
        }
        case "_heroBurst": {
          // Transient flash spawned by a hero ability cast. Radial glow that
          // expands and fades over the 0.4s lifetime. Color carries the
          // ability identity (Brick=amber, Strategia=violet).
          const frac = Math.min(1, s.age / (s.duration || 0.4));
          const r = ((s.radius || 1) + 0.5) * ts * (0.4 + 0.9 * frac);
          const alpha = 1 - frac;
          ctx.save();
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          const col = s.color || "#ffb050";
          const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
          grad.addColorStop(0, this._hexWithAlpha(col, 0.85 * alpha));
          grad.addColorStop(1, this._hexWithAlpha(col, 0));
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.strokeStyle = this._hexWithAlpha(col, 0.9 * alpha);
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.restore();
          break;
        }
        case "burningPatch": {
          // Lingering fire AoE from Lava Mortar. Pulsing inner glow + ring.
          const bpDef = (window.strategemTypes && window.strategemTypes.burningPatch) || {};
          const r = (s.radius != null ? s.radius : (bpDef.radius || 2)) * ts;
          const pulse = 0.55 + 0.20 * Math.sin(s.age * 6);
          ctx.beginPath();
          ctx.arc(cx, cy, r, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 96, 32, ${0.22 * pulse})`;
          ctx.fill();
          ctx.strokeStyle = "rgba(255, 160, 60, 0.8)";
          ctx.lineWidth = 1.5;
          ctx.stroke();
          break;
        }
      }
    }
  }

  /**
   * Teleport visual: a fading-in rune at the start (or 3×3 of runes) that
   * brightens as activationTime approaches, then a brightening rune at the
   * end during the appear delay, then a brief beam at arrival.
   */
  _drawTeleportRunes(gs, s, def, zoneRadius) {
    const { ctx } = this;
    const ts = gs.tileSize;
    const at = def.activationTime != null ? def.activationTime : 4;
    const appear = at + (def.appearDelay != null ? def.appearDelay : 0.5);

    const drawRune = (centerCol, centerRow, alpha, accent) => {
      const rx = (centerCol + 0.5) * ts;
      const ry = (centerRow + 0.5) * ts;
      const r = ts * 0.4;
      ctx.save();
      ctx.translate(rx, ry);
      ctx.rotate(s.age * 1.5);
      ctx.strokeStyle = `rgba(180, 100, 255, ${alpha * 0.95})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
      // Inner spokes
      ctx.strokeStyle = `rgba(220, 160, 255, ${alpha * 0.85})`;
      for (let k = 0; k < 6; k++) {
        const a = (k * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * r * 0.35, Math.sin(a) * r * 0.35);
        ctx.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
        ctx.stroke();
      }
      if (accent) {
        ctx.fillStyle = `rgba(255, 220, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    const drawZone = (cc, rr, alpha, accent) => {
      for (let dr = -zoneRadius; dr <= zoneRadius; dr++) {
        for (let dc = -zoneRadius; dc <= zoneRadius; dc++) {
          drawRune(cc + dc, rr + dr, alpha, accent);
        }
      }
    };

    // Start side: alpha ramps 0 → 1 across the 0..at window, holds until appear.
    let startAlpha;
    if (s.age < at) startAlpha = Math.min(1, s.age / at);
    else if (s.age < appear) startAlpha = 1.0 - (s.age - at) / (appear - at);
    else startAlpha = 0;
    if (startAlpha > 0.02) drawZone(s.startCol, s.startRow, startAlpha, false);

    // End side: faint while arming, brightens 0 → 1 during 4..4.5, then briefly bright.
    let endAlpha;
    if (s.age < at) endAlpha = 0.2;
    else if (s.age < appear) endAlpha = 0.2 + 0.8 * ((s.age - at) / (appear - at));
    else endAlpha = Math.max(0, 1 - (s.age - appear) / 0.4);
    if (endAlpha > 0.02) drawZone(s.endCol, s.endRow, endAlpha, s.age >= appear - 0.1);

    // Brief beam at arrival.
    if (s.age >= appear - 0.1 && s.age < appear + 0.4) {
      const a = Math.max(0, 1 - (s.age - appear) / 0.5);
      const sx = (s.startCol + 0.5) * ts;
      const sy = (s.startRow + 0.5) * ts;
      const ex = (s.endCol + 0.5) * ts;
      const ey = (s.endRow + 0.5) * ts;
      ctx.strokeStyle = `rgba(220, 160, 255, ${a * 0.9})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(ex, ey);
      ctx.stroke();
    }
  }

  /** Convert "#rrggbb" + alpha → "rgba(r, g, b, a)" for canvas styles. */
  _hexWithAlpha(hex, alpha) {
    if (!hex || hex[0] !== "#" || hex.length !== 7) return `rgba(255,255,255,${alpha})`;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }

  /**
   * Chronomancy clock-face zone visual. Shared between Haste (gold, hands
   * spinning fast clockwise), Slow (cyan, slow counter-clockwise), and Stop
   * (violet, hands locked at 12 with a brief flash on each pulse).
   */
  _drawChronoClock(gs, s, def) {
    const { ctx } = this;
    const ts = gs.tileSize;
    const cx = (s.col + 0.5) * ts;
    const cy = (s.row + 0.5) * ts;
    const r = (def.radius || 2) * ts;

    let bodyFill, ringStroke, handStroke, handAngle, flash;
    if (s.type === "chronoHaste") {
      bodyFill   = "rgba(255, 217, 90, 0.18)";
      ringStroke = "rgba(255, 200, 80, 0.85)";
      handStroke = "rgba(255, 240, 180, 0.95)";
      handAngle  = s.age * 6; // fast clockwise
    } else if (s.type === "chronoSlow") {
      bodyFill   = "rgba(96, 192, 255, 0.18)";
      ringStroke = "rgba(96, 192, 255, 0.85)";
      handStroke = "rgba(220, 240, 255, 0.95)";
      handAngle  = -s.age * 0.6; // slow counter-clockwise
    } else {
      bodyFill   = "rgba(192, 96, 255, 0.18)";
      ringStroke = "rgba(192, 96, 255, 0.85)";
      handStroke = "rgba(240, 220, 255, 0.95)";
      handAngle  = 0; // frozen at 12
      const pulse = def.pulseInterval || 0.5;
      const sinceLast = (s.age % pulse);
      // Flash for first 0.15s of each pulse window.
      flash = sinceLast < 0.15 ? (1 - sinceLast / 0.15) : 0;
    }

    // Disk body.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = bodyFill;
    ctx.fill();
    ctx.strokeStyle = ringStroke;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Stop pulse flash overlay.
    if (flash) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 220, 255, ${0.35 * flash})`;
      ctx.fill();
    }

    // Clock face inside the zone (smaller, centered).
    const fr = Math.min(ts * 0.55, r * 0.45);
    ctx.beginPath();
    ctx.arc(cx, cy, fr, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20, 20, 30, 0.65)";
    ctx.fill();
    ctx.strokeStyle = handStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Hour ticks at 12/3/6/9.
    for (let k = 0; k < 4; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 2;
      const x1 = cx + Math.cos(a) * fr * 0.78;
      const y1 = cy + Math.sin(a) * fr * 0.78;
      const x2 = cx + Math.cos(a) * fr;
      const y2 = cy + Math.sin(a) * fr;
      ctx.strokeStyle = handStroke;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    // Hour hand (12 → 4 o'clock baseline) rotated by handAngle.
    const baseAng = -Math.PI / 2;
    const hourAng = baseAng + handAngle;
    const minAng  = baseAng + handAngle * 6;
    ctx.strokeStyle = handStroke;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(hourAng) * fr * 0.55, cy + Math.sin(hourAng) * fr * 0.55);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(minAng) * fr * 0.85, cy + Math.sin(minAng) * fr * 0.85);
    ctx.stroke();
  }

  /**
   * Update the radial cooldown overlay + numeric label on each strategem button.
   * Creates the overlay child div on first sight so neither game.js nor the
   * sandbox controls need to know about the overlay structure.
   */
  _drawStrategemCooldowns(gs) {
    if (!gs) return;
    const defs = window.strategemTypes || {};
    const abilityDefs = window.heroAbilityTypes || {};

    const paintOverlay = (btn, remaining, total) => {
      let overlay = btn.querySelector(".cd-overlay");
      if (!overlay) {
        if (getComputedStyle(btn).position === "static") btn.style.position = "relative";
        overlay = document.createElement("div");
        overlay.className = "cd-overlay";
        overlay.style.cssText =
          "position:absolute;inset:0;pointer-events:none;border-radius:inherit;" +
          "display:flex;align-items:center;justify-content:center;" +
          "font-family:monospace;font-weight:bold;font-size:13px;color:#fff;" +
          "text-shadow:0 0 3px #000;";
        btn.appendChild(overlay);
      }
      const onCD = remaining > 0;
      if (onCD) {
        const pct = Math.max(0, Math.min(100, (1 - remaining / total) * 100));
        overlay.style.background =
          `conic-gradient(transparent 0% ${pct}%, rgba(0,0,0,0.55) ${pct}% 100%)`;
        overlay.textContent = remaining >= 10
          ? String(Math.ceil(remaining))
          : remaining.toFixed(1);
        btn.classList.add("cd-active");
        btn.style.opacity = "0.75";
      } else {
        overlay.style.background = "transparent";
        overlay.textContent = "";
        btn.classList.remove("cd-active");
        btn.style.opacity = "";
      }
    };

    // Strategem buttons
    if (gs.strategemCooldowns) {
      const buttons = document.querySelectorAll("[data-strategem-type]");
      buttons.forEach((btn) => {
        const type = btn.getAttribute("data-strategem-type");
        const owner = btn.getAttribute("data-owner");
        const def = defs[type];
        if (!type || !owner || !def || def.cooldown == null) return;
        const remaining = (gs.strategemCooldowns[owner] && gs.strategemCooldowns[owner][type]) || 0;
        paintOverlay(btn, remaining, def.cooldown);
      });
    }

    // Hero ability buttons — keyed by [data-hero-ability-key], cooldown lookup
    // uses the bound `heroType` since the cooldown table is per-hero-type.
    if (gs.heroAbilityCooldowns) {
      const abilityButtons = document.querySelectorAll("[data-hero-ability-key]");
      abilityButtons.forEach((btn) => {
        const key = btn.getAttribute("data-hero-ability-key");
        const owner = btn.getAttribute("data-owner");
        const heroType = btn.getAttribute("data-hero-type");
        const def = abilityDefs[key];
        if (!key || !owner || !heroType || !def || def.cooldown == null) return;
        const remaining = (gs.heroAbilityCooldowns[owner] && gs.heroAbilityCooldowns[owner][heroType]) || 0;
        paintOverlay(btn, remaining, def.cooldown);
      });
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
      const type = ui.strategemMode.strategemType;
      switch (type) {
        case "heal": {
          const radius = (sDef.radius || 3) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(124,255,124,0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,255,255,0.6)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "necromancy": {
          const radius = (sDef.radius || 6) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(120, 60, 160, 0.16)";
          ctx.fill();
          ctx.strokeStyle = "rgba(200,150,255,0.7)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "ruin": {
          const radius = (sDef.radius || 1.5) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(200,80,40,0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,180,80,0.85)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "chainLightning": {
          const radius = (sDef.chainReach || 2.25) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(255,64,192,0.14)";
          ctx.fill();
          ctx.strokeStyle = "rgba(255,128,220,0.85)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "gravityField": {
          const radius = (sDef.radius || 4) * ts;
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = "rgba(60,80,160,0.18)";
          ctx.fill();
          ctx.strokeStyle = "rgba(140,170,255,0.85)";
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 3]);
          ctx.stroke();
          ctx.setLineDash([]);
          break;
        }
        case "chronoHaste":
        case "chronoSlow":
        case "chronoStop": {
          const radius = (sDef.radius || 2) * ts;
          const palette = type === "chronoHaste"
            ? { fill: "rgba(255,217,90,0.18)",  line: "rgba(255,200,80,0.85)" }
            : type === "chronoSlow"
            ? { fill: "rgba(96,192,255,0.18)",  line: "rgba(96,192,255,0.85)" }
            : { fill: "rgba(192,96,255,0.18)",  line: "rgba(192,96,255,0.85)" };
          ctx.beginPath();
          ctx.arc(cx, cy, radius, 0, Math.PI * 2);
          ctx.fillStyle = palette.fill;
          ctx.fill();
          ctx.strokeStyle = palette.line;
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
        case "wind": {
          // If start pending, show the rectangle pointed at the cursor.
          if (ui.pendingStrategem && ui.pendingStrategem.strategemType === "wind") {
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
            ctx.strokeStyle = "rgba(160,224,255,0.8)";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(c * ts, r * ts, ts, ts);
            ctx.setLineDash([]);
          }
          break;
        }
        case "lesserTeleport":
        case "greaterTeleport": {
          const zoneR = type === "greaterTeleport" ? (sDef.zoneRadius || 1) : 0;
          const drawTile = (cc, rr, stroke) => {
            ctx.strokeStyle = stroke;
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.strokeRect(cc * ts, rr * ts, ts, ts);
            ctx.setLineDash([]);
          };
          if (!ui.pendingStrategem || ui.pendingStrategem.strategemType !== type) {
            // First click: preview the start zone at cursor.
            for (let dr = -zoneR; dr <= zoneR; dr++) {
              for (let dc = -zoneR; dc <= zoneR; dc++) {
                drawTile(c + dc, r + dr, "rgba(180,100,255,0.85)");
              }
            }
          } else {
            // Pending: locked start zone + preview end zone at cursor.
            const sc = ui.pendingStrategem.col, sr = ui.pendingStrategem.row;
            for (let dr = -zoneR; dr <= zoneR; dr++) {
              for (let dc = -zoneR; dc <= zoneR; dc++) {
                drawTile(sc + dc, sr + dr, "rgba(180,100,255,0.85)");
                drawTile(c + dc, r + dr, "rgba(220,160,255,0.85)");
              }
            }
            const sx = (sc + 0.5) * ts, sy = (sr + 0.5) * ts;
            const ex = (c + 0.5) * ts, ey = (r + 0.5) * ts;
            ctx.strokeStyle = "rgba(220,160,255,0.6)";
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 4]);
            ctx.beginPath();
            ctx.moveTo(sx, sy);
            ctx.lineTo(ex, ey);
            ctx.stroke();
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
