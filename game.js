// ---------------------------
// Global Variables & Configuration
const rows = 12;
const cols = 14;
const tileSize = 50;
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");

let grid = []; // 2D array for map tiles
let troops = []; // Array for troop objects
let buildings = []; // Array for building objects

// Global sprite dictionary
const troopSprites = {
  swordsmanBlue: new Image(),
  swordsmanRed: new Image(),
  archerBlue: new Image(),
  archerRed: new Image(),
  heavyBlue: new Image(),
  heavyRed: new Image(),
  settlerBlue: new Image(),
  settlerRed: new Image(),
  militiaBlue: new Image(),
  militiaRed: new Image(),
  // If you add more troops later, store them here.
};

// Assign sprite sources (adjust the file paths if needed)
troopSprites.swordsmanBlue.src = "images/blueSwordsman.jpg";
troopSprites.swordsmanRed.src = "images/redSwordsman.jpg";
troopSprites.archerBlue.src = "images/blueArcher.jpg";
troopSprites.archerRed.src = "images/redArcher.jpg";
troopSprites.heavyBlue.src = "images/blueHeavy.jpg";
troopSprites.heavyRed.src = "images/redHeavy.jpg";
troopSprites.settlerBlue.src = "images/blueSettler.jpg";
troopSprites.settlerRed.src = "images/redSettler.jpg";
troopSprites.militiaBlue.src = "images/blueMilitia.jpg";
troopSprites.militiaRed.src = "images/redMilitia.jpg";

// New Global Variables for Strategems
let strategems = [];
let currentStrategem = null;
let strategemSpecter = null;

// ---------------------------
// Audio & Settings Initialization
//////////////////////////////////////

// Existing audio objects
const spawnSound = new Audio("sounds/spawnSound.mp3");
const swordsmanAttackSound = new Audio("sounds/swordsmanAttack.mp3");
const archerAttackSound = new Audio("sounds/archerAttack.mp3");
const heavyAttackSound = new Audio("sounds/heavyAttack.mp3");
const militiaAttackSound = new Audio("sounds/militiaAttack.mp3");
const swordsmanActivationSound = new Audio("sounds/swordsmanActivation.mp3");
const archerActivationSound = new Audio("sounds/archerActivation.mp3");
// const dasherActivationSound = new Audio("sounds/dasherActivationSound.mp3");
const heavyActivationSound = new Audio("sounds/heavyActivation.mp3");
const settlerActivationSound = new Audio("sounds/settlerActivation.mp3");
const militiaActivationSound = new Audio("sounds/militiaActivation.mp3");
const deathSound = new Audio("sounds/deathSound.mp3");

// Global settings defaults
let masterVolume = 0.5; // 50%
let sfxEnabled = true; // SFX on

function loadAudioSettings() {
  const savedVolume = localStorage.getItem("strategrid_masterVolume");
  const savedSfx = localStorage.getItem("strategrid_sfxEnabled");
  if (savedVolume !== null) {
    masterVolume = parseInt(savedVolume, 10) / 100;
  }
  if (savedSfx !== null) {
    sfxEnabled = savedSfx === "true";
  }
  applyAudioSettings();
}

function applyAudioSettings() {
  const finalVolume = sfxEnabled ? masterVolume : 0;
  spawnSound.volume = finalVolume;
  swordsmanAttackSound.volume = finalVolume;
  archerAttackSound.volume = finalVolume;
  heavyAttackSound.volume = finalVolume;
  militiaAttackSound.volume = finalVolume;
  swordsmanActivationSound.volume = finalVolume;
  archerActivationSound.volume = finalVolume;
  heavyActivationSound.volume = finalVolume;
  settlerActivationSound.volume = finalVolume;
  militiaActivationSound.volume = finalVolume;
  deathSound.volume = finalVolume;
}

function playSound(soundObj) {
  applyAudioSettings();
  soundObj.currentTime = 0;
  soundObj.play();
}

loadAudioSettings();

// Tower objects (each with 100 HP)
let tower1 = { owner: "player1", hp: 100, startRow: 2, endRow: 9, col: 0 };
tower1.row = (tower1.startRow + tower1.endRow) / 2;
let tower2 = {
  owner: "player2",
  hp: 100,
  startRow: 2,
  endRow: 9,
  col: cols - 1,
};
tower2.row = (tower2.startRow + tower2.endRow) / 2;

// Resource pools
let currentRP = { player1: 5, player2: 5 };
let currentTP = { player1: 2, player2: 2 };

// Modes
let currentMode = null;
let currentSpawn = null; // For spawn mode: { owner, type }
let currentBuild = null; // For build mode: { owner, type }

// Global variables for preview specters.
let spawnSpecter = null;
let buildSpecter = null;

// Phase management
let currentGamePhase = "";
const planningDuration = 20; // seconds per planning phase
const battlePhaseDuration = 5; // seconds for battle phase
let phaseStartTime = performance.now();
let battlePhaseActive = false;
let firstMover = "player1";
let paused = false;
let pauseStartTime = 0;

// (Legacy) March toggles (unused)
let marchMode = { player1: false, player2: false };

const pointerTipOffset = 10;

// ---------------------------
// Helper Functions for LOS, Pathfinding, & Collision
function bresenhamLine(r0, c0, r1, c1) {
  let cells = [];
  let dx = Math.abs(c1 - c0);
  let dy = Math.abs(r1 - r0);
  let sx = c0 < c1 ? 1 : -1;
  let sy = r0 < r1 ? 1 : -1;
  let err = dx - dy;
  while (true) {
    cells.push({ row: r0, col: c0 });
    if (r0 === r1 && c0 === c1) break;
    let e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      c0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      r0 += sy;
    }
  }
  return cells;
}

function hasClearLineOfSight(shooter, target) {
  let r0 = Math.floor(shooter.row),
    c0 = Math.floor(shooter.col);
  let r1 = Math.floor(target.row),
    c1 = Math.floor(target.col);
  let cells = bresenhamLine(r0, c0, r1, c1);
  let skipLast = target.typeAbbr !== undefined;
  for (let i = 1; i < cells.length - (skipLast ? 1 : 0); i++) {
    let cell = cells[i];
    let building = getBuildingAtTile(cell.row, cell.col);
    if (
      building &&
      building.type === "wall" &&
      building.owner !== shooter.owner
    )
      return false;
  }
  return true;
}

function findPathAvoidingEnemyWalls(sr, sc, tr, tc, owner) {
  let queue = [];
  let visited = new Set();
  queue.push({ row: sr, col: sc, path: [] });
  visited.add(sr + "," + sc);
  const directions = [
    { dr: -1, dc: 0 },
    { dr: 1, dc: 0 },
    { dr: 0, dc: -1 },
    { dr: 0, dc: 1 },
  ];
  while (queue.length > 0) {
    let state = queue.shift();
    if (state.row === tr && state.col === tc) return state.path;
    if (state.path.length >= 12) continue;
    for (let d of directions) {
      let nr = state.row + d.dr,
        nc = state.col + d.dc;
      let key = nr + "," + nc;
      if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
      let building = getBuildingAtTile(nr, nc);
      if (building && building.type === "wall" && building.owner !== owner)
        continue;
      if (!visited.has(key)) {
        visited.add(key);
        queue.push({
          row: nr,
          col: nc,
          path: state.path.concat([{ row: nr, col: nc }]),
        });
      }
    }
  }
  return null;
}

function distance(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

function getBlockingWall(troop, target) {
  let r0 = Math.floor(troop.row),
    c0 = Math.floor(troop.col);
  let r1 = Math.floor(target.row),
    c1 = Math.floor(target.col);
  let cells = bresenhamLine(r0, c0, r1, c1);
  let skipLast = target.typeAbbr !== undefined;
  for (let i = 1; i < cells.length - (skipLast ? 1 : 0); i++) {
    let cell = cells[i];
    let building = getBuildingAtTile(cell.row, cell.col);
    if (building && building.type === "wall" && building.owner !== troop.owner)
      return building;
  }
  return null;
}

function isTilePassableForTroop(owner, row, col) {
  let b = getBuildingAtTile(row, col);
  if (b && b.type === "wall" && b.owner !== owner) return false;
  return true;
}

// ---------------------------
// Building Definitions
const buildingTypes = {
  wall: {
    cost: 1,
    hp: 150,
    activationTime: 0,
    size: { width: 1, height: 1 },
    color: "#888",
  },
  farm: {
    cost: 2.5,
    hp: 50,
    activationTime: 3,
    size: { width: 2, height: 2 },
    rpBonus: 0.5,
    bonusInterval: 15,
    color: "#6b8e23",
  },
  archerTower: {
    cost: 8,
    hp: 80,
    activationTime: 5,
    size: { width: 2, height: 2 },
    maxArchers: 4,
    color: "#8a2be2",
  },
  warCamp: {
    cost: 5,
    hp: 60,
    activationTime: 2,
    size: { width: 2, height: 2 },
    influenceRadius: 3.5,
    buff: {
      moveSpeedMultiplier: 1.4,
      attackSpeedMultiplier: 1.4,
      healRate: 0.5,
      armorRegenRate: 3,
    },
    color: "#8b4513",
  },
};

// ---------------------------
// Helper: identify current planning player
function currentPlanningPlayer() {
  if (currentGamePhase === "planning_player1") return "player1";
  if (currentGamePhase === "planning_player2") return "player2";
  return null;
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    let p = currentPlanningPlayer();
    if (p) skipTurn(p);
  }
});

