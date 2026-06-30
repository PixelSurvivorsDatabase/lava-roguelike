import * as THREE from 'three';
import './style.css';

const STORAGE_KEY = 'lavaRoguelikeStormforgeAbyss';
const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(rand(min, max + 1));
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (a, b) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
};

const BALANCE = {
  playerBaseHp: 125,
  playerSpeed: 9.2,
  enemyWaveBase: 2,
  eliteChance: 0.04,
  weatherChance: 0.18,
  enemyDamageMult: 0.72,
  enemySpeedMult: 0.82,
  enemyHpMult: 0.82
};

const defaultSave = {
  abyssShards: 0,
  bestFloor: 1,
  bestCoins: 0,
  runs: 0,
  upgrades: { heart: 0, blade: 0, dash: 0 }
};

const saveData = (() => {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    return {
      ...defaultSave,
      ...stored,
      upgrades: { ...defaultSave.upgrades, ...(stored.upgrades || {}) }
    };
  } catch {
    return structuredClone(defaultSave);
  }
})();

function persistSave() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saveData));
}

class Input {
  constructor(canvas) {
    this.keys = new Set();
    this.mouse = new THREE.Vector2();
    this.attackQueued = false;
    this.pointerLocked = false;
    this.cameraYaw = 0;
    this.cameraPitch = -0.62;

    window.addEventListener('keydown', (e) => {
      const key = e.key.toLowerCase();
      this.keys.add(key);
      if (['w', 'a', 's', 'd', ' ', 'shift'].includes(key)) e.preventDefault();
    });

    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('mousemove', (e) => {
      this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

      if (this.pointerLocked) {
        this.cameraYaw -= e.movementX * 0.0024;
        this.cameraPitch = clamp(this.cameraPitch - e.movementY * 0.0018, -1.08, -0.25);
      }
    });
    window.addEventListener('mousedown', (e) => {
      if (e.button === 0) this.attackQueued = true;
    });
    window.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
  }

  down(key) {
    return this.keys.has(key.toLowerCase());
  }
}

class Toasts {
  constructor(root) {
    this.root = root;
  }

  show(text, kind = 'normal') {
    const node = document.createElement('div');
    node.className = `toast ${kind}`;
    node.textContent = text;
    this.root.appendChild(node);
    setTimeout(() => node.classList.add('gone'), 2600);
    setTimeout(() => node.remove(), 3300);
  }
}

