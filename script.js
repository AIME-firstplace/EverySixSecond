(function () {
  'use strict';

  /* ============ STATE ============ */
  let currentScene = 0;
  let lineIdx = 0;
  let killCount = 0;
  const KILLS_NEEDED = 4;
  let isTransitioning = false;
  let canInteract = false;
  let floodDone = false;
  let audioCtx = null;
  let drone = null;

  /* ============ STORY DATA (JSON-driven) ============ */
  const WARM_LINES = [
    { text: 'Her name is Luna.', speed: 50, wait: 800 },
    { text: 'They live deep in the Amazon.', speed: 45, wait: 700 },
    { text: 'The water is still.', speed: 50, wait: 800 },
    { text: 'She has two cubs.', speed: 50, wait: 700 },
    { text: 'Mira, the older one. She loves to climb.', speed: 45, wait: 800 },
    { text: "Sol, the younger. He's afraid of the river.", speed: 45, wait: 800 },
    { text: 'Luna teaches them how to listen.', speed: 50, wait: 700 },
    { text: 'How to wait. How to stay.', speed: 55, wait: 1200 },
    { text: "She doesn't know you're watching.", speed: 50, wait: 500 },
  ];

  const HUNTER_LINES = [
    { text: 'You are a hunter.', speed: 60, wait: 1200 },
    { text: 'You came for the skin.', speed: 55, wait: 1000 },
    { text: 'It pays well.', speed: 70, wait: 1500 },
  ];

  const AFTERMATH_LINES = [
    { text: "Luna doesn't move.", speed: 55, wait: 1500 },
    { text: 'Sol calls for her.', speed: 50, wait: 1500, sound: 'cry' },
    { text: 'Mira waits by the water.', speed: 50, wait: 1200 },
    { text: 'The night comes.', speed: 60, wait: 1500 },
    { text: 'She taught them to wait.', speed: 50, wait: 2000, big: true },
    { text: 'They are still waiting.', speed: 55, wait: 2500, big: true },
  ];

  /* ============ TEXT ENGINE ============ */
  let textCtx = { lines: [], panel: '', prompt: '', nextScene: 0, onAdvance: null };

  async function playLine(panelSel, promptSel, line) {
    canInteract = false;
    const panel = $(panelSel);
    const prompt = $(promptSel);

    prompt.classList.add('hidden');
    panel.textContent = '';

    if (line.big) panel.classList.add('text-big');
    else panel.classList.remove('text-big');

    await delay(400);
    await typewrite(panel, line.text, line.speed || 50);

    if (line.sound === 'cry') playCry();

    await delay(line.wait || 800);
    prompt.classList.remove('hidden');
    canInteract = true;
  }

  function advanceText() {
    if (!canInteract) return;
    canInteract = false;
    lineIdx++;
    if (textCtx.onAdvance) textCtx.onAdvance(lineIdx);
    if (lineIdx < textCtx.lines.length) {
      playLine(textCtx.panel, textCtx.prompt, textCtx.lines[lineIdx]);
    } else {
      goTo(textCtx.nextScene);
    }
  }

  /* ============ HELPERS ============ */
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ============ WHITE-BG REMOVAL ============ */
  function removeWhiteBg(imgEl) {
    return new Promise((resolve) => {
      const process = () => {
        try {
          const c = document.createElement('canvas');
          c.width = imgEl.naturalWidth;
          c.height = imgEl.naturalHeight;
          const ctx = c.getContext('2d');
          ctx.drawImage(imgEl, 0, 0);
          const id = ctx.getImageData(0, 0, c.width, c.height);
          const d = id.data;
          for (let i = 0; i < d.length; i += 4) {
            const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
            if (avg > 245) d[i + 3] = 0;
            else if (avg > 210) d[i + 3] = Math.floor(255 * (1 - (avg - 210) / 35));
          }
          ctx.putImageData(id, 0, 0);
          imgEl.src = c.toDataURL('image/png');
        } catch (_) {}
        resolve();
      };
      if (imgEl.complete && imgEl.naturalWidth) process();
      else { imgEl.onload = process; imgEl.onerror = resolve; }
    });
  }

  /* Preprocess blood PNGs */
  const bloodReady = [];
  function preloadBlood() {
    return Promise.all(BLOOD_IMAGES.map((src, idx) => {
      return new Promise((resolve) => {
        const img = new Image();
        img.onerror = () => { bloodReady[idx] = src; resolve(); };
        img.onload = () => {
          try {
            const c = document.createElement('canvas');
            c.width = img.naturalWidth; c.height = img.naturalHeight;
            const ctx = c.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const id = ctx.getImageData(0, 0, c.width, c.height);
            const d = id.data;
            for (let i = 0; i < d.length; i += 4) {
              const avg = (d[i] + d[i + 1] + d[i + 2]) / 3;
              if (avg > 240) d[i + 3] = 0;
              else if (avg > 200) d[i + 3] = Math.floor(255 * (1 - (avg - 200) / 40));
            }
            ctx.putImageData(id, 0, 0);
            bloodReady[idx] = c.toDataURL('image/png');
          } catch (_) { bloodReady[idx] = src; }
          resolve();
        };
        img.src = src;
      });
    }));
  }

  /* ============ SCENE TRANSITIONS ============ */
  function goTo(sceneId) {
    if (isTransitioning) return;
    isTransitioning = true;
    canInteract = false;
    const cur = $(`#scene-${currentScene}`);
    const nxt = $(`#scene-${sceneId}`);
    cur.classList.add('fade-out');
    setTimeout(() => {
      cur.classList.remove('active', 'fade-out');
      nxt.classList.add('active');
      currentScene = sceneId;
      isTransitioning = false;
      enterScene(sceneId);
    }, 1200);
  }

  function enterScene(id) {
    switch (id) {
      case 0: enterHorror();     break;
      case 1: enterWarm();       break;
      case 2: enterHunter();     break;
      case 3: enterKill();       break;
      case 4: enterAftermath();  break;
      case 5: enterReveal();     break;
    }
  }

  /* ============ TYPEWRITER ============ */
  async function typewrite(el, text, speed = 45) {
    el.textContent = '';
    el.classList.add('typewriter-cursor');
    for (const ch of text) {
      el.textContent += ch;
      await delay(speed);
    }
    el.classList.remove('typewriter-cursor');
  }

  /* ============ AUDIO ============ */
  function initAudio() {
    if (audioCtx) return;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function startDrone() {
    if (!audioCtx) return;
    try {
      const osc1 = audioCtx.createOscillator();
      const osc2 = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const filt = audioCtx.createBiquadFilter();
      osc1.type = 'sawtooth'; osc1.frequency.value = 48;
      osc2.type = 'sine'; osc2.frequency.value = 51;
      filt.type = 'lowpass'; filt.frequency.value = 180;
      gain.gain.value = 0;
      gain.gain.linearRampToValueAtTime(0.055, audioCtx.currentTime + 3);
      osc1.connect(filt); osc2.connect(filt);
      filt.connect(gain); gain.connect(audioCtx.destination);
      osc1.start(); osc2.start();
      const lfo = audioCtx.createOscillator();
      const lfoG = audioCtx.createGain();
      lfo.frequency.value = 0.25; lfoG.gain.value = 4;
      lfo.connect(lfoG); lfoG.connect(osc1.frequency); lfo.start();
      drone = { osc1, osc2, gain, lfo };
    } catch (_) {}
  }

  function stopDrone() {
    if (!drone || !audioCtx) return;
    try {
      drone.gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 2);
      setTimeout(() => {
        try { drone.osc1.stop(); drone.osc2.stop(); drone.lfo.stop(); } catch (_) {}
        drone = null;
      }, 2500);
    } catch (_) { drone = null; }
  }

  /* Gunshot: sharp crack + low boom */
  function playGunshot() {
    if (!audioCtx) return;
    try {
      const len = Math.floor(audioCtx.sampleRate * 0.06);
      const buf = audioCtx.createBuffer(1, len, audioCtx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (len * 0.012));
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      const hp = audioCtx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 1200;
      const g = audioCtx.createGain();
      g.gain.value = 0.4;
      src.connect(hp); hp.connect(g); g.connect(audioCtx.destination);
      src.start();

      const osc = audioCtx.createOscillator();
      const og = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(25, audioCtx.currentTime + 0.18);
      og.gain.setValueAtTime(0.55, audioCtx.currentTime);
      og.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(og); og.connect(audioCtx.destination);
      osc.start(); osc.stop(audioCtx.currentTime + 0.3);
    } catch (_) {}
  }

  /* Animal cry — synthesised descending mew */
  function playCry() {
    if (!audioCtx) return;
    try {
      const t = audioCtx.currentTime;
      /* first call */
      const osc1 = audioCtx.createOscillator();
      const g1 = audioCtx.createGain();
      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(700, t);
      osc1.frequency.exponentialRampToValueAtTime(300, t + 0.5);
      g1.gain.setValueAtTime(0.12, t);
      g1.gain.exponentialRampToValueAtTime(0.001, t + 0.7);
      osc1.connect(g1); g1.connect(audioCtx.destination);
      osc1.start(t); osc1.stop(t + 0.8);

      /* second call — higher, shorter, more urgent */
      const osc2 = audioCtx.createOscillator();
      const g2 = audioCtx.createGain();
      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(850, t + 0.6);
      osc2.frequency.exponentialRampToValueAtTime(400, t + 1.0);
      g2.gain.setValueAtTime(0.08, t + 0.6);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 1.1);
      osc2.connect(g2); g2.connect(audioCtx.destination);
      osc2.start(t + 0.6); osc2.stop(t + 1.2);
    } catch (_) {}
  }

  /* ============ BLOOD EFFECTS ============ */
  const BLOOD_IMAGES = [
    'images/blood/8749-blood.png',
    'images/blood/8771-blood.png',
    'images/blood/8775-blood.png',
    'images/blood/8786-blood.png',
  ];

  /* Per-shot blood near killed target */
  function spawnBloodAt(x, y, shotNum) {
    const layer = $('#bloodLayer');
    if (!layer || bloodReady.length === 0) return;

    const count = 2 + Math.floor(Math.random() * 2);
    const baseSize = 80 + (shotNum / KILLS_NEEDED) * 180;
    const indices = [0, 1, 2, 3].sort(() => Math.random() - 0.5);

    for (let i = 0; i < count; i++) {
      const img = document.createElement('img');
      img.src = bloodReady[indices[i % 4]] || BLOOD_IMAGES[indices[i % 4]];
      img.className = 'blood-img show';

      const size = baseSize + Math.random() * 60;
      const ox = (Math.random() - 0.5) * 140;
      const oy = (Math.random() - 0.5) * 140;

      Object.assign(img.style, {
        width: size + 'px',
        left: (x + ox - size / 2) + 'px',
        top: (y + oy - size / 2) + 'px',
        transform: 'rotate(' + Math.floor(Math.random() * 360) + 'deg)',
      });

      layer.appendChild(img);
    }
  }

  /* Blood flood — fill screen ~70% after all kills */
  async function startBloodFlood() {
    const layer = $('#bloodFlood');
    layer.innerHTML = '';

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cellSize = 170;
    const cols = Math.ceil(vw / cellSize) + 1;
    const rows = Math.ceil(vh / cellSize) + 1;
    const cells = [];

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        cells.push({ x: c * cellSize - cellSize * 0.3, y: r * cellSize - cellSize * 0.3 });
      }
    }

    /* Fisher-Yates shuffle */
    for (let i = cells.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }

    const count = Math.floor(cells.length * 0.72);

    for (let i = 0; i < count; i++) {
      const cell = cells[i];
      const img = document.createElement('img');
      const bi = Math.floor(Math.random() * bloodReady.length);
      img.src = bloodReady[bi] || BLOOD_IMAGES[bi];
      img.className = 'blood-img';

      const size = cellSize * 1.6 + Math.random() * cellSize * 0.8;
      const ox = (Math.random() - 0.5) * cellSize * 0.5;
      const oy = (Math.random() - 0.5) * cellSize * 0.5;

      Object.assign(img.style, {
        width: size + 'px',
        left: (cell.x + ox) + 'px',
        top: (cell.y + oy) + 'px',
        transform: 'rotate(' + Math.floor(Math.random() * 360) + 'deg)',
        transition: 'opacity 0.35s ease',
      });

      layer.appendChild(img);
      void img.offsetWidth;
      img.classList.add('show');

      /* accelerate: 180ms at start -> ~50ms near end */
      const t = i / count;
      const interval = Math.floor(180 * (1 - t * 0.72));
      await delay(interval);
    }

    /* show Enter prompt above the blood */
    await delay(800);
    const prompt = $('#promptKill');
    prompt.textContent = '[ Press Enter ]';
    prompt.style.opacity = '1';
    floodDone = true;
  }

  /* Static blood for horror opening */
  function spawnOpeningBlood() {
    const layer = $('#openingBlood');
    if (!layer || bloodReady.length === 0) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    for (let i = 0; i < 4; i++) {
      const img = document.createElement('img');
      img.src = bloodReady[i];
      img.className = 'blood-img show';
      const size = 100 + Math.random() * 200;
      Object.assign(img.style, {
        width: size + 'px',
        left: Math.random() * vw * 0.8 + 'px',
        top: Math.random() * vh * 0.8 + 'px',
        transform: 'rotate(' + Math.floor(Math.random() * 360) + 'deg)',
        opacity: 0.3 + Math.random() * 0.3,
      });
      layer.appendChild(img);
    }
  }

  /* ============ RECOIL & GUN ============ */
  function recoilShake() {
    const g = $('#game');
    g.classList.remove('recoil-shake');
    void g.offsetWidth;
    g.classList.add('recoil-shake');
    setTimeout(() => g.classList.remove('recoil-shake'), 350);
  }

  function fireGun() {
    const gun = $('#gun3');
    gun.classList.remove('recoil');
    void gun.offsetWidth;
    gun.classList.add('recoil');
    setTimeout(() => gun.classList.remove('recoil'), 250);

    /* muzzle flash */
    const flash = $('#muzzleFlash');
    flash.classList.remove('fire');
    void flash.offsetWidth;
    flash.classList.add('fire');
    setTimeout(() => flash.classList.remove('fire'), 100);
  }

  /* ============ MOUSE AIMING ============ */
  function handleMouseMove(e) {
    if (currentScene !== 3) return;
    const aim = $('#gunAim');
    if (!aim) return;

    const mx = (e.clientX / window.innerWidth - 0.5) * 2;
    const my = (e.clientY / window.innerHeight - 0.5) * 2;

    const rotZ = mx * -12;
    const tx = mx * 25;
    const ty = my * 15;

    aim.style.transform = `rotate(${rotZ}deg) translate(${tx}px, ${ty}px)`;
  }

  /* ============ SCENE 0: HORROR OPENING ============ */
  function enterHorror() {
    canInteract = true;
  }

  /* ============ SCENE 1: WARM STORIES (9 lines) ============ */
  function enterWarm() {
    lineIdx = 0;
    textCtx = {
      lines: WARM_LINES,
      panel: '#textPanel1',
      prompt: '#prompt1',
      nextScene: 2,
      onAdvance: null,
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 2: HUNTER (3 lines + drone) ============ */
  function enterHunter() {
    lineIdx = 0;
    startDrone();
    textCtx = {
      lines: HUNTER_LINES,
      panel: '#textPanel2',
      prompt: '#prompt2',
      nextScene: 3,
      onAdvance: null,
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 3: KILL (multi-target) ============ */
  async function enterKill() {
    killCount = 0;
    floodDone = false;
    $('#bloodLayer').innerHTML = '';
    $('#bloodFlood').innerHTML = '';

    /* reset all targets */
    $$('.target-animal').forEach(t => t.classList.remove('fallen'));

    /* show gun */
    const aim = $('#gunAim');
    if (aim) { aim.style.opacity = '1'; aim.style.pointerEvents = ''; }

    const prompt = $('#promptKill');
    prompt.textContent = '[ Click to shoot ]';
    prompt.style.opacity = '1';

    await delay(400);
    canInteract = true;
  }

  /* Find nearest alive target to click position */
  function findNearestTarget(cx, cy) {
    const targets = $$('.target-animal:not(.fallen)');
    let nearest = null;
    let minDist = Infinity;

    targets.forEach(t => {
      const rect = t.getBoundingClientRect();
      const tx = rect.left + rect.width / 2;
      const ty = rect.top + rect.height / 2;
      const dist = Math.hypot(cx - tx, cy - ty);
      if (dist < minDist) {
        minDist = dist;
        nearest = t;
      }
    });

    return nearest;
  }

  function handleKill(e) {
    if (!canInteract || killCount >= KILLS_NEEDED) return;

    const target = findNearestTarget(e.clientX, e.clientY);
    if (!target) return;

    canInteract = false;
    killCount++;

    /* gun effects */
    fireGun();
    recoilShake();
    playGunshot();

    /* blood near the target */
    const rect = target.getBoundingClientRect();
    spawnBloodAt(rect.left + rect.width / 2, rect.top + rect.height / 2, killCount);

    /* target falls */
    target.classList.add('fallen');

    if (killCount >= KILLS_NEEDED) {
      /* all targets down — hide gun, start blood flood */
      setTimeout(() => {
        const aim = $('#gunAim');
        if (aim) { aim.style.opacity = '0'; aim.style.pointerEvents = 'none'; }
        $('#promptKill').style.opacity = '0';
      }, 600);

      setTimeout(() => startBloodFlood(), 1500);
    } else {
      /* allow next shot after recoil settles */
      setTimeout(() => { canInteract = true; }, 350);
    }
  }

  /* ============ SCENE 4: AFTERMATH (6 lines, darkens) ============ */
  function enterAftermath() {
    stopDrone();
    lineIdx = 0;

    const bg = $('#bg4');
    bg.style.filter = 'brightness(0.28) saturate(0.38)';

    textCtx = {
      lines: AFTERMATH_LINES,
      panel: '#textPanel4',
      prompt: '#prompt4',
      nextScene: 5,
      onAdvance: function (idx) {
        /* progressive darkening */
        const t = idx / AFTERMATH_LINES.length;
        const b = 0.28 - t * 0.16;   /* 0.28 -> 0.12 */
        const s = 0.38 - t * 0.28;   /* 0.38 -> 0.10 */
        bg.style.filter = `brightness(${b}) saturate(${s})`;
      },
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 5: REVEAL + DATA + CTA ============ */
  async function enterReveal() {
    const panel = $('#textPanel5');
    const dataBox = $('#poachingData');
    const ctaButtons = $('#ctaButtons');

    panel.textContent = '';
    panel.classList.remove('text-big');
    dataBox.innerHTML = '';
    ctaButtons.style.opacity = '0';

    /* --- Narrative --- */
    await delay(2000);

    /* "Luna is not real." */
    await typewrite(panel, 'Luna is not real.', 55);
    await delay(2500);
    panel.textContent = '';

    /* "But every 6 seconds, a real one dies." */
    await typewrite(panel, 'But every 6 seconds, a real one dies.', 45);
    await delay(3000);
    panel.textContent = '';

    /* --- Poaching data --- */
    await delay(1000);

    const intro = document.createElement('div');
    intro.className = 'data-line data-intro';
    intro.textContent = 'Every year, poachers kill:';
    dataBox.appendChild(intro);
    await delay(200);
    intro.classList.add('show');
    await delay(1000);

    const stats = [
      { num: '20,000', label: 'elephants — shot for their tusks' },
      { num: '1,000+', label: 'rhinos — killed for their horns' },
      { num: '2,700,000', label: 'pangolins — skinned for their scales' },
    ];

    for (const s of stats) {
      const div = document.createElement('div');
      div.className = 'data-line';
      div.innerHTML = '<span class="num">' + s.num + '</span><span class="label">' + s.label + '</span>';
      dataBox.appendChild(div);
      await delay(200);
      div.classList.add('show');
      await delay(1200);
    }

    await delay(1500);

    /* "And countless jaguars, sloths, macaws — unnamed." */
    await typewrite(panel, 'And countless jaguars, sloths, macaws — unnamed.', 42);
    await delay(2500);
    panel.textContent = '';

    /* --- Brazil progress --- */
    await delay(1500);

    const brazilIntro = document.createElement('div');
    brazilIntro.className = 'data-line data-intro brazil-intro';
    brazilIntro.textContent = "In 2023, Brazil’s environmental protection led to:";
    dataBox.appendChild(brazilIntro);
    await delay(200);
    brazilIntro.classList.add('show');
    await delay(1200);

    const brazilStats = [
      '50% reduction in Amazon deforestation',
      'Largest land restitution to indigenous tribes',
      'Strict anti-poaching enforcement',
    ];

    for (const stat of brazilStats) {
      const div = document.createElement('div');
      div.className = 'data-line brazil-line';
      div.innerHTML = '<span class="label">' + stat + '</span>';
      dataBox.appendChild(div);
      await delay(200);
      div.classList.add('show');
      await delay(1000);
    }

    await delay(2000);

    /* "But it's not enough." */
    await typewrite(panel, "But it’s not enough.", 60);
    await delay(2500);
    panel.textContent = '';

    /* "Not without you." — big, lingers */
    panel.classList.add('text-big');
    await typewrite(panel, 'Not without you.', 65);
    await delay(2500);

    /* Show CTA buttons */
    ctaButtons.style.opacity = '1';
  }

  /* ============ EVENT WIRING ============ */
  function init() {
    /* Scene 0 -> 1 */
    $('#btnStart').addEventListener('click', () => {
      if (!canInteract) return;
      initAudio();
      goTo(1);
    });

    /* Scene 1: warm text — click to advance lines */
    $('#scene-1').addEventListener('click', (e) => {
      if (currentScene !== 1) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 2: hunter text — click to advance lines */
    $('#scene-2').addEventListener('click', (e) => {
      if (currentScene !== 2) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 3: kill shots */
    $('#scene-3').addEventListener('click', (e) => {
      if (currentScene !== 3) return;
      handleKill(e);
    });

    /* Scene 3: mouse aiming */
    $('#scene-3').addEventListener('mousemove', handleMouseMove);

    /* Scene 4: aftermath text — click to advance lines */
    $('#scene-4').addEventListener('click', () => {
      if (currentScene !== 4) return;
      advanceText();
    });

    /* Enter key — advance from blood flood to aftermath */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentScene === 3 && floodDone) {
        floodDone = false;
        canInteract = false;
        goTo(4);
      }
    });

    /* Share button */
    const shareBtn = $('#btnShare');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const msg = 'Every 6 seconds, an animal dies because of us.';
        if (navigator.share) {
          navigator.share({ title: 'Every 6 Seconds', text: msg, url: location.href });
        } else {
          navigator.clipboard.writeText(msg + ' ' + location.href).then(() => {
            shareBtn.textContent = 'Copied';
            setTimeout(() => { shareBtn.textContent = 'Share'; }, 2000);
          });
        }
      });
    }

    /* boot */
    enterScene(0);

    /* process images in background */
    Promise.all([
      ...Array.from($$('.animal-img')).map(removeWhiteBg),
      preloadBlood(),
    ]).then(() => {
      spawnOpeningBlood();
    }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