// Skip Turn Functionality
function skipTurn(player) {
  if (currentGamePhase === "planning_" + player) {
    phaseStartTime = performance.now() - planningDuration * 1000;
    updatePhaseDisplay();
  }
}

// ---------------------------
// Module 1: Map and Resources
function initializeTerritory() {
  grid = [];
  for (let row = 0; row < rows; row++) {
    let rowTiles = [];
    for (let col = 0; col < cols; col++) {
      let tile = {
        row,
        col,
        type: "normal",
        owner: "neutral",
        control: { player1: 0, player2: 0 },
      };
      if (col === 0) {
        if (row >= tower1.startRow && row <= tower1.endRow) {
          tile.type = "tower";
          tile.owner = "player1";
        } else tile.type = "blocked";
      } else if (col === cols - 1) {
        if (row >= tower2.startRow && row <= tower2.endRow) {
          tile.type = "tower";
          tile.owner = "player2";
        } else tile.type = "blocked";
      } else {
        if (col < 4) {
          tile.owner = "player1";
          tile.control.player1 = 1;
          tile.control.player2 = 0;
        } else if (col >= 10) {
          tile.owner = "player2";
          tile.control.player2 = 1;
          tile.control.player1 = 0;
        }
      }
      rowTiles.push(tile);
    }
    grid.push(rowTiles);
  }
}

// Returns tiles within 1 tile radius of a troop.
function getInfluencedTiles(troop) {
  let tiles = [];
  let baseRow = Math.floor(troop.row),
    baseCol = Math.floor(troop.col);
  for (let r = baseRow - 1; r <= baseRow + 1; r++) {
    for (let c = baseCol - 1; c <= baseCol + 1; c++) {
      if (r >= 0 && r < rows && c >= 0 && c < cols)
        tiles.push({ row: r, col: c });
    }
  }
  return tiles;
}

// Update tile control.
function updateTileControl(dt) {
  let occupancy = Array(rows)
    .fill(0)
    .map(() =>
      Array(cols)
        .fill(null)
        .map(() => [])
    );
  for (let troop of troops) {
    if (troop.active && !troop.dead) {
      let inf = getInfluencedTiles(troop);
      for (let t of inf) {
        if (grid[t.row][t.col].type === "normal")
          occupancy[t.row][t.col].push(troop.owner);
      }
    }
  }
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col].type !== "normal") continue;
      let owners = occupancy[row][col];
      if (owners.length > 0) {
        let unique = [...new Set(owners)];
        if (unique.length === 1) {
          grid[row][col].owner = unique[0];
          grid[row][col].control[unique[0]] = 1;
          grid[row][col].control[
            unique[0] === "player1" ? "player2" : "player1"
          ] = 0;
        } else {
          grid[row][col].owner = "neutral";
          grid[row][col].control["player1"] = 0.5;
          grid[row][col].control["player2"] = 0.5;
        }
      }
    }
  }
}

function getTileColorByOwner(owner) {
  if (owner === "player1") return "rgba(0, 0, 255, 0.5)";
  if (owner === "player2") return "rgba(255, 0, 0, 0.5)";
  return "rgba(128, 128, 128, 0.5)";
}

// ---------------------------
// Drawing Functions
function drawGrid() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let tile = grid[row][col];
      const x = col * tileSize,
        y = row * tileSize;
      if (tile.type === "blocked") ctx.fillStyle = "black";
      else if (tile.type === "tower")
        ctx.fillStyle = tile.owner === "player1" ? "darkblue" : "darkred";
      else ctx.fillStyle = getTileColorByOwner(tile.owner);
      ctx.fillRect(x, y, tileSize, tileSize);
      ctx.strokeStyle = "#333";
      ctx.strokeRect(x, y, tileSize, tileSize);
      if (tile.type === "normal") {
        ctx.fillStyle = "#eee";
        ctx.font = "10px sans-serif";
        ctx.fillText(`(${row},${col})`, x + 3, y + 12);
      }
    }
  }
}

function drawTowers() {
  let x1 = tower1.col * tileSize,
    y1 = tower1.startRow * tileSize;
  let towerHeight = (tower1.endRow - tower1.startRow + 1) * tileSize;
  ctx.strokeStyle = "white";
  ctx.strokeRect(x1, y1, tileSize, towerHeight);
  let hf1 = Math.max(tower1.hp, 0) / 100,
    fillH1 = hf1 * towerHeight;
  ctx.fillStyle = "blue";
  ctx.fillRect(x1, y1 + (towerHeight - fillH1), tileSize, fillH1);
  ctx.fillStyle = "white";
  ctx.font = "14px sans-serif";
  ctx.fillText("HP: " + tower1.hp, x1 + 5, y1 + towerHeight / 2);
  let x2 = tower2.col * tileSize,
    y2 = tower2.startRow * tileSize;
  let towerHeight2 = (tower2.endRow - tower2.startRow + 1) * tileSize;
  ctx.strokeStyle = "white";
  ctx.strokeRect(x2, y2, tileSize, towerHeight2);
  let hf2 = Math.max(tower2.hp, 0) / 100,
    fillH2 = hf2 * towerHeight2;
  ctx.fillStyle = "red";
  ctx.fillRect(x2, y2 + (towerHeight2 - fillH2), tileSize, fillH2);
  ctx.fillStyle = "white";
  ctx.font = "14px sans-serif";
  ctx.fillText("HP: " + tower2.hp, x2 + 5, y2 + towerHeight2 / 2);
}

// function drawBuildings() {
//   for (let b of buildings) {
//     let x = b.col * tileSize,
//       y = b.row * tileSize;
//     let w = b.width * tileSize,
//       h = b.height * tileSize;
//     let bType = buildingTypes[b.type];
//     ctx.fillStyle = bType.color;
//     ctx.fillRect(x, y, w, h);
//     ctx.strokeStyle = "#000";
//     ctx.strokeRect(x, y, w, h);
//     const hpBarWidth = w * 0.8,
//       hpBarHeight = 4;
//     let hpBarY = y - hpBarHeight - 2;
//     let progBarY = hpBarY - 5;
//     let hpRatio = b.hp / b.maxHP;
//     ctx.fillStyle = "green";
//     ctx.fillRect(
//       x + (w - hpBarWidth) / 2,
//       hpBarY,
//       hpBarWidth * hpRatio,
//       hpBarHeight
//     );
//     ctx.strokeStyle = "#000";
//     ctx.strokeRect(x + (w - hpBarWidth) / 2, hpBarY, hpBarWidth, hpBarHeight);
//     if (b.type === "farm") {
//       let progress = Math.min(
//         (b.bonusTimer || 0) / buildingTypes.farm.bonusInterval,
//         1
//       );
//       ctx.fillStyle = "yellow";
//       ctx.fillRect(
//         x + (w - hpBarWidth) / 2,
//         progBarY,
//         hpBarWidth * progress,
//         3
//       );
//       ctx.strokeStyle = "#000";
//       ctx.strokeRect(x + (w - hpBarWidth) / 2, progBarY, hpBarWidth, 3);
//     }
//     if (b.type === "warCamp" && b.active) {
//       let nowSec = performance.now() / 1000;
//       let pulseAlpha = 0.5 + 0.5 * Math.sin(2 * Math.PI * (nowSec % 1));
//       ctx.save();
//       ctx.globalAlpha = pulseAlpha;
//       ctx.strokeStyle = "purple";
//       ctx.lineWidth = 3;
//       let centerX = x + w / 2,
//         centerY = y + h / 2;
//       let radius = b.influenceRadius * tileSize;
//       ctx.beginPath();
//       ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
//       ctx.stroke();
//       ctx.restore();
//     }
//   }
//   if (buildSpecter) {
//     let x = buildSpecter.col * tileSize,
//       y = buildSpecter.row * tileSize;
//     let w = buildSpecter.width * tileSize,
//       h = buildSpecter.height * tileSize;
//     ctx.save();
//     ctx.globalAlpha = 0.5;
//     let bType = buildingTypes[buildSpecter.type];
//     ctx.fillStyle = bType.color;
//     ctx.fillRect(x, y, w, h);
//     ctx.strokeStyle = "#fff";
//     ctx.strokeRect(x, y, w, h);
//     ctx.restore();
//   }
// }