class StormforgeGame {
  constructor() {
    this.canvas = document.querySelector('#game');
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070912);
    this.scene.fog = new THREE.Fog(0x070912, 34, 105);
    this.camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 180);
    this.clock = new THREE.Clock();
    this.raycaster = new THREE.Raycaster();
    this.mousePlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

    this.input = new Input(this.canvas);
    this.toasts = new Toasts(document.querySelector('#toasts'));
    this.ui = this.getUI();
    this.materials = this.createMaterials();
    this.relicCatalog = this.createRelics();

    this.state = 'menu';
    this.nextId = 1;
    this.screenShake = 0;
    this.clearLists();
    this.setupScene();
    this.setupMenu();
    this.bindButtons();

    window.addEventListener('resize', () => this.onResize());
    this.onResize();
    this.loop();
  }

  getUI() {
    return {
      menu: document.querySelector('#menu'),
      reward: document.querySelector('#reward'),
      rewardCards: document.querySelector('#rewardCards'),
      gameover: document.querySelector('#gameover'),
      hpBar: document.querySelector('#hpBar'),
      energyBar: document.querySelector('#energyBar'),
      xpBar: document.querySelector('#xpBar'),
      hpText: document.querySelector('#hpText'),
      energyText: document.querySelector('#energyText'),
      xpText: document.querySelector('#xpText'),
      floorText: document.querySelector('#floorText'),
      coinText: document.querySelector('#coinText'),
      shardText: document.querySelector('#shardText'),
      relicList: document.querySelector('#relicList'),
      objective: document.querySelector('#objective'),
      codex: document.querySelector('#codexLine'),
      runStats: document.querySelector('#runStats'),
      saveStats: document.querySelector('#saveStats'),
      upgradeButtons: document.querySelector('#upgradeButtons')
    };
  }

  clearLists() {
    this.enemies = [];
    this.enemyProjectiles = [];
    this.pickups = [];
    this.effects = [];
    this.puddles = [];
    this.currentWeather = null;
    this.weatherTimer = 0;
    this.weatherTick = 0;
  }

  createMaterials() {
    const mat = (color, roughness = 0.72, metalness = 0.05) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
    return {
      floor: mat(0x121827),
      grid: mat(0x1b2540),
      player: mat(0xff5b24, 0.45, 0.25),
      playerCore: new THREE.MeshStandardMaterial({ color: 0xffcf74, emissive: 0xff4a10, emissiveIntensity: 0.7, roughness: 0.35 }),
      enemySlime: new THREE.MeshStandardMaterial({ color: 0xff8b21, emissive: 0x551500, emissiveIntensity: 0.25, roughness: 0.8 }),
      enemyBat: new THREE.MeshStandardMaterial({ color: 0x66d9ff, emissive: 0x064070, emissiveIntensity: 0.5, roughness: 0.45 }),
      enemyDrone: new THREE.MeshStandardMaterial({ color: 0xb6bac9, metalness: 0.45, roughness: 0.38 }),
      enemyBoss: new THREE.MeshStandardMaterial({ color: 0xb55cff, emissive: 0x220033, emissiveIntensity: 0.45, roughness: 0.4 }),
      coin: new THREE.MeshStandardMaterial({ color: 0xffce32, emissive: 0x9b5d00, emissiveIntensity: 0.65, roughness: 0.35, metalness: 0.2 }),
      shard: new THREE.MeshStandardMaterial({ color: 0xbd7bff, emissive: 0x4a1399, emissiveIntensity: 0.65, roughness: 0.2 }),
      lava: new THREE.MeshStandardMaterial({ color: 0xff4812, emissive: 0xff2600, emissiveIntensity: 1.35, roughness: 0.45, transparent: true, opacity: 0.82 }),
      storm: new THREE.MeshStandardMaterial({ color: 0x7ee8ff, emissive: 0x1baeff, emissiveIntensity: 1.1, roughness: 0.2, transparent: true, opacity: 0.72 }),
      void: new THREE.MeshStandardMaterial({ color: 0x6d4dff, emissive: 0x211088, emissiveIntensity: 0.9, roughness: 0.2, transparent: true, opacity: 0.78 }),
      white: new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x77ddff, emissiveIntensity: 1.2, roughness: 0.2 })
    };
  }

  setupScene() {
    this.scene.add(new THREE.HemisphereLight(0x85aaff, 0x130b08, 1.2));
    const sun = new THREE.DirectionalLight(0xffffff, 2.1);
    sun.position.set(-20, 36, 18);
    sun.castShadow = true;
    sun.shadow.camera.left = -45;
    sun.shadow.camera.right = 45;
    sun.shadow.camera.top = 45;
    sun.shadow.camera.bottom = -45;
    sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(sun);

    const arena = new THREE.Mesh(new THREE.CylinderGeometry(31, 31, 1.1, 96), this.materials.floor);
    arena.receiveShadow = true;
    arena.position.y = -0.55;
    this.scene.add(arena);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(31.3, 0.28, 8, 128), this.materials.lava);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.07;
    this.scene.add(ring);

    for (let i = -28; i <= 28; i += 4) {
      const barA = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.03, 56), this.materials.grid);
      const barB = new THREE.Mesh(new THREE.BoxGeometry(56, 0.03, 0.035), this.materials.grid);
      barA.position.set(i, 0.02, 0);
      barB.position.set(0, 0.025, i);
      this.scene.add(barA, barB);
    }

    const obeliskGeo = new THREE.ConeGeometry(1.2, 7, 5);
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const mesh = new THREE.Mesh(obeliskGeo, this.materials.void);
      const radius = rand(34, 46);
      mesh.position.set(Math.cos(angle) * radius, 2.8, Math.sin(angle) * radius);
      mesh.rotation.y = angle + rand(-0.4, 0.4);
      mesh.castShadow = true;
      this.scene.add(mesh);
    }
  }

  setupMenu() {
    this.ui.saveStats.textContent = `Abyss Shards: ${saveData.abyssShards} • Best Floor: ${saveData.bestFloor} • Runs: ${saveData.runs}`;
    this.renderUpgradeButtons();
  }

  renderUpgradeButtons() {
    const upgrades = [
      { key: 'heart', label: 'Magma Heart', desc: '+10 max HP per rank', cost: 3 + saveData.upgrades.heart * 4 },
      { key: 'blade', label: 'Stormblade Edge', desc: '+1 melee damage per rank', cost: 4 + saveData.upgrades.blade * 5 },
      { key: 'dash', label: 'Overclock Dash', desc: '-4% dash cooldown per rank', cost: 5 + saveData.upgrades.dash * 6 }
    ];
    this.ui.upgradeButtons.innerHTML = '';
    for (const upgrade of upgrades) {
      const btn = document.createElement('button');
      btn.className = 'upgrade-btn';
      btn.innerHTML = `<strong>${upgrade.label}</strong><span>${upgrade.desc}</span><em>Cost: ${upgrade.cost} shards • Rank ${saveData.upgrades[upgrade.key]}</em>`;
      btn.disabled = saveData.abyssShards < upgrade.cost;
      btn.addEventListener('click', () => {
        if (saveData.abyssShards < upgrade.cost) return;
        saveData.abyssShards -= upgrade.cost;
        saveData.upgrades[upgrade.key] += 1;
        persistSave();
        this.setupMenu();
        this.toasts.show(`${upgrade.label} upgraded. The Abyss is already annoyed.`, 'good');
      });
      this.ui.upgradeButtons.appendChild(btn);
    }
  }

  bindButtons() {
    document.querySelector('#startBtn').addEventListener('click', () => this.startRun());
    document.querySelector('#restartBtn').addEventListener('click', () => this.startRun());
    document.querySelector('#menuBtn').addEventListener('click', () => this.showMenu());
    document.querySelector('#lockBtn').addEventListener('click', () => this.canvas.requestPointerLock?.());
  }

  createRelics() {
    return [
      { id: 'tiny-thundercloud', name: 'Tiny Thundercloud', rarity: 'common', desc: 'A tiny cloud zaps random enemies every few seconds.', apply: () => { this.player.flags.thunderCloud = true; this.player.thunderCloudTimer = 1.5; } },
      { id: 'lava-coin-magnet', name: 'Lava Coin Magnet', rarity: 'common', desc: 'Coins and shards fly toward you from much farther away.', apply: () => { this.player.flags.coinMagnet = true; } },
      { id: 'pocket-bidoof', name: 'Pocket Bidoof', rarity: 'rare', desc: 'Blocks one fatal hit. Makes the Abyss question its life choices.', apply: () => { this.player.flags.bidoofReady = true; } },
      { id: 'magma-heart', name: 'Magma Heart', rarity: 'rare', desc: 'Heal 25 HP now. Future heals explode into lava damage.', apply: () => { this.player.flags.magmaHeart = true; this.healPlayer(25, true); } },
      { id: 'storm-momentum', name: 'Storm Momentum Core', rarity: 'starter', desc: 'Dashing gives temporary damage stacks. This is your first nonsense engine.', apply: () => { this.player.flags.stormMomentum = true; } },
      { id: 'magma-trail', name: 'Magma Trail', rarity: 'rare', desc: 'Dashing leaves burning lava puddles behind you.', apply: () => { this.player.flags.lavaDash = true; } },
      { id: 'void-receipt', name: 'Gravity Receipt', rarity: 'rare', desc: 'Your attacks pull enemies inward before the hit lands.', apply: () => { this.player.flags.voidPull = true; } },
      { id: 'rift-crown', name: 'Rift Crown', rarity: 'legendary', desc: 'Reward rooms offer 4 choices instead of 3, but elites appear slightly more often.', apply: () => { this.player.flags.doubleReward = true; } },
      { id: 'hyperbeam-core', name: 'Hyper Beam Core', rarity: 'legendary', desc: 'Press E to fire a huge beam. It overheats, because balance exists sometimes.', apply: () => { this.player.flags.hyperBeam = true; } },
      { id: 'ashfang-spark', name: 'Ashfang Spark', rarity: 'common', desc: '+2 melee damage and slashes briefly burn enemies.', apply: () => { this.player.damage += 2; this.player.flags.burningBlade = true; } },
      { id: 'overclock-boots', name: 'Overclock Boots', rarity: 'common', desc: 'Dash cooldown is shorter. Movement demon arc begins.', apply: () => { this.player.dashCooldownMult = (this.player.dashCooldownMult || 1) * 0.82; } }
    ];
  }

  showMenu() {
    this.state = 'menu';
    this.clearRunObjects();
    this.ui.menu.classList.remove('hidden');
    this.ui.gameover.classList.add('hidden');
    this.ui.reward.classList.add('hidden');
    this.setupMenu();
  }

  startRun() {
    this.clearRunObjects();
    this.state = 'playing';
    this.floor = 1;
    this.room = 1;
    this.coinsEarned = 0;
    this.shardsEarned = 0;
    this.ui.menu.classList.add('hidden');
    this.ui.gameover.classList.add('hidden');
    this.ui.reward.classList.add('hidden');

    const maxHp = BALANCE.playerBaseHp + saveData.upgrades.heart * 10;
    this.player = {
      pos: new THREE.Vector3(0, 0.8, 0),
      vel: new THREE.Vector3(),
      facing: new THREE.Vector3(0, 0, -1),
      radius: 0.75,
      hp: maxHp,
      maxHp,
      energy: 100,
      xp: 0,
      level: 1,
      coins: 0,
      shards: 0,
      damage: 14 + saveData.upgrades.blade,
      attackCd: 0,
      dashCd: 0,
      thunderCd: 0,
      hyperCd: 0,
      invuln: 0,
      combo: 0,
      stormStacks: 0,
      stormStackTimer: 0,
      relics: [],
      flags: { bidoofReady: false, coinMagnet: false, thunderCloud: false, lavaDash: false, voidPull: false, doubleReward: false, hyperBeam: false, stormMomentum: false, burningBlade: false, magmaHeart: false }
    };
    this.player.mesh = this.createPlayerMesh();
    this.scene.add(this.player.mesh);
    this.addRelic(this.relicCatalog.find((r) => r.id === 'storm-momentum'), false);
    this.spawnWave();
    this.toasts.show('Run started. Movement fixed. Enemies nerfed.', 'good');
    this.setCodex('Codex Buddy: A/D are fixed now. The Abyss has been nerfed for early runs.');
  }

  clearRunObjects() {
    const removable = [...this.enemies, ...this.enemyProjectiles, ...this.pickups, ...this.effects, ...this.puddles];
    if (this.player?.mesh) removable.push(this.player);
    for (const item of removable) if (item?.mesh) this.scene.remove(item.mesh);
    this.clearLists();
    this.player = null;
  }

  createPlayerMesh() {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.48, 0.8, 6, 12), this.materials.player);
    body.castShadow = true;
    body.position.y = 0.55;
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), this.materials.playerCore);
    core.position.set(0, 0.82, -0.36);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 1.45), this.materials.storm);
    blade.position.set(0.62, 0.7, -0.22);
    blade.rotation.set(0.35, 0.2, 0.05);
    group.add(body, core, blade);
    group.position.copy(this.player.pos);
    return group;
  }

  addRelic(relic, announce = true) {
    if (!relic || !this.player) return;
    this.player.relics.push({ ...relic });
    relic.apply();
    if (announce) this.toasts.show(`Relic acquired: ${relic.name}`, 'good');
    this.renderRelics();
  }

  renderRelics() {
    this.ui.relicList.innerHTML = '';
    for (const relic of this.player.relics) {
      const node = document.createElement('div');
      node.className = `relic-pill ${relic.rarity}`;
      node.textContent = relic.name;
      node.title = relic.desc;
      this.ui.relicList.appendChild(node);
    }
  }

  spawnWave() {
    const bossRoom = this.floor % 5 === 0 && this.room === 3;
    if (bossRoom) {
      this.spawnEnemy('siren', new THREE.Vector3(0, 1, -15), true);
      this.currentWeather = 'lightning';
      this.weatherTimer = 60;
      this.setCodex('Codex Buddy: Winged Siren detected. This version should be survivable now.');
      return;
    }

    const count = BALANCE.enemyWaveBase + this.floor + Math.ceil(this.room * 0.75);
    const eliteChance = this.player.flags.doubleReward ? 0.11 : BALANCE.eliteChance + this.floor * 0.006;
    for (let i = 0; i < count; i++) {
      const angle = rand(0, Math.PI * 2);
      const radius = rand(11, 25);
      const pos = new THREE.Vector3(Math.cos(angle) * radius, 0.8, Math.sin(angle) * radius);
      const type = pick(this.floor < 2 ? ['slime', 'slime', 'bat'] : ['slime', 'bat', 'drone']);
      this.spawnEnemy(type, pos, Math.random() < eliteChance);
    }
    this.maybeStartWeather();
  }

  spawnEnemy(type, pos, elite = false) {
    const enemy = { id: this.nextId++, type, elite, pos: pos.clone(), vel: new THREE.Vector3(), radius: elite ? 1.02 : 0.75, hp: 24, maxHp: 24, damage: 4, speed: 3.2, attackCd: rand(0.7, 1.8), frozen: 0, burn: 0, burnTick: 0.45 };
    if (type === 'bat') Object.assign(enemy, { hp: 18 + this.floor * 2, damage: 4, speed: 4.6, radius: 0.7 });
    else if (type === 'drone') Object.assign(enemy, { hp: 21 + this.floor * 3, damage: 5, speed: 2.5, radius: 0.82 });
    else if (type === 'siren') Object.assign(enemy, { hp: 360 + this.floor * 30, damage: 8, speed: 2.8, radius: 2.1, phase: 1 });
    else Object.assign(enemy, { hp: 22 + this.floor * 3, damage: 4, speed: 3.1 });

    enemy.hp *= BALANCE.enemyHpMult;
    enemy.damage *= BALANCE.enemyDamageMult;
    enemy.speed *= BALANCE.enemySpeedMult;
    enemy.maxHp = enemy.hp;

    if (elite) {
      enemy.hp *= 1.55;
      enemy.maxHp = enemy.hp;
      enemy.damage *= 1.1;
      enemy.speed *= 1.02;
      enemy.radius *= 1.12;
    }
    enemy.mesh = this.createEnemyMesh(enemy);
    this.scene.add(enemy.mesh);
    this.enemies.push(enemy);
    return enemy;
  }

  createEnemyMesh(enemy) {
    const group = new THREE.Group();
    let mesh;
    if (enemy.type === 'bat') {
      mesh = new THREE.Mesh(new THREE.OctahedronGeometry(enemy.elite ? 0.95 : 0.68, 0), this.materials.enemyBat);
      mesh.position.y = 1.05;
      const wingGeo = new THREE.BoxGeometry(1.4, 0.08, 0.38);
      const w1 = new THREE.Mesh(wingGeo, this.materials.storm);
      const w2 = w1.clone();
      w1.position.set(-0.65, 1.02, 0);
      w2.position.set(0.65, 1.02, 0);
      group.add(w1, w2);
    } else if (enemy.type === 'drone') {
      mesh = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.95, 0.95), this.materials.enemyDrone);
      mesh.position.y = 0.9;
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.18, 12, 8), this.materials.lava);
      eye.position.set(0, 0.95, -0.53);
      group.add(eye);
    } else if (enemy.type === 'siren') {
      mesh = new THREE.Mesh(new THREE.CapsuleGeometry(1.1, 2.2, 8, 16), this.materials.enemyBoss);
      mesh.position.y = 1.45;
      const wingGeo = new THREE.BoxGeometry(3.6, 0.16, 1.05);
      const leftWing = new THREE.Mesh(wingGeo, this.materials.storm);
      const rightWing = leftWing.clone();
      leftWing.position.set(-2.1, 1.7, 0.2);
      rightWing.position.set(2.1, 1.7, 0.2);
      leftWing.rotation.z = 0.25;
      rightWing.rotation.z = -0.25;
      group.add(leftWing, rightWing);
    } else {
      mesh = new THREE.Mesh(new THREE.SphereGeometry(0.72, 16, 12), this.materials.enemySlime);
      mesh.scale.y = 0.72;
      mesh.position.y = 0.42;
    }
    mesh.castShadow = true;
    group.add(mesh);
    group.position.copy(enemy.pos);
    if (enemy.elite) group.scale.multiplyScalar(1.18);
    return group;
  }

  maybeStartWeather() {
    const chance = BALANCE.weatherChance + this.floor * 0.02;
    if (Math.random() > chance) return;
    this.currentWeather = pick(['ashfall', 'lightning', 'meteor']);
    this.weatherTimer = rand(12, 18);
    this.toasts.show({ ashfall: 'Ashfall: lava zones appear.', lightning: 'Lightning Outbreak: watch the circles.', meteor: 'Meteor Rain: dodge the sky.' }[this.currentWeather], 'warn');
  }

  update(dt) {
    if (this.state !== 'playing') return;
    this.updatePlayer(dt);
    this.updateEnemies(dt);
    this.updateProjectiles(dt);
    this.updatePickups(dt);
    this.updatePuddles(dt);
    this.updateEffects(dt);
    this.updateWeather(dt);
    this.updateCamera(dt);
    this.updateUI();
    if (this.enemies.length === 0 && this.state === 'playing') this.roomCleared();
  }

  updatePlayer(dt) {
    const p = this.player;
    p.attackCd = Math.max(0, p.attackCd - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.thunderCd = Math.max(0, p.thunderCd - dt);
    p.hyperCd = Math.max(0, p.hyperCd - dt);
    p.invuln = Math.max(0, p.invuln - dt);
    p.energy = Math.min(100, p.energy + 26 * dt);
    p.stormStackTimer = Math.max(0, p.stormStackTimer - dt);
    if (p.stormStackTimer <= 0) p.stormStacks = 0;

    if (p.flags.thunderCloud) {
      p.thunderCloudTimer -= dt;
      if (p.thunderCloudTimer <= 0) {
        const target = this.closestEnemy(p.pos, 18);
        if (target) {
          this.damageEnemy(target, 9 + p.level * 2, 'storm');
          this.createLightning(p.pos.clone().add(new THREE.Vector3(0, 5, 0)), target.pos.clone().add(new THREE.Vector3(0, 1, 0)));
        }
        p.thunderCloudTimer = 2.6;
      }
    }

    const forward = new THREE.Vector3(-Math.sin(this.input.cameraYaw), 0, -Math.cos(this.input.cameraYaw)).normalize();
    const right = new THREE.Vector3(Math.cos(this.input.cameraYaw), 0, -Math.sin(this.input.cameraYaw)).normalize();
    const move = new THREE.Vector3();
    if (this.input.down('w')) move.add(forward);
    if (this.input.down('s')) move.sub(forward);
    if (this.input.down('d')) move.add(right);
    if (this.input.down('a')) move.sub(right);
    if (move.lengthSq() > 0) move.normalize();

    const speed = BALANCE.playerSpeed + p.stormStacks * 0.25;
    const targetVel = move.multiplyScalar(speed);
    p.vel.x = lerp(p.vel.x, targetVel.x, 1 - Math.exp(-dt * 14));
    p.vel.z = lerp(p.vel.z, targetVel.z, 1 - Math.exp(-dt * 14));

    if (this.input.down('shift') && p.dashCd <= 0 && p.energy >= 16) this.dashPlayer();
    if (this.input.down('q') && p.thunderCd <= 0 && p.energy >= 28) this.thunderDash();
    if (this.input.down('e') && p.flags.hyperBeam && p.hyperCd <= 0 && p.energy >= 50) this.hyperBeam();
    if (this.input.attackQueued) {
      this.input.attackQueued = false;
      this.attack();
    }

    p.pos.addScaledVector(p.vel, dt);
    const len = Math.hypot(p.pos.x, p.pos.z);
    if (len > 28.5) {
      p.pos.x = (p.pos.x / len) * 28.5;
      p.pos.z = (p.pos.z / len) * 28.5;
      p.vel.multiplyScalar(0.3);
    }
    this.aimPlayerAtMouse();
    p.mesh.position.copy(p.pos);
    p.mesh.rotation.y = Math.atan2(p.facing.x, p.facing.z);
  }

  aimPlayerAtMouse() {
    if (this.input.pointerLocked) {
      this.player.facing.set(-Math.sin(this.input.cameraYaw), 0, -Math.cos(this.input.cameraYaw)).normalize();
      return;
    }
    this.raycaster.setFromCamera(this.input.mouse, this.camera);
    const hit = new THREE.Vector3();
    if (this.raycaster.ray.intersectPlane(this.mousePlane, hit)) {
      const dir = hit.sub(this.player.pos).setY(0);
      if (dir.lengthSq() > 0.2) this.player.facing.copy(dir.normalize());
    }
  }

  dashPlayer() {
    const p = this.player;
    p.energy -= 16;
    p.dashCd = 0.66 * (p.dashCooldownMult || 1) * (1 - saveData.upgrades.dash * 0.04);
    p.invuln = Math.max(p.invuln, 0.26);
    const dashDir = p.vel.lengthSq() > 1 ? p.vel.clone().setY(0).normalize() : p.facing.clone();
    if (p.flags.lavaDash) this.createLavaPuddle(p.pos.clone(), 2.4, 5.8, 9);
    p.pos.addScaledVector(dashDir, 4.6);
    this.createRingEffect(p.pos, 2.2, this.materials.storm, 0.32);
    if (p.flags.stormMomentum) {
      p.stormStacks = Math.min(10, p.stormStacks + 1);
      p.stormStackTimer = 4.5;
    }
  }

  thunderDash() {
    const p = this.player;
    p.energy -= 28;
    p.thunderCd = 4.1;
    p.invuln = Math.max(p.invuln, 0.42);
    const start = p.pos.clone();
    p.pos.addScaledVector(p.facing, 8.2);
    const len = Math.hypot(p.pos.x, p.pos.z);
    if (len > 28) {
      p.pos.x = (p.pos.x / len) * 28;
      p.pos.z = (p.pos.z / len) * 28;
    }
    this.createLightning(start.clone().add(new THREE.Vector3(0, 0.8, 0)), p.pos.clone().add(new THREE.Vector3(0, 0.8, 0)));
    this.createRingEffect(p.pos, 4.4, this.materials.storm, 0.45);
    for (const enemy of [...this.enemies]) {
      if (this.distanceToSegment(enemy.pos, start, p.pos) < enemy.radius + 1.4) this.damageEnemy(enemy, 28 + p.stormStacks * 3, 'storm');
    }
  }

  hyperBeam() {
    const p = this.player;
    p.energy -= 50;
    p.hyperCd = 8.5;
    p.invuln = Math.max(p.invuln, 0.38);
    const start = p.pos.clone().add(new THREE.Vector3(0, 1, 0));
    const end = p.pos.clone().addScaledVector(p.facing, 31).add(new THREE.Vector3(0, 1, 0));
    this.createBeam(start, end, this.materials.white, 0.42, 0.8);
    this.screenShake = 0.28;
    for (const enemy of [...this.enemies]) {
      if (this.distanceToSegment(enemy.pos, p.pos, p.pos.clone().addScaledVector(p.facing, 31)) < enemy.radius + 1.9) this.damageEnemy(enemy, 85 + p.stormStacks * 5, 'storm');
    }
  }

  attack() {
    const p = this.player;
    if (p.attackCd > 0) return;
    p.attackCd = 0.39;
    const hitPos = p.pos.clone().addScaledVector(p.facing, 1.4);
    this.createSlashEffect(hitPos, p.facing);

    if (p.flags.voidPull) {
      for (const enemy of this.enemies) {
        if (dist2(enemy.pos, p.pos) < 80) enemy.pos.addScaledVector(p.pos.clone().sub(enemy.pos).setY(0).normalize(), 0.75);
      }
    }

    let hits = 0;
    for (const enemy of [...this.enemies]) {
      const toEnemy = enemy.pos.clone().sub(p.pos).setY(0);
      if (toEnemy.length() > 2.8 + enemy.radius) continue;
      if (toEnemy.normalize().dot(p.facing) > 0.6) {
        hits++;
        this.damageEnemy(enemy, p.damage + p.stormStacks * 1.5, p.flags.burningBlade ? 'burning' : 'slash');
        if (p.flags.burningBlade) enemy.burn = Math.max(enemy.burn, 3.0);
      }
    }
    if (hits > 0) {
      p.combo += hits;
      p.energy = Math.min(100, p.energy + hits * 6);
      p.xp += hits * 2;
      if (p.xp >= 40 + p.level * 20) {
        p.xp = 0;
        p.level += 1;
        p.maxHp += 8;
        this.healPlayer(18, true);
        this.toasts.show(`Level ${p.level}: more storm, less problem.`, 'good');
      }
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    for (const enemy of [...this.enemies]) {
      enemy.attackCd -= dt;
      enemy.frozen = Math.max(0, enemy.frozen - dt);
      enemy.burn = Math.max(0, enemy.burn - dt);
      if (enemy.burn > 0) {
        enemy.burnTick -= dt;
        if (enemy.burnTick <= 0) {
          enemy.burnTick = 0.5;
          this.damageEnemy(enemy, 4 + this.floor, 'lava');
          if (!this.enemies.includes(enemy)) continue;
        }
      }
      if (enemy.frozen > 0) continue;

      const toPlayer = p.pos.clone().sub(enemy.pos).setY(0);
      const distance = Math.max(0.001, toPlayer.length());
      const dir = toPlayer.normalize();
      if (enemy.type === 'bat') {
        const tangent = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(Math.sin(performance.now() * 0.003 + enemy.id) * 0.65);
        enemy.vel.copy(dir.add(tangent).normalize().multiplyScalar(enemy.speed));
      } else if (enemy.type === 'drone') {
        const desired = distance > 13 ? dir : dir.clone().multiplyScalar(-0.45);
        enemy.vel.lerp(desired.multiplyScalar(enemy.speed), 1 - Math.exp(-dt * 4));
        if (enemy.attackCd <= 0 && distance < 20) {
          this.enemyShoot(enemy, dir);
          enemy.attackCd = enemy.elite ? 2.0 : 2.8;
        }
      } else if (enemy.type === 'siren') {
        enemy.phase = enemy.hp < enemy.maxHp * 0.5 ? 2 : 1;
        const tangent = new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(enemy.phase === 2 ? 0.9 : 0.55);
        enemy.vel.lerp(dir.clone().multiplyScalar(0.5).add(tangent).normalize().multiplyScalar(enemy.speed), 1 - Math.exp(-dt * 3));
        if (enemy.attackCd <= 0) {
          this.sirenAttack(enemy, dir);
          enemy.attackCd = enemy.phase === 2 ? 1.8 : 2.35;
        }
      } else {
        enemy.vel.lerp(dir.multiplyScalar(enemy.speed), 1 - Math.exp(-dt * 6));
      }

      enemy.pos.addScaledVector(enemy.vel, dt);
      const len = Math.hypot(enemy.pos.x, enemy.pos.z);
      if (len > 28.7) {
        enemy.pos.x = (enemy.pos.x / len) * 28.7;
        enemy.pos.z = (enemy.pos.z / len) * 28.7;
      }
      enemy.mesh.position.copy(enemy.pos);
      enemy.mesh.lookAt(p.pos.x, enemy.mesh.position.y, p.pos.z);
      if (distance < enemy.radius + p.radius && p.invuln <= 0) {
        this.damagePlayer(enemy.damage, enemy.type);
        p.pos.addScaledVector(p.pos.clone().sub(enemy.pos).setY(0).normalize(), 1.6);
      }
    }
  }

  enemyShoot(enemy, dir) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), this.materials.lava);
    const projectile = { mesh, pos: enemy.pos.clone().add(new THREE.Vector3(0, 1, 0)), vel: dir.clone().multiplyScalar(enemy.elite ? 7.5 : 6.2), radius: 0.35, damage: enemy.damage, life: 4.5 };
    mesh.position.copy(projectile.pos);
    this.scene.add(mesh);
    this.enemyProjectiles.push(projectile);
  }

  sirenAttack(enemy, dir) {
    if (Math.random() < 0.42) {
      this.enemyShoot(enemy, dir);
      if (enemy.phase === 2) this.enemyShoot(enemy, dir.clone().add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.22)).normalize());
    } else {
      const target = this.player.pos.clone();
      this.createDangerCircle(target, enemy.phase === 2 ? 3.2 : 2.6, 0.8, () => {
        this.createLightning(target.clone().add(new THREE.Vector3(0, 8, 0)), target.clone().add(new THREE.Vector3(0, 0.5, 0)));
        if (dist2(this.player.pos, target) < 12 && this.player.invuln <= 0) this.damagePlayer(enemy.damage + 4, 'siren lightning');
        for (const e of [...this.enemies]) if (e !== enemy && dist2(e.pos, target) < 10) this.damageEnemy(e, 14, 'storm');
      });
    }
  }

  damageEnemy(enemy, amount, type = 'neutral') {
    if (!this.enemies.includes(enemy)) return;
    enemy.hp -= amount;
    if (type === 'burning') enemy.burn = Math.max(enemy.burn, 2.6);
    this.floatingText(`-${Math.round(amount)}`, enemy.pos, type);
    if (enemy.hp <= 0) this.killEnemy(enemy);
  }

  killEnemy(enemy) {
    const idx = this.enemies.indexOf(enemy);
    if (idx !== -1) this.enemies.splice(idx, 1);
    this.scene.remove(enemy.mesh);
    const coinCount = enemy.type === 'siren' ? 22 : enemy.elite ? randInt(3, 5) : randInt(1, 3);
    for (let i = 0; i < coinCount; i++) this.spawnPickup('coin', enemy.pos.clone().add(new THREE.Vector3(rand(-0.8, 0.8), 0, rand(-0.8, 0.8))));
    if (enemy.elite || enemy.type === 'siren' || Math.random() < 0.08) this.spawnPickup('shard', enemy.pos.clone());
    this.createRingEffect(enemy.pos, enemy.type === 'siren' ? 7 : 2.5, enemy.type === 'siren' ? this.materials.void : this.materials.lava, 0.55);
  }

  damagePlayer(amount, source) {
    const p = this.player;
    if (p.invuln > 0) return;
    if (p.flags.bidoofReady && p.hp - amount <= 0) {
      p.flags.bidoofReady = false;
      p.hp = Math.max(1, p.maxHp * 0.38);
      p.invuln = 2.0;
      this.createRingEffect(p.pos, 7.5, this.materials.white, 0.75);
      this.toasts.show('Pocket Bidoof blocked a fatal hit. :skull:', 'good');
      return;
    }
    p.hp -= amount;
    p.invuln = 0.86;
    p.combo = 0;
    this.screenShake = Math.max(this.screenShake, 0.18);
    this.floatingText(`-${Math.round(amount)} HP`, p.pos, 'player');
    this.setCodex(`Codex Buddy: Hit by ${source}. At least it hurts less now.`);
    if (p.hp <= 0) this.gameOver();
  }

  healPlayer(amount, burst = false) {
    const p = this.player;
    const before = p.hp;
    p.hp = Math.min(p.maxHp, p.hp + amount);
    if (p.hp > before) this.floatingText(`+${Math.round(p.hp - before)}`, p.pos, 'heal');
    if (burst && p.flags?.magmaHeart) {
      this.createLavaPuddle(p.pos.clone(), 3.2, 3.8, 10);
      this.createRingEffect(p.pos, 5, this.materials.lava, 0.5);
    }
  }

  updateProjectiles(dt) {
    const p = this.player;
    for (const proj of [...this.enemyProjectiles]) {
      proj.life -= dt;
      proj.pos.addScaledVector(proj.vel, dt);
      proj.mesh.position.copy(proj.pos);
      if (proj.life <= 0 || Math.hypot(proj.pos.x, proj.pos.z) > 34) {
        this.removeProjectile(proj);
        continue;
      }
      if (dist2(proj.pos, p.pos) < (proj.radius + p.radius) ** 2 && p.invuln <= 0) {
        this.damagePlayer(proj.damage, 'projectile');
        this.removeProjectile(proj);
      }
    }
  }

  removeProjectile(proj) {
    const idx = this.enemyProjectiles.indexOf(proj);
    if (idx !== -1) this.enemyProjectiles.splice(idx, 1);
    this.scene.remove(proj.mesh);
  }

  spawnPickup(type, pos) {
    const geo = type === 'coin' ? new THREE.CylinderGeometry(0.22, 0.22, 0.09, 16) : new THREE.OctahedronGeometry(0.28, 0);
    const mesh = new THREE.Mesh(geo, type === 'coin' ? this.materials.coin : this.materials.shard);
    mesh.position.copy(pos);
    mesh.position.y = 0.45;
    mesh.castShadow = true;
    this.scene.add(mesh);
    this.pickups.push({ id: this.nextId++, type, mesh, pos: mesh.position, life: 40 });
  }

  updatePickups(dt) {
    const p = this.player;
    for (const pickup of [...this.pickups]) {
      pickup.life -= dt;
      pickup.mesh.rotation.y += dt * 4;
      pickup.mesh.position.y = pickup.pos.y + Math.sin(performance.now() * 0.004 + pickup.id) * 0.16;
      const attractDist = p.flags.coinMagnet ? 18 : 4.2;
      if (dist2(pickup.pos, p.pos) < attractDist * attractDist) pickup.pos.addScaledVector(p.pos.clone().sub(pickup.pos).normalize(), dt * (p.flags.coinMagnet ? 18 : 10));
      if (dist2(pickup.pos, p.pos) < 1.55) {
        if (pickup.type === 'coin') { p.coins += 1; this.coinsEarned += 1; }
        else { p.shards += 1; this.shardsEarned += 1; }
        this.removePickup(pickup);
      } else if (pickup.life <= 0) this.removePickup(pickup);
    }
  }

  removePickup(pickup) {
    const idx = this.pickups.indexOf(pickup);
    if (idx !== -1) this.pickups.splice(idx, 1);
    this.scene.remove(pickup.mesh);
  }

  createLavaPuddle(pos, radius = 2, life = 5, damage = 8) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.08, 28), this.materials.lava.clone());
    mesh.position.set(pos.x, 0.04, pos.z);
    this.scene.add(mesh);
    this.puddles.push({ mesh, pos: mesh.position, radius, life, maxLife: life, damage, tick: 0.1 });
  }

  updatePuddles(dt) {
    for (const puddle of [...this.puddles]) {
      puddle.life -= dt;
      puddle.tick -= dt;
      puddle.mesh.material.opacity = clamp(puddle.life / puddle.maxLife, 0, 0.82);
      if (puddle.tick <= 0) {
        puddle.tick = 0.4;
        for (const enemy of [...this.enemies]) if (dist2(enemy.pos, puddle.pos) < puddle.radius * puddle.radius) this.damageEnemy(enemy, puddle.damage, 'lava');
      }
      if (puddle.life <= 0) {
        this.scene.remove(puddle.mesh);
        this.puddles.splice(this.puddles.indexOf(puddle), 1);
      }
    }
  }

  updateWeather(dt) {
    if (!this.currentWeather) return;
    this.weatherTimer -= dt;
    if (this.weatherTimer <= 0) { this.currentWeather = null; return; }
    this.weatherTick -= dt;
    if (this.weatherTick > 0) return;

    if (this.currentWeather === 'lightning') {
      this.weatherTick = rand(1.0, 1.55);
      const target = Math.random() < 0.62 && this.enemies.length ? pick(this.enemies).pos.clone() : this.randomArenaPoint();
      this.createDangerCircle(target, 2.3, 0.55, () => {
        this.createLightning(target.clone().add(new THREE.Vector3(0, 9, 0)), target.clone().add(new THREE.Vector3(0, 0.5, 0)));
        if (dist2(this.player.pos, target) < 6.4 && this.player.invuln <= 0) this.damagePlayer(7 + this.floor, 'weather lightning');
        for (const e of [...this.enemies]) if (dist2(e.pos, target) < 7.4) this.damageEnemy(e, 16 + this.floor * 2, 'storm');
      });
    } else if (this.currentWeather === 'meteor') {
      this.weatherTick = rand(1.45, 2.1);
      const target = Math.random() < 0.35 ? this.player.pos.clone() : this.randomArenaPoint();
      this.createDangerCircle(target, 3.1, 0.95, () => {
        this.createRingEffect(target, 5.5, this.materials.lava, 0.65);
        this.createLavaPuddle(target, 2.6, 4.5, 10 + this.floor);
        if (dist2(this.player.pos, target) < 10 && this.player.invuln <= 0) this.damagePlayer(11 + this.floor, 'meteor');
        for (const e of [...this.enemies]) if (dist2(e.pos, target) < 11) this.damageEnemy(e, 24 + this.floor * 3, 'lava');
      });
    } else {
      this.weatherTick = 1.7;
      if (Math.random() < 0.45) this.createLavaPuddle(this.randomArenaPoint(), rand(1.4, 2.1), rand(2.5, 4), 7 + this.floor);
    }
  }

  randomArenaPoint() {
    const angle = rand(0, Math.PI * 2);
    const radius = Math.sqrt(Math.random()) * 25;
    return new THREE.Vector3(Math.cos(angle) * radius, 0.05, Math.sin(angle) * radius);
  }

  roomCleared() {
    this.state = 'reward';
    this.player.energy = Math.min(100, this.player.energy + 30);
    this.healPlayer(10 + this.floor * 2, true);
    this.setCodex('Codex Buddy: Arena cleared. Pick your next bad decision.');
    this.offerRewards();
  }

  offerRewards() {
    const amount = this.player.flags.doubleReward ? 4 : 3;
    const pool = this.relicCatalog.filter((r) => r.rarity !== 'starter');
    const offered = [];
    while (offered.length < amount && offered.length < pool.length) {
      const relic = pick(pool);
      if (!offered.some((r) => r.id === relic.id)) offered.push(relic);
    }
    this.ui.rewardCards.innerHTML = '';
    for (const relic of offered) {
      const card = document.createElement('button');
      card.className = `reward-card ${relic.rarity}`;
      card.innerHTML = `<span>${relic.rarity}</span><strong>${relic.name}</strong><p>${relic.desc}</p>`;
      card.addEventListener('click', () => this.chooseReward(relic));
      this.ui.rewardCards.appendChild(card);
    }
    this.ui.reward.classList.remove('hidden');
  }

  chooseReward(relic) {
    this.ui.reward.classList.add('hidden');
    this.addRelic(relic, true);
    this.room += 1;
    if (this.room > 3) {
      this.room = 1;
      this.floor += 1;
      this.toasts.show(`Floor ${this.floor}: The Abyss gets madder.`, 'warn');
    }
    this.state = 'playing';
    this.spawnWave();
  }

  gameOver() {
    this.state = 'gameover';
    saveData.runs += 1;
    saveData.abyssShards += this.shardsEarned;
    saveData.bestFloor = Math.max(saveData.bestFloor, this.floor);
    saveData.bestCoins = Math.max(saveData.bestCoins, this.coinsEarned);
    persistSave();
    this.ui.runStats.innerHTML = `Floor reached: <strong>${this.floor}-${this.room}</strong><br>Coins earned: <strong>${this.coinsEarned}</strong><br>Abyss Shards gained: <strong>${this.shardsEarned}</strong><br>Best Floor: <strong>${saveData.bestFloor}</strong>`;
    this.ui.gameover.classList.remove('hidden');
  }

  createDangerCircle(pos, radius, delay, callback) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.05, 40), this.materials.lava.clone());
    mesh.material.opacity = 0.28;
    mesh.position.set(pos.x, 0.08, pos.z);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: delay, maxLife: delay, update: (effect) => {
      effect.mesh.scale.setScalar(1 + Math.sin(performance.now() * 0.02) * 0.035);
      if (effect.life <= 0 && !effect.done) { effect.done = true; callback(); }
    } });
  }

  updateEffects(dt) {
    for (const effect of [...this.effects]) {
      effect.life -= dt;
      effect.update?.(effect, dt);
      if (effect.mesh?.material?.opacity !== undefined && effect.maxLife) effect.mesh.material.opacity = clamp(effect.life / effect.maxLife, 0, effect.mesh.material.opacity);
      if (effect.life <= -0.05) {
        this.scene.remove(effect.mesh);
        this.effects.splice(this.effects.indexOf(effect), 1);
      }
    }
  }

  createRingEffect(pos, radius, material, life = 0.5) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.08, 8, 64), material.clone());
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(pos.x, 0.16, pos.z);
    this.scene.add(mesh);
    this.effects.push({ mesh, life, maxLife: life, update: (effect) => effect.mesh.scale.setScalar(1 + (1 - effect.life / effect.maxLife) * 0.55) });
  }

  createSlashEffect(pos, dir) {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(1.15, 0.05, 8, 32, Math.PI * 1.25), this.materials.storm.clone());
    mesh.position.set(pos.x, 1.0, pos.z);
    mesh.rotation.x = Math.PI / 2;
    mesh.rotation.z = -Math.atan2(dir.z, dir.x);
    this.scene.add(mesh);
    this.effects.push({ mesh, life: 0.18, maxLife: 0.18, update: (effect, delta) => { effect.mesh.rotation.z += delta * 9; effect.mesh.scale.multiplyScalar(1.02); } });
  }

  createBeam(start, end, material, radius, life) {
    const mid = start.clone().lerp(end, 0.5);
    const length = start.distanceTo(end);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16, 1, true), material.clone());
    mesh.position.copy(mid);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), end.clone().sub(start).normalize());
    this.scene.add(mesh);
    this.effects.push({ mesh, life, maxLife: life, update: (effect) => { const p = effect.life / effect.maxLife; effect.mesh.scale.x = p; effect.mesh.scale.z = p; } });
  }

  createLightning(start, end) {
    const points = [];
    for (let i = 0; i <= 8; i++) {
      const p = start.clone().lerp(end, i / 8);
      p.x += rand(-0.4, 0.4);
      p.z += rand(-0.4, 0.4);
      points.push(p);
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: 0x8cf4ff, transparent: true, opacity: 1 }));
    this.scene.add(line);
    this.effects.push({ mesh: line, life: 0.18, maxLife: 0.18 });
  }

  floatingText(text, pos, kind) {
    const node = document.createElement('div');
    node.className = `float-text ${kind}`;
    node.textContent = text;
    document.body.appendChild(node);
    const start = pos.clone();
    const created = performance.now();
    const update = () => {
      const age = (performance.now() - created) / 1000;
      const projected = start.clone().add(new THREE.Vector3(0, 2.2 + age * 1.8, 0)).project(this.camera);
      node.style.left = `${(projected.x * 0.5 + 0.5) * window.innerWidth}px`;
      node.style.top = `${(-projected.y * 0.5 + 0.5) * window.innerHeight}px`;
      node.style.opacity = `${clamp(1 - age / 0.85, 0, 1)}`;
      if (age < 0.9) requestAnimationFrame(update);
      else node.remove();
    };
    update();
  }

  closestEnemy(pos, range) {
    let best = null;
    let bestD = range * range;
    for (const enemy of this.enemies) {
      const d = dist2(enemy.pos, pos);
      if (d < bestD) { best = enemy; bestD = d; }
    }
    return best;
  }

  distanceToSegment(point, a, b) {
    const ap = point.clone().sub(a);
    const ab = b.clone().sub(a);
    const lenSq = ab.lengthSq();
    if (lenSq <= 0.00001) return point.distanceTo(a);
    const t = clamp(ap.dot(ab) / lenSq, 0, 1);
    return point.distanceTo(a.clone().addScaledVector(ab, t));
  }

  updateCamera(dt) {
    const p = this.player;
    const yaw = this.input.cameraYaw;
    const pitch = this.input.cameraPitch;
    const distance = 14;
    const target = p.pos.clone().add(new THREE.Vector3(0, 1.2, 0));
    const desired = target.clone().add(new THREE.Vector3(
      Math.sin(yaw) * Math.cos(pitch) * distance,
      -Math.sin(pitch) * distance + 2,
      Math.cos(yaw) * Math.cos(pitch) * distance
    ));
    if (this.screenShake > 0) {
      desired.x += rand(-this.screenShake, this.screenShake);
      desired.y += rand(-this.screenShake, this.screenShake);
      desired.z += rand(-this.screenShake, this.screenShake);
      this.screenShake = Math.max(0, this.screenShake - dt * 1.5);
    }
    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 8));
    this.camera.lookAt(target);
  }

  updateUI() {
    const p = this.player;
    this.ui.hpBar.style.width = `${clamp((p.hp / p.maxHp) * 100, 0, 100)}%`;
    this.ui.energyBar.style.width = `${clamp(p.energy, 0, 100)}%`;
    const xpNeed = 40 + p.level * 20;
    this.ui.xpBar.style.width = `${clamp((p.xp / xpNeed) * 100, 0, 100)}%`;
    this.ui.hpText.textContent = `${Math.ceil(Math.max(0, p.hp))}/${p.maxHp}`;
    this.ui.energyText.textContent = `${Math.floor(p.energy)} energy`;
    this.ui.xpText.textContent = `Level ${p.level}`;
    this.ui.floorText.textContent = `Floor ${this.floor}-${this.room}`;
    this.ui.coinText.textContent = `${p.coins}`;
    this.ui.shardText.textContent = `${p.shards}`;
    this.ui.objective.textContent = this.enemies.length ? `${this.enemies.length} enemies left` : 'Arena clear';
  }

  setCodex(text) {
    this.ui.codex.textContent = text;
  }

  onResize() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = Math.min(0.033, this.clock.getDelta());
    this.update(dt);
    this.renderer.render(this.scene, this.camera);
  }
}

new StormforgeGame();