function drawSpawnSpecter(specter) {
  const shapeSize = 8;
  const startX = specter.col * tileSize + tileSize / 2;
  const startY = specter.row * tileSize + tileSize / 2;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = specter.owner === "player1" ? "blue" : "red";
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (specter.type === "swordsman") {
    ctx.moveTo(startX, startY - shapeSize);
    ctx.lineTo(startX - shapeSize, startY + shapeSize);
    ctx.lineTo(startX + shapeSize, startY + shapeSize);
    ctx.closePath();
  } else if (specter.type === "archer") {
    ctx.arc(startX, startY, shapeSize, 0, 2 * Math.PI);
  } else if (specter.type === "dasher") {
    ctx.moveTo(startX, startY - shapeSize);
    ctx.lineTo(startX + shapeSize, startY);
    ctx.lineTo(startX, startY + shapeSize);
    ctx.lineTo(startX - shapeSize, startY);
    ctx.closePath();
  } else if (specter.type === "militia") {
    ctx.moveTo(startX, startY - shapeSize);
    ctx.lineTo(startX + shapeSize, startY);
    ctx.lineTo(startX, startY + shapeSize);
    ctx.lineTo(startX - shapeSize, startY);
    ctx.closePath();
  } else if (specter.type === "heavy" || specter.type === "settler") {
    ctx.rect(
      startX - shapeSize,
      startY - shapeSize,
      shapeSize * 2,
      shapeSize * 2
    );
  }
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

// New: Draw Strategems (active and preview) with duration timer bars and Divine Wind arrow
function drawStrategems() {
  for (let s of strategems) {
    if (s.type === "heal") {
      let centerX = s.col * tileSize + tileSize / 2;
      let centerY = s.row * tileSize + tileSize / 2;
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "green";
      ctx.beginPath();
      ctx.arc(centerX, centerY, 1.5 * tileSize, 0, 2 * Math.PI);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "black";
      ctx.font = "12px sans-serif";
      ctx.fillText("Heal", centerX - 15, centerY + 4);
      // Draw duration bar for Heal strategem below the circle
      let barWidth = tileSize * 1.5,
        barHeight = 6;
      let barX = centerX - barWidth / 2;
      let barY = s.row * tileSize + tileSize + 5;
      let remaining = s.duration - s.elapsed;
      if (remaining < 0) remaining = 0;
      let progress = remaining / s.duration;
      ctx.save();
      ctx.fillStyle = "black";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);
      ctx.fillRect(barX, barY, barWidth * progress, barHeight);
      ctx.restore();
    } else if (s.type === "divineWind") {
      // Draw a lightblue rectangle covering 4 rows starting at s.row
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "lightblue";
      let yPos = s.row * tileSize;
      let height = 4 * tileSize;
      ctx.fillRect(0, yPos, canvas.width, height);
      ctx.restore();
      // Draw an arrow in the center of the area indicating push direction.
      ctx.save();
      ctx.fillStyle = "blue";
      let arrowDir = s.owner === "player1" ? 1 : -1;
      let arrowX = canvas.width / 2;
      let arrowY = yPos + height / 2;
      ctx.beginPath();
      if (arrowDir === 1) {
        ctx.moveTo(arrowX - 10, arrowY - 10);
        ctx.lineTo(arrowX - 10, arrowY + 10);
        ctx.lineTo(arrowX + 10, arrowY);
      } else {
        ctx.moveTo(arrowX + 10, arrowY - 10);
        ctx.lineTo(arrowX + 10, arrowY + 10);
        ctx.lineTo(arrowX - 10, arrowY);
      }
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "black";
      ctx.font = "12px sans-serif";
      ctx.fillText("Divine Wind", 10, yPos + 20);
      // Draw duration bar for Divine Wind in the top-left corner of the area.
      let barWidth = tileSize * 1.5,
        barHeight = 6;
      let barX = 5,
        barY = yPos + 5;
      let remaining = s.duration - (s.elapsed - s.startup);
      if (remaining < 0) remaining = 0;
      let progress = remaining / s.duration;
      ctx.save();
      ctx.fillStyle = "black";
      ctx.strokeStyle = "white";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);
      ctx.fillRect(barX, barY, barWidth * progress, barHeight);
      ctx.restore();
    } else if (s.type === "boltStorm") {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = "violet";
      ctx.fillRect(
        s.col * tileSize,
        s.row * tileSize,
        4 * tileSize,
        4 * tileSize
      );
      ctx.restore();
      ctx.fillStyle = "black";
      ctx.font = "12px sans-serif";
      ctx.fillText("Bolt Storm", s.col * tileSize + 5, s.row * tileSize + 15);
      // Draw charge (startup) bar over boltStorm area
      let barWidth = 4 * tileSize - 4,
        barHeight = 4;
      let barX = s.col * tileSize + 2;
      let barY = s.row * tileSize + 4 * tileSize - 10;
      let chargeProgress = Math.min(s.chargeTimer / s.startup, 1);
      ctx.save();
      ctx.fillStyle = "orange";
      ctx.fillRect(barX, barY, barWidth * chargeProgress, barHeight);
      ctx.strokeStyle = "black";
      ctx.strokeRect(barX, barY, barWidth, barHeight);
      ctx.restore();
      // Draw overall duration bar for Bolt Storm
      let durBarY = barY - 8;
      let durationProgress = 1 - s.totalElapsed / s.duration;
      ctx.save();
      ctx.fillStyle = "gray";
      ctx.fillRect(barX, durBarY, barWidth * durationProgress, barHeight);
      ctx.strokeStyle = "black";
      ctx.strokeRect(barX, durBarY, barWidth, barHeight);
      ctx.restore();
    }
  }
  // Draw strategem placement preview
  if (strategemSpecter && currentStrategem) {
    if (currentStrategem.type === "heal") {
      let centerX = strategemSpecter.col * tileSize + tileSize / 2;
      let centerY = strategemSpecter.row * tileSize + tileSize / 2;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "green";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(centerX, centerY, 1.5 * tileSize, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.restore();
    } else if (currentStrategem.type === "divineWind") {
      let startRow = Math.floor(strategemSpecter.row);
      if (startRow > rows - 4) startRow = rows - 4;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "blue";
      ctx.lineWidth = 2;
      ctx.strokeRect(0, startRow * tileSize, canvas.width, 4 * tileSize);
      ctx.restore();
    } else if (currentStrategem.type === "boltStorm") {
      let startRow = Math.floor(strategemSpecter.row);
      let startCol = Math.floor(strategemSpecter.col);
      if (startRow > rows - 4) startRow = rows - 4;
      if (startCol > cols - 4) startCol = cols - 4;
      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = "violet";
      ctx.lineWidth = 2;
      ctx.strokeRect(
        startCol * tileSize,
        startRow * tileSize,
        4 * tileSize,
        4 * tileSize
      );
      ctx.restore();
    }
  }
}

function drawAll() {
  drawGrid();
  drawTowers();
  // drawBuildings();
  drawStrategems();
  if (spawnSpecter) drawSpawnSpecter(spawnSpecter);
  drawTroops();
}

// ---------------------------
// Resource Regeneration
function updateResourcesDisplay() {
  document.getElementById("rp1").innerText = currentRP.player1.toFixed(2);
  document.getElementById("rp2").innerText = currentRP.player2.toFixed(2);
  document.getElementById("tp1").innerText = currentTP.player1.toFixed(2);
  document.getElementById("tp2").innerText = currentTP.player2.toFixed(2);
  let p1Tiles = 0,
    p2Tiles = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col].type === "normal") {
        if (grid[row][col].owner === "player1") p1Tiles++;
        if (grid[row][col].owner === "player2") p2Tiles++;
      }
    }
  }
  let rpCap1 = 10,
    rpCap2 = 10;
  let tpCap1 = Math.floor(p1Tiles / 18) + 5;
  let tpCap2 = Math.floor(p2Tiles / 18) + 5;
  let rpRegen1 = (p1Tiles / 144 + 0.25).toFixed(2);
  let rpRegen2 = (p2Tiles / 144 + 0.25).toFixed(2);
  let active1 = troops.filter((t) => t.owner === "player1").length;
  let active2 = troops.filter((t) => t.owner === "player2").length;
  let tpRegen1 = (0.2 * active1).toFixed(2);
  let tpRegen2 = (0.2 * active2).toFixed(2);
  document.getElementById("rpBar1").style.width =
    (rpCap1 > 0 ? (currentRP.player1 / rpCap1) * 100 : 0) + "%";
  document.getElementById("rpBar2").style.width =
    (rpCap2 > 0 ? (currentRP.player2 / rpCap2) * 100 : 0) + "%";
  document.getElementById("tpBar1").style.width =
    (tpCap1 > 0 ? (currentTP.player1 / tpCap1) * 100 : 0) + "%";
  document.getElementById("tpBar2").style.width =
    (tpCap2 > 0 ? (currentTP.player2 / tpCap2) * 100 : 0) + "%";
  document.getElementById("rpText1").innerText = `${currentRP.player1.toFixed(
    2
  )}/${rpCap1} ( +${rpRegen1} )`;
  document.getElementById("rpText2").innerText = `${currentRP.player2.toFixed(
    2
  )}/${rpCap2} ( +${rpRegen2} )`;
  document.getElementById("tpText1").innerText = `${currentTP.player1.toFixed(
    2
  )}/${tpCap1} ( +${tpRegen1} )`;
  document.getElementById("tpText2").innerText = `${currentTP.player2.toFixed(
    2
  )}/${tpCap2} ( +${tpRegen2} )`;
}

document.addEventListener("DOMContentLoaded", () => {
  const tooltip = document.createElement("div");
  tooltip.className = "tooltip-box";
  document.body.appendChild(tooltip);
  const tooltipButtons = document.querySelectorAll("[data-tooltip]");
  tooltipButtons.forEach((btn) => {
    btn.addEventListener("mouseover", (e) => {
      tooltip.textContent = btn.getAttribute("data-tooltip");
      tooltip.style.display = "block";
    });
    btn.addEventListener("mousemove", (e) => {
      tooltip.style.left = e.pageX + 12 + "px";
      tooltip.style.top = e.pageY + 12 + "px";
    });
    btn.addEventListener("mouseout", () => {
      tooltip.style.display = "none";
    });
  });
});

function regenerateRP() {
  let p1Tiles = 0,
    p2Tiles = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col].type === "normal") {
        if (grid[row][col].owner === "player1") p1Tiles++;
        if (grid[row][col].owner === "player2") p2Tiles++;
      }
    }
  }
  currentRP.player1 += parseFloat((p1Tiles / 144 + 0.25).toFixed(2));
  currentRP.player2 += parseFloat((p2Tiles / 144 + 0.25).toFixed(2));
  let rpCap1 = 10,
    rpCap2 = 10;
  if (currentRP.player1 > rpCap1) currentRP.player1 = rpCap1;
  if (currentRP.player2 > rpCap2) currentRP.player2 = rpCap2;
  updateResourcesDisplay();
}

function regenerateTP() {
  currentTP.player1 += 0.2 * troops.filter((t) => t.owner === "player1").length;
  currentTP.player2 += 0.2 * troops.filter((t) => t.owner === "player2").length;
  let p1Tiles = 0,
    p2Tiles = 0;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if (grid[row][col].type === "normal") {
        if (grid[row][col].owner === "player1") p1Tiles++;
        if (grid[row][col].owner === "player2") p2Tiles++;
      }
    }
  }
  let tpCap1 = Math.floor(p1Tiles / 18) + 5;
  let tpCap2 = Math.floor(p2Tiles / 18) + 5;
  if (currentTP.player1 > tpCap1) currentTP.player1 = tpCap1;
  if (currentTP.player2 > tpCap2) currentTP.player2 = tpCap2;
  updateResourcesDisplay();
}

// ---------------------------
// Module 2: Troop Behavior Update & Target Selection
const troopTypes = {
  swordsman: {
    cost: 1,
    hp: 35,
    attackDamage: 20,
    attackRange: 0.5,
    perceptionRange: 3,
    attackSpeed: 1,
    speed: 0.25,
    typeAbbr: "S",
  },
  archer: {
    cost: 1.5,
    hp: 15,
    attackDamage: 5,
    attackRange: 4.5,
    perceptionRange: 6,
    attackSpeed: 0.8,
    speed: 0.2,
    typeAbbr: "A",
  },
  // dasher: { cost: 2, hp: 15, attackDamage: 6, attackRange: 0.8, perceptionRange: 4, attackSpeed: 2, speed: 0.5, typeAbbr: "D", freeDashes: 3 },
  heavy: {
    cost: 3.5,
    hp: 100,
    attackDamage: 30,
    attackRange: 1,
    perceptionRange: 3,
    attackSpeed: 0.4,
    speed: 0.15,
    typeAbbr: "H",
    armorFlat: 1,
    armorPercent: 0.5,
    armorBreakPoint: 100,
  },
  settler: {
    cost: 2,
    hp: 10,
    attackDamage: 0,
    attackRange: 0,
    perceptionRange: 0,
    attackSpeed: 0,
    speed: 2,
    typeAbbr: "T",
  },
  militia: {
    cost: 0.5,
    hp: 25,
    attackDamage: 7,
    attackRange: 0.5,
    perceptionRange: 3,
    attackSpeed: 1.5,
    speed: 0.3,
    typeAbbr: "M",
  },
};

class Troop {
  constructor(owner, row, col, type) {
    this.owner = owner;
    this.row = row;
    this.col = col;
    this.type = type;
    const stats = troopTypes[type];
    this.hp = stats.hp;
    this.maxHP = stats.hp;
    this.attackDamage = stats.attackDamage;
    this.attackRange = stats.attackRange;
    this.perceptionRange = stats.perceptionRange;
    this.attackSpeed = stats.attackSpeed;
    this.speed = stats.speed;
    this.originalSpeed = this.speed;
    this.originalAttackSpeed = this.attackSpeed;
    this.cost = stats.cost;
    this.typeAbbr = stats.typeAbbr;
    if (type === "heavy") {
      this.armorFlat = stats.armorFlat;
      this.armorPercent = stats.armorPercent;
      this.armorBreakPoint = stats.armorBreakPoint;
      this.armorCurrent = stats.armorBreakPoint;
    }
    if (type === "swordsman" || type === "archer") {
      this.activationTime = 2.5;
      this.maxActivationTime = 2.5;
    } else if (type === "militia") {
      this.activationTime = 1;
      this.maxActivationTime = 1;
      this.active = true;
    } else if (type === "heavy") {
      this.activationTime = 7.5;
      this.maxActivationTime = 7.5;
    } else if (type === "settler") {
      this.activationTime = 2.5;
      this.maxActivationTime = 2.5;
    }
    this.active = this.activationTime > 0 ? false : true;
    this.attackCooldown = 0;
    this.attackAnimTimer = 0;
    this.target = null;
    this.influenceRadius = 0.75;
    this.dead = false;
    this.lastAttacker = null;
    this.path = null;
    if (type === "settler") {
      let center = (rows - 1) / 2 + 0.5;
      let verticalDir = this.row < center ? 1 : this.row > center ? -1 : 0;

      // Check if the settler is already at the vertical boundary based on its vertical direction.
      // For verticalDir === 1, it should be moving toward the top, so if it's already at row 0, remove it.
      // For verticalDir === -1, it should be moving toward the bottom, so if it's already at the bottom, remove it.
      if (verticalDir === 1 && this.row === 0) {
        this.dead = true;
        currentRP[owner] += 2; // Refund the full cost (2RP)
        return;
      } else if (verticalDir === -1 && this.row === 11) {
        this.dead = true;
        currentRP[owner] += 2; // Refund the full cost (2RP)
        return;
      }

      if (owner === "player1") {
        this.movementPattern = [
          { dx: 1, dy: 0, distance: 2 },
          { dx: 0, dy: verticalDir, distance: 1 },
          { dx: -1, dy: 0, distance: 2 },
          { dx: 0, dy: verticalDir, distance: 1 },
        ];
      } else {
        this.movementPattern = [
          { dx: -1, dy: 0, distance: 2 },
          { dx: 0, dy: verticalDir, distance: 1 },
          { dx: 1, dy: 0, distance: 2 },
          { dx: 0, dy: verticalDir, distance: 1 },
        ];
      }

      this.currentStepIndex = 0;
      this.distanceTraveledInStep = -1;
    }
  }
}

// ---------------------------
// Build Mode Functions
function setBuildMode(owner, type) {
  if (currentGamePhase !== "planning_" + owner) {
    alert("It's not " + owner + "'s planning phase!");
    return;
  }
  currentMode = "build";
  currentBuild = { owner, type };
  document.getElementById("buildModeDisplay").innerText =
    "Build Mode: " + owner + " " + type + " – Click on a valid build area.";
}

// New: Strategem Mode Function (for Heal, Divine Wind, and Bolt Storm)
function setStrategemMode(owner, type) {
  if (currentGamePhase !== "planning_" + owner) {
    alert("It's not " + owner + "'s planning phase!");
    return;
  }
  currentMode = "strategem";
  currentStrategem = { owner: owner, type: type };
  if (type === "heal")
    document.getElementById("buildModeDisplay").innerText =
      "Strategem Mode: " + owner + " Heal – Click on a valid tile to place.";
  else if (type === "divineWind")
    document.getElementById("buildModeDisplay").innerText =
      "Strategem Mode: " +
      owner +
      " Divine Wind – Click on a tile to select the top row (4 rows will be affected).";
  else if (type === "boltStorm")
    document.getElementById("buildModeDisplay").innerText =
      "Strategem Mode: " +
      owner +
      " Bolt Storm – Click on a tile to set the top-left corner of a 4x4 area.";
}

function isBuildAreaValid(owner, startRow, startCol, width, height) {
  if (
    startRow < 0 ||
    startCol < 0 ||
    startRow + height > rows ||
    startCol + width > cols
  )
    return false;
  for (let r = startRow; r < startRow + height; r++) {
    for (let c = startCol; c < startCol + width; c++) {
      if (grid[r][c].type !== "normal" || grid[r][c].owner !== owner)
        return false;
      if (getBuildingAtTile(r, c)) return false;
    }
  }
  return true;
}

function getBuildingAtTile(row, col) {
  for (let b of buildings) {
    if (
      row >= b.row &&
      row < b.row + b.height &&
      col >= b.col &&
      col < b.col + b.width
    )
      return b;
  }
  return null;
}

// ---------------------------
// // Building Update Function
// function updateBuildings(dt) {
//   for (let troop of troops) {
//     if (troop.originalSpeed !== undefined) {
//       troop.speed = troop.originalSpeed;
//       troop.attackSpeed = troop.originalAttackSpeed;
//     }
//   }
//   for (let b of buildings) {
//     if (!b.active) {
//       b.activationTime -= dt;
//       if (b.activationTime <= 0) b.active = true;
//     }
//     if (b.type === "farm" && b.active) {
//       b.bonusTimer = (b.bonusTimer || 0) + dt;
//       if (b.bonusTimer >= buildingTypes.farm.bonusInterval) {
//         currentRP[b.owner] += buildingTypes.farm.rpBonus;
//         b.bonusTimer -= buildingTypes.farm.bonusInterval;
//         updateResourcesDisplay();
//       }
//     }
//   }
//   for (let b of buildings) {
//     if (b.type === "warCamp" && b.active) {
//       for (let troop of troops) {
//         if (troop.owner === b.owner) {
//           let centerX = b.col + b.width / 2;
//           let centerY = b.row + b.height / 2;
//           let dx = troop.col - centerX;
//           let dy = troop.row - centerY;
//           let dist = Math.sqrt(dx * dx + dy * dy);
//           if (dist <= b.influenceRadius) {
//             troop.hp = Math.min(troop.hp + b.buff.healRate * dt, troop.maxHP);
//             if (troop.type === "heavy" && troop.armorCurrent !== undefined) {
//               troop.armorCurrent = Math.min(
//                 troop.armorCurrent + b.buff.armorRegenRate * dt,
//                 troop.armorBreakPoint
//               );
//             }
//             troop.speed = troop.originalSpeed * b.buff.moveSpeedMultiplier;
//             troop.attackSpeed =
//               troop.originalAttackSpeed * b.buff.attackSpeedMultiplier;
//           }
//         }
//       }
//     }
//   }
//   for (let i = buildings.length - 1; i >= 0; i--) {
//     if (buildings[i].hp <= 0) {
//       if (buildings[i].type === "archerTower") {
//         for (let troop of troops) {
//           if (
//             troop.type === "archer" &&
//             troop.owner === buildings[i].owner &&
//             troop.row >= buildings[i].row &&
//             troop.row < buildings[i].row + buildings[i].height &&
//             troop.col >= buildings[i].col &&
//             troop.col < buildings[i].col + buildings[i].width
//           ) {
//             troop.hp = troop.hp / 2;
//           }
//         }
//       }
//       buildings.splice(i, 1);
//     }
//   }
// }

// ---------------------------
// Update Strategems (Heal, Divine Wind, Bolt Storm)
function updateStrategems(dt) {
  for (let i = strategems.length - 1; i >= 0; i--) {
    let s = strategems[i];
    if (s.type === "heal") {
      s.elapsed += dt;
      s.tickAccumulator += dt;
      while (s.tickAccumulator >= 0.5) {
        for (let troop of troops) {
          if (troop.owner === s.owner && !troop.dead) {
            if (
              Math.abs(troop.row - s.row) <= 1 &&
              Math.abs(troop.col - s.col) <= 1
            ) {
              troop.hp = Math.min(troop.hp + 5, troop.maxHP);
            }
          }
        }
        s.tickAccumulator -= 0.5;
      }
      if (s.elapsed >= s.duration) {
        strategems.splice(i, 1);
      }
    } else if (s.type === "divineWind") {
      s.elapsed += dt;
      if (s.elapsed >= s.startup && s.elapsed < s.startup + s.duration) {
        let pushAmount = 0.6 * dt; // increased push rate
        if (s.owner === "player2") pushAmount = -pushAmount;
        for (let troop of troops) {
          let troopRow = Math.floor(troop.row);
          if (troopRow >= s.row && troopRow < s.row + 4) {
            troop.col += pushAmount;
            if (troop.col < 0) troop.col = 0;
            if (troop.col > cols - 1) troop.col = cols - 1;
          }
        }
      }
      if (s.elapsed >= s.startup + s.duration) {
        strategems.splice(i, 1);
      }
    } else if (s.type === "boltStorm") {
      s.totalElapsed += dt;
      s.chargeTimer += dt;
      if (s.totalElapsed >= s.duration) {
        strategems.splice(i, 1);
        continue;
      }
      if (s.chargeTimer >= s.startup) {
        let hostiles = troops.filter(
          (t) =>
            t.owner !== s.owner &&
            Math.floor(t.row) >= s.row &&
            Math.floor(t.row) < s.row + 4 &&
            Math.floor(t.col) >= s.col &&
            Math.floor(t.col) < s.col + 4
        );
        if (hostiles.length > 0) {
          let damage = Math.floor(40 / hostiles.length);
          for (let t of hostiles) {
            t.hp -= damage;
            if (t.hp < 0) t.hp = 0;
            if (t.armorCurrent !== undefined) {
              t.armorCurrent = 0;
            }
          }
          s.chargeTimer = 0;
          s.strikesRemaining--;
        }
      }
      if (s.strikesRemaining <= 0) {
        strategems.splice(i, 1);
      }
    }
  }
}

// ---------------------------
// Troop Behavior
function updateTroopBehavior(troop, dt) {
  if (troop.hp <= 0 && !troop.dead) {
    troop.hp = 0;
    troop.dead = true;
    playSound(deathSound);
    return;
  }
  if (troop.dead) return;
  if (troop.target && troop.target.hp <= 0) troop.target = null;
  if (troop.lastAttacker) {
    if (
      !troop.target ||
      (troop.target.typeAbbr &&
        distance(troop.col, troop.row, troop.target.col, troop.target.row) >
          troop.attackRange)
    ) {
      let sr = Math.floor(troop.row),
        sc = Math.floor(troop.col);
      let tr = Math.floor(troop.lastAttacker.row),
        tc = Math.floor(troop.lastAttacker.col);
      let path = findPathAvoidingEnemyWalls(sr, sc, tr, tc, troop.owner);
      if (path && path.length <= 12) {
        troop.path = path;
        troop.target = troop.lastAttacker;
      } else {
        let wall = getBlockingWall(troop, troop.lastAttacker);
        if (wall) troop.target = wall;
      }
    }
    troop.lastAttacker = null;
  }
  if (
    troop.target &&
    troop.target.typeAbbr &&
    distance(troop.col, troop.row, troop.target.col, troop.target.row) <=
      troop.attackRange
  ) {
    // engaged
  } else {
    let candidates = troops.filter(
      (enemy) =>
        enemy.owner !== troop.owner &&
        !enemy.dead &&
        distance(troop.col, troop.row, enemy.col, enemy.row) <=
          troop.attackRange &&
        hasClearLineOfSight(troop, enemy)
    );
    if (candidates.length > 0) {
      candidates.sort(
        (a, b) =>
          distance(troop.col, troop.row, a.col, a.row) -
          distance(troop.col, troop.row, b.col, b.row)
      );
      troop.target = candidates[0];
    } else {
      let candidates2 = troops.filter(
        (enemy) =>
          enemy.owner !== troop.owner &&
          !enemy.dead &&
          distance(troop.col, troop.row, enemy.col, enemy.row) <=
            troop.perceptionRange &&
          hasClearLineOfSight(troop, enemy)
      );
      if (candidates2.length > 0) {
        candidates2.sort(
          (a, b) =>
            distance(troop.col, troop.row, a.col, a.row) -
            distance(troop.col, troop.row, b.col, b.row)
        );
        troop.target = candidates2[0];
      } else {
        if (
          (troop.owner === "player1" && troop.col >= cols - 2) ||
          (troop.owner === "player2" && troop.col <= 1)
        )
          troop.target = troop.owner === "player1" ? tower2 : tower1;
      }
    }
  }
  if (!troop.target) {
    let nearBuilding = null,
      bestDist = Infinity;
    for (let b of buildings) {
      if (b.owner !== troop.owner && b.type !== "tower") {
        let bCenterRow = b.row + b.height / 2;
        let bCenterCol = b.col + b.width / 2;
        let d = distance(troop.col, troop.row, bCenterCol, bCenterRow);
        if (d <= 1.5 && d < bestDist) {
          bestDist = d;
          nearBuilding = b;
        }
      }
    }
    if (nearBuilding) troop.target = nearBuilding;
  }
  if (troop.path && troop.path.length > 0) {
    let nextStep = troop.path[0];
    let targetX = nextStep.col + 0.5,
      targetY = nextStep.row + 0.5;
    let dx = targetX - troop.col,
      dy = targetY - troop.row;
    let distStep = Math.sqrt(dx * dx + dy * dy);
    if (distStep < 0.1) troop.path.shift();
    else {
      let angle = Math.atan2(dy, dx);
      let moveDist = troop.speed * dt;
      let newRow = troop.row + moveDist * Math.sin(angle);
      let newCol = troop.col + moveDist * Math.cos(angle);
      if (
        !isTilePassableForTroop(
          troop.owner,
          Math.floor(newRow),
          Math.floor(newCol)
        )
      ) {
        let wall = getBuildingAtTile(Math.floor(newRow), Math.floor(newCol));
        if (wall && wall.type === "wall" && wall.owner !== troop.owner) {
          troop.target = wall;
          return;
        }
      } else {
        troop.row = newRow;
        troop.col = newCol;
        return;
      }
    }
    if (troop.type === "militia") {
      let inBack3 = false;
      const c = Math.floor(troop.col);
      if (troop.owner === "player1") inBack3 = c >= 0 && c <= 2;
      else inBack3 = c >= 11 && c <= 13;
      if (troop.originalAttackDamage === undefined) {
        troop.originalAttackDamage = troop.attackDamage;
        troop.originalAttackSpeed = troop.attackSpeed;
        troop.originalSpeed = troop.speed;
      }
      if (inBack3) {
        troop.attackDamage = troop.originalAttackDamage + 1;
        troop.attackSpeed = troop.originalAttackSpeed + 0.25;
        troop.speed = troop.originalSpeed + 0.1;
      } else {
        troop.attackDamage = troop.originalAttackDamage;
        troop.attackSpeed = troop.originalAttackSpeed;
        troop.speed = troop.originalSpeed;
      }
    }
  }
  if (!troop.active) {
    troop.activationTime -= dt;
    if (troop.activationTime <= 0) {
      troop.active = true;
      if (troop.type === "swordsman") playSound(swordsmanActivationSound);
      else if (troop.type === "archer") playSound(archerActivationSound);
      else if (troop.type === "militia") playSound(militiaActivationSound);
      else if (troop.type === "heavy") playSound(heavyActivationSound);
      else if (troop.type === "settler") playSound(settlerActivationSound);
    } else return;
  }
  if (troop.type === "settler") {
    if (troop.hp <= 0) {
      troop.dead = true;
      playSound(deathSound);
      return;
    }
    if (troop.target) {
      troop.hp = 0;
      troop.dead = true;
      playSound(deathSound);
      return;
    }
    let remainingTime = dt;
    while (remainingTime > 0) {
      let step = troop.movementPattern[troop.currentStepIndex];
      let distanceLeft = step.distance - troop.distanceTraveledInStep;
      let moveDistance = troop.speed * remainingTime;
      if (moveDistance >= distanceLeft) {
        troop.row += step.dy * distanceLeft;
        troop.col += step.dx * distanceLeft;
        remainingTime -= distanceLeft / troop.speed;
        troop.currentStepIndex =
          (troop.currentStepIndex + 1) % troop.movementPattern.length;
        troop.distanceTraveledInStep = 0;
      } else {
        troop.row += step.dy * moveDistance;
        troop.col += step.dx * moveDistance;
        troop.distanceTraveledInStep += moveDistance;
        remainingTime = 0;
      }
    }
    troop.row = Math.max(0, Math.min(troop.row, rows - 1));
    troop.col = Math.max(0, Math.min(troop.col, cols - 1));
    return;
  }
  if (troop.target) {
    let d = Math.hypot(
      troop.target.row - troop.row,
      troop.target.col - troop.col
    );
    if (d <= troop.attackRange) {
      troop.attackCooldown -= dt;
      if (troop.attackCooldown <= 0) {
        let damage = troop.attackDamage;
        if (
          troop.target.armorFlat !== undefined &&
          troop.target.armorCurrent > 0
        ) {
          let flatMit = Math.min(damage, troop.target.armorFlat);
          let extra = Math.max(damage - troop.target.armorFlat, 0);
          let percentMit = extra * troop.target.armorPercent;
          let potentialMit = flatMit + percentMit;
          let actualMit = Math.min(potentialMit, troop.target.armorCurrent);
          troop.target.armorCurrent -= actualMit;
          damage = Math.max(damage - actualMit, 0);
        }
        if (troop.type === "heavy") playSound(heavyAttackSound);
        if (troop.type === "archer") playSound(archerAttackSound);
        if (troop.type === "swordsman") playSound(swordsmanAttackSound);
        if (troop.type === "militia") playSound(militiaAttackSound);
        troop.target.hp -= damage;
        if (troop.target.hp <= 0) {
          troop.target.hp = 0;
          troop.target.dead = true;
          playSound(deathSound);
        }
        troop.attackCooldown = 1 / troop.attackSpeed;
        troop.attackAnimTimer = 0.2;
        if (troop.target.typeAbbr && !hasClearLineOfSight(troop.target, troop))
          troop.target.lastAttacker = troop;
        if (
          (troop.target === tower1 || troop.target === tower2) &&
          troop.target.hp <= 0
        ) {
          alert(
            troop.owner === "player1" ? "Player 1 Wins!" : "Player 2 Wins!"
          );
          battlePhaseActive = false;
          return;
        }
      }
    } else {
      let angle = Math.atan2(
        troop.target.row - troop.row,
        troop.target.col - troop.col
      );
      let moveDist = troop.speed * dt;
      let newRow = troop.row + moveDist * Math.sin(angle);
      let newCol = troop.col + moveDist * Math.cos(angle);
      if (
        !isTilePassableForTroop(
          troop.owner,
          Math.floor(newRow),
          Math.floor(newCol)
        )
      ) {
        let wall = getBuildingAtTile(Math.floor(newRow), Math.floor(newCol));
        if (wall && wall.type === "wall" && wall.owner !== troop.owner) {
          troop.target = wall;
          return;
        }
      } else {
        troop.row = newRow;
        troop.col = newCol;
      }
    }
  } else {
    let marchDir = troop.owner === "player1" ? 1 : -1;
    let intendedCol = troop.col + troop.speed * dt * marchDir;
    if (
      !isTilePassableForTroop(
        troop.owner,
        Math.floor(troop.row),
        Math.floor(intendedCol)
      )
    ) {
      let wall = getBuildingAtTile(
        Math.floor(troop.row),
        Math.floor(intendedCol)
      );
      if (wall && wall.type === "wall" && wall.owner !== troop.owner) {
        troop.target = wall;
      }
    } else {
      troop.col = intendedCol;
    }
  }
  let tileRow = Math.floor(troop.row),
    tileCol = Math.floor(troop.col);
  let bldg = getBuildingAtTile(tileRow, tileCol);
  if (bldg && bldg.owner !== troop.owner) troop.target = bldg;
  troop.row = Math.max(0, Math.min(troop.row, rows - 1));
  troop.col = Math.max(0, Math.min(troop.col, cols - 1));
  if (troop.hp <= 0 && !troop.dead) {
    troop.hp = 0;
    troop.dead = true;
    playSound(deathSound);
  }
}

function updateTroopBehaviors(dt) {
  for (let troop of troops) {
    updateTroopBehavior(troop, dt);
  }
  troops = troops.filter((t) => !t.dead);
  for (let troop of troops) {
    if (troop.target && troop.target.hp <= 0) troop.target = null;
  }
}

// ---------------------------
// Drawing Troops
function drawTroops() {
  const shapeSize = 16;
  for (let troop of troops) {
    const startX = troop.col * tileSize + tileSize / 2;
    const startY = troop.row * tileSize + tileSize / 2;
    ctx.beginPath();
    ctx.setLineDash([4, 4]);
    ctx.arc(startX, startY, troop.influenceRadius * tileSize, 0, 2 * Math.PI);
    ctx.strokeStyle = troop.owner === "player1" ? "blue" : "red";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.setLineDash([5, 5]);
    ctx.arc(startX, startY, troop.attackRange * tileSize, 0, 2 * Math.PI);
    ctx.strokeStyle = "black";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    let drawnSprite = false;
    if (troop.type === "swordsman") {
      let spriteToDraw =
        troop.owner === "player1"
          ? troopSprites.swordsmanBlue
          : troopSprites.swordsmanRed;
      if (spriteToDraw && spriteToDraw.complete) {
        ctx.drawImage(
          spriteToDraw,
          startX - shapeSize,
          startY - shapeSize,
          shapeSize * 2,
          shapeSize * 2
        );
        drawnSprite = true;
      }
    }
    if (troop.type === "archer") {
      let spriteToDraw =
        troop.owner === "player1"
          ? troopSprites.archerBlue
          : troopSprites.archerRed;
      if (spriteToDraw && spriteToDraw.complete) {
        ctx.drawImage(
          spriteToDraw,
          startX - shapeSize,
          startY - shapeSize,
          shapeSize * 2,
          shapeSize * 2
        );
        drawnSprite = true;
      }
    }
    if (troop.type === "heavy") {
      let spriteToDraw =
        troop.owner === "player1"
          ? troopSprites.heavyBlue
          : troopSprites.heavyRed;
      if (spriteToDraw && spriteToDraw.complete) {
        ctx.drawImage(
          spriteToDraw,
          startX - shapeSize,
          startY - shapeSize,
          shapeSize * 2,
          shapeSize * 2
        );
        drawnSprite = true;
      }
    }
    if (troop.type === "settler") {
      let spriteToDraw =
        troop.owner === "player1"
          ? troopSprites.settlerBlue
          : troopSprites.settlerRed;
      if (spriteToDraw && spriteToDraw.complete) {
        ctx.drawImage(
          spriteToDraw,
          startX - shapeSize,
          startY - shapeSize,
          shapeSize * 2,
          shapeSize * 2
        );
        drawnSprite = true;
      }
    }
    if (troop.type === "militia") {
      let spriteToDraw =
        troop.owner === "player1"
          ? troopSprites.militiaBlue
          : troopSprites.militiaRed;
      if (spriteToDraw && spriteToDraw.complete) {
        ctx.drawImage(
          spriteToDraw,
          startX - shapeSize,
          startY - shapeSize,
          shapeSize * 2,
          shapeSize * 2
        );
        drawnSprite = true;
      }
    }
    if (!drawnSprite) {
      ctx.fillStyle = troop.owner === "player1" ? "blue" : "red";
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      if (troop.type === "archer")
        ctx.arc(startX, startY, shapeSize, 0, 2 * Math.PI);
      else if (troop.type === "dasher") {
        ctx.moveTo(startX, startY - shapeSize);
        ctx.lineTo(startX + shapeSize, startY);
        ctx.lineTo(startX, startY + shapeSize);
        ctx.lineTo(startX - shapeSize, startY);
        ctx.closePath();
      } else if (troop.type === "heavy" || troop.type === "settler") {
        ctx.rect(
          startX - shapeSize,
          startY - shapeSize,
          shapeSize * 2,
          shapeSize * 2
        );
      } else {
        ctx.moveTo(startX, startY - shapeSize);
        ctx.lineTo(startX - shapeSize, startY + shapeSize);
        ctx.lineTo(startX + shapeSize, startY + shapeSize);
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
    }
    if (troop.dead) {
      ctx.font = "16px sans-serif";
      ctx.fillStyle = "white";
      ctx.fillText("☠", startX - 8, startY - shapeSize - 4);
    }
    ctx.beginPath();
    ctx.arc(startX, startY, 1, 0, 2 * Math.PI);
    ctx.fillStyle = "yellow";
    ctx.fill();
    const hpBarWidth = tileSize * 0.8,
      hpBarHeight = 4;
    const hpBarX = startX - hpBarWidth / 2,
      hpBarY = startY + shapeSize + 4;
    const hpRatio = troop.hp / troop.maxHP;
    ctx.fillStyle = "green";
    ctx.fillRect(hpBarX, hpBarY, hpBarWidth * hpRatio, hpBarHeight);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(hpBarX, hpBarY, hpBarWidth, hpBarHeight);
    ctx.fillStyle = "#fff";
    ctx.font = "8px sans-serif";
    ctx.fillText(troop.hp, startX - shapeSize, startY + shapeSize + 8);
    if (!troop.active && troop.maxActivationTime > 0) {
      const barWidth = tileSize * 0.8,
        barHeight = 4;
      const progress = 1 - troop.activationTime / troop.maxActivationTime;
      const barX = startX - barWidth / 2,
        barY = startY - shapeSize - 12;
      ctx.fillStyle = "gray";
      ctx.fillRect(barX, barY, barWidth, barHeight);
      ctx.fillStyle = "limegreen";
      ctx.fillRect(barX, barY, barWidth * progress, barHeight);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 1;
      ctx.strokeRect(barX, barY, barWidth, barHeight);
    }
    if (troop.target && !troop.target.dead) {
      const targetX = troop.target.col * tileSize + tileSize / 2;
      const targetY = troop.target.row * tileSize + tileSize / 2;
      ctx.beginPath();
      ctx.setLineDash([3, 3]);
      ctx.moveTo(startX, startY);
      ctx.lineTo(targetX, targetY);
      ctx.strokeStyle =
        troop.owner === "player1" && troop.target.owner === "player2"
          ? "blue"
          : "red";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (troop.attackAnimTimer > 0 && troop.lastAttackTargetX !== undefined) {
      ctx.beginPath();
      let flashRadius = 10;
      ctx.arc(
        troop.lastAttackTargetX,
        troop.lastAttackTargetY,
        flashRadius,
        0,
        2 * Math.PI
      );
      ctx.fillStyle = "orange";
      ctx.globalAlpha = troop.attackAnimTimer / 0.2;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
}

// ---------------------------
// Battle Phase
function startBattlePhaseLive() {
  battlePhaseActive = true;
  phaseStartTime = performance.now();
  const battleStart = performance.now();
  let lastTime = battleStart;
  function battleLoop(now) {
    if (paused) {
      lastTime = now;
      requestAnimationFrame(battleLoop);
      return;
    }
    const dt = (now - lastTime) / 1000;
    lastTime = now;
    updateStrategems(dt);
    updateTroopBehaviors(dt);
    updateTileControl(dt);
    drawAll();
    if ((now - battleStart) / 1000 < battlePhaseDuration)
      requestAnimationFrame(battleLoop);
    else {
      regenerateRP();
      regenerateTP();
      troops = troops.filter((t) => !t.dead);
      battlePhaseActive = false;
      if (tower1.hp <= 0) {
        alert("Player 2 Wins!");
        return;
      } else if (tower2.hp <= 0) {
        alert("Player 1 Wins!");
        return;
      }
      firstMover = firstMover === "player1" ? "player2" : "player1";
      currentGamePhase = "planning_" + firstMover;
      phaseStartTime = performance.now();
      updatePhaseDisplay();
    }
  }
  requestAnimationFrame(battleLoop);
}

// ---------------------------
// Next Phase Helpers
function otherPlayer(player) {
  return player === "player1" ? "player2" : "player1";
}
function getNextPhase() {
  if (currentGamePhase === "battle") {
    let nextFirstMover = otherPlayer(firstMover);
    return "planning_" + nextFirstMover;
  } else if (currentGamePhase.startsWith("planning_")) {
    if (currentGamePhase === "planning_" + firstMover)
      return "planning_" + otherPlayer(firstMover);
    else return "battle";
  }
  return "";
}
function formatPhaseText(phase) {
  let displayText = "",
    color = "";
  if (phase === "battle") {
    displayText = "Battle";
    color = "yellow";
  } else if (phase === "planning_player1") {
    displayText = "Planning Player 1";
    color = "dodgerblue";
  } else if (phase === "planning_player2") {
    displayText = "Planning Player 2";
    color = "red";
  }
  return { displayText, color };
}

// ---------------------------
// Phase Display and Switching
function updatePhaseDisplay() {
  let totalTime =
    currentGamePhase === "battle" ? battlePhaseDuration : planningDuration;
  let elapsed = (performance.now() - phaseStartTime) / 1000;
  let remaining = Math.max(totalTime - elapsed, 0);
  const fraction = Math.min(elapsed / totalTime, 1) * 100;
  const phaseBar = document.getElementById("phaseProgressBar");
  if (phaseBar) {
    phaseBar.style.width = fraction + "%";
  }
  let currentPhaseFormatted = formatPhaseText(currentGamePhase);
  let nextPhaseFormatted = formatPhaseText(getNextPhase());
  let pauseNote = paused ? " (Paused)" : "";
  let displayHTML = `
    Current Phase: <span style="color:${
      currentPhaseFormatted.color
    }; font-weight:bold;">${
    currentPhaseFormatted.displayText
  }${pauseNote}</span><br>
    Next Phase: <span style="color:${nextPhaseFormatted.color};">${
    nextPhaseFormatted.displayText
  }</span><br>
    Time Remaining: <span>${remaining.toFixed(1)}s</span>
  `;
  document.getElementById("phaseDisplay").innerHTML = displayHTML;
  if (currentGamePhase !== "battle" && elapsed >= totalTime && !paused) {
    if (currentGamePhase === "planning_" + firstMover)
      currentGamePhase = "planning_" + otherPlayer(firstMover);
    else {
      currentGamePhase = "battle";
      phaseStartTime = performance.now();
      startBattlePhaseLive();
      return;
    }
    phaseStartTime = performance.now();
  }
}
function animatePhaseProgress() {
  if (!paused) updatePhaseDisplay();
  requestAnimationFrame(animatePhaseProgress);
}

// ---------------------------
// Pause Button
document.getElementById("pauseBtn").addEventListener("click", function () {
  if (!paused) {
    paused = true;
    pauseStartTime = performance.now();
    this.innerText = "Resume";
  } else {
    let pausedDuration = performance.now() - pauseStartTime;
    phaseStartTime += pausedDuration;
    paused = false;
    this.innerText = "Pause";
  }
});

// ---------------------------
// Canvas Event Handling
canvas.addEventListener("click", function (e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (currentMode === "spawn") {
    if (
      (currentSpawn.owner === "player1" &&
        currentGamePhase === "planning_player1") ||
      (currentSpawn.owner === "player2" &&
        currentGamePhase === "planning_player2")
    ) {
      const preciseCol = Math.round((x / tileSize) * 2) / 2;
      const preciseRow =
        Math.round(((y - pointerTipOffset) / tileSize) * 2) / 2;
      if (
        grid[Math.floor(preciseRow)][Math.floor(preciseCol)].owner !==
        currentSpawn.owner
      )
        alert("You cannot spawn in a tile you do not control!");
      else
        spawnTroopAt(
          currentSpawn.owner,
          currentSpawn.type,
          preciseRow,
          preciseCol
        );
    } else alert("Invalid spawn phase!");
    currentSpawn = null;
    currentMode = null;
    spawnSpecter = null;
    document.getElementById("spawnModeDisplay").innerText = "";
  } else if (currentMode === "build") {
    if (
      (currentBuild.owner === "player1" &&
        currentGamePhase === "planning_player1") ||
      (currentBuild.owner === "player2" &&
        currentGamePhase === "planning_player2")
    ) {
      const gridRow = Math.floor((y - pointerTipOffset) / tileSize);
      const gridCol = Math.floor(x / tileSize);
      const bType = buildingTypes[currentBuild.type];
      const width = bType.size.width,
        height = bType.size.height;
      if (
        !isBuildAreaValid(currentBuild.owner, gridRow, gridCol, width, height)
      )
        alert("Invalid build area!");
      else if (currentTP[currentBuild.owner] < bType.cost)
        alert(
          currentBuild.owner +
            " does not have enough TP to build a " +
            currentBuild.type +
            "!"
        );
      else {
        currentTP[currentBuild.owner] -= bType.cost;
        let building = {
          owner: currentBuild.owner,
          type: currentBuild.type,
          row: gridRow,
          col: gridCol,
          width: width,
          height: height,
          hp: bType.hp,
          maxHP: bType.hp,
          activationTime: bType.activationTime,
          active: bType.activationTime <= 0,
        };
        if (building.type === "farm") building.bonusTimer = 0;
        buildings.push(building);
        buildSpecter = null;
        currentBuild = null;
        currentMode = null;
        document.getElementById("buildModeDisplay").innerText = "";
        drawAll();
        updateResourcesDisplay();
      }
    } else alert("Invalid build phase!");
  } else if (currentMode === "strategem") {
    if (
      (currentStrategem.owner === "player1" &&
        currentGamePhase === "planning_player1") ||
      (currentStrategem.owner === "player2" &&
        currentGamePhase === "planning_player2")
    ) {
      if (currentStrategem.type === "heal") {
        const gridRow = Math.floor((y - pointerTipOffset) / tileSize);
        const gridCol = Math.floor(x / tileSize);
        if (currentTP[currentStrategem.owner] < 2)
          alert(
            currentStrategem.owner +
              " does not have enough TP to place Heal strategem!"
          );
        else {
          currentTP[currentStrategem.owner] -= 2;
          let strategem = {
            owner: currentStrategem.owner,
            type: "heal",
            row: gridRow,
            col: gridCol,
            duration: 7.5,
            tickAccumulator: 0,
            elapsed: 0,
          };
          strategems.push(strategem);
          currentStrategem = null;
          currentMode = null;
          document.getElementById("buildModeDisplay").innerText = "";
          strategemSpecter = null;
          updateResourcesDisplay();
          drawAll();
        }
      } else if (currentStrategem.type === "divineWind") {
        const gridRow = Math.floor((y - pointerTipOffset) / tileSize);
        if (currentTP[currentStrategem.owner] < 1)
          alert(
            currentStrategem.owner +
              " does not have enough TP to place Divine Wind strategem!"
          );
        else {
          currentTP[currentStrategem.owner] -= 1;
          let strategem = {
            owner: currentStrategem.owner,
            type: "divineWind",
            row: gridRow,
            col: 0,
            startup: 2,
            duration: 8,
            elapsed: 0,
          };
          strategems.push(strategem);
          currentStrategem = null;
          currentMode = null;
          document.getElementById("buildModeDisplay").innerText = "";
          strategemSpecter = null;
          updateResourcesDisplay();
          drawAll();
        }
      } else if (currentStrategem.type === "boltStorm") {
        let gridRow = Math.floor((y - pointerTipOffset) / tileSize);
        let gridCol = Math.floor(x / tileSize);
        if (gridRow > rows - 4) gridRow = rows - 4;
        if (gridCol > cols - 4) gridCol = cols - 4;
        if (currentTP[currentStrategem.owner] < 3)
          alert(
            currentStrategem.owner +
              " does not have enough TP to place Bolt Storm strategem!"
          );
        else {
          currentTP[currentStrategem.owner] -= 3;
          let strategem = {
            owner: currentStrategem.owner,
            type: "boltStorm",
            row: gridRow,
            col: gridCol,
            startup: 8,
            duration: 40,
            totalElapsed: 0,
            chargeTimer: 0,
            strikesRemaining: 5,
          };
          strategems.push(strategem);
          currentStrategem = null;
          currentMode = null;
          document.getElementById("buildModeDisplay").innerText = "";
          strategemSpecter = null;
          updateResourcesDisplay();
          drawAll();
        }
      }
    } else alert("Invalid strategem phase!");
  }
});

canvas.addEventListener("mousemove", function (e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  if (currentMode === "spawn" && currentSpawn) {
    const preciseCol = Math.round((x / tileSize) * 2) / 2;
    const preciseRow = Math.round(((y - pointerTipOffset) / tileSize) * 2) / 2;
    spawnSpecter = {
      owner: currentSpawn.owner,
      type: currentSpawn.type,
      row: preciseRow,
      col: preciseCol,
    };
    drawAll();
  } else if (currentMode === "build" && currentBuild) {
    const gridRow = Math.floor((y - pointerTipOffset) / tileSize);
    const gridCol = Math.floor(x / tileSize);
    buildSpecter = {
      owner: currentBuild.owner,
      type: currentBuild.type,
      row: gridRow,
      col: gridCol,
      width: buildingTypes[currentBuild.type].size.width,
      height: buildingTypes[currentBuild.type].size.height,
    };
    drawAll();
  } else if (currentMode === "strategem" && currentStrategem) {
    if (currentStrategem.type === "heal") {
      const preciseCol = Math.round((x / tileSize) * 2) / 2;
      const preciseRow =
        Math.round(((y - pointerTipOffset) / tileSize) * 2) / 2;
      strategemSpecter = {
        owner: currentStrategem.owner,
        type: currentStrategem.type,
        row: preciseRow,
        col: preciseCol,
      };
    } else if (currentStrategem.type === "divineWind") {
      let startRow = Math.floor((y - pointerTipOffset) / tileSize);
      strategemSpecter = {
        owner: currentStrategem.owner,
        type: currentStrategem.type,
        row: startRow,
        col: 0,
      };
    } else if (currentStrategem.type === "boltStorm") {
      let startRow = Math.floor((y - pointerTipOffset) / tileSize);
      let startCol = Math.floor(x / tileSize);
      if (startRow > rows - 4) startRow = rows - 4;
      if (startCol > cols - 4) startCol = cols - 4;
      strategemSpecter = {
        owner: currentStrategem.owner,
        type: currentStrategem.type,
        row: startRow,
        col: startCol,
      };
    }
    drawAll();
  }
});

// ---------------------------
// Spawn Mode
function setSpawnMode(owner, type) {
  if (currentGamePhase !== "planning_" + owner) {
    alert("It's not " + owner + "'s planning phase!");
    return;
  }
  currentMode = "spawn";
  currentSpawn = { owner, type };
  document.getElementById("spawnModeDisplay").innerText =
    "Spawn Mode: " +
    owner +
    " " +
    type +
    " – Click on a valid spawn point (only normal territory allowed).";
}

function spawnTroopAt(owner, type, preciseRow, preciseCol) {
  const tileRow = Math.floor(preciseRow),
    tileCol = Math.floor(preciseCol);
  let tile = grid[tileRow][tileCol];
  if (tile.type !== "normal") {
    alert("You cannot spawn on a tower or blocked tile!");
    return;
  }
  if (tile.owner !== owner) {
    alert("You cannot spawn in a tile you do not control!");
    return;
  }
  const cost = troopTypes[type].cost;
  if (currentRP[owner] < cost) {
    alert(owner + " does not have enough RP to spawn a " + type + "!");
    return;
  }
  currentRP[owner] -= cost;
  playSound(spawnSound);
  const troop = new Troop(owner, preciseRow, preciseCol, type);
  troops.push(troop);
  tile.owner = owner;
  spawnSpecter = null;
  drawAll();
  updateResourcesDisplay();
}

// ---------------------------
// Initialization
initializeTerritory();
drawAll();
updateResourcesDisplay();
currentGamePhase = "planning_player1";
phaseStartTime = performance.now();
animatePhaseProgress();
