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
  let revealComplete = false;
  let audioCtx = null;
  let drone = null;
  let playToken = 0;            /* bumped on every jump/transition to abort in-flight typing */
  const historyBeats = [];      /* ordered, de-duped list of moments the player has reached */
  const seenKeys = {};
  let pageOpenTime = 0;         /* set at boot — drives the "every 6s" live death counter */
  let deathTimer = null;

  /* ============ STORY DATA (JSON-driven) ============ */
  const WARM_LINES = [
    { text: { en: 'Her name is Momo.', zh: '她叫莫莫。' }, speed: 50, wait: 800 },
    { text: { en: 'They live deep in the Amazon.', zh: '她们住在亚马逊的深处。' }, speed: 45, wait: 700 },
    { text: { en: 'The water is still.', zh: '水面平静无波。' }, speed: 50, wait: 800 },
    { text: { en: 'She has two cubs.', zh: '她有两只幼崽。' }, speed: 50, wait: 700 },
    { text: { en: 'Mira, the older one. She loves to climb.', zh: '米拉，姐姐。她爱攀爬。' }, speed: 45, wait: 800 },
    { text: { en: "Sol, the younger. He's afraid of the river.", zh: '索尔，弟弟。他怕河水。' }, speed: 45, wait: 800 },
    { text: { en: 'Momo teaches them how to listen.', zh: '莫莫教它们如何倾听。' }, speed: 50, wait: 700 },
    { text: { en: 'How to wait. How to stay.', zh: '如何等待。如何留守。' }, speed: 55, wait: 1200 },
    { text: { en: "She doesn't know you're watching.", zh: '她不知道你正在窥视。' }, speed: 50, wait: 500 },
  ];

  /* Per-line "beat" image for scene 1. Same rainforest background in every
     frame — only the jaguar subjects change. Adjacent lines reuse a beat. */
  const WARM_BEATS = [
    'harlow.png',   /* Her name is Momo.                         */
    'harlow.png',   /* They live deep in the Amazon.              */
    'harlow.png',   /* The water is still.                        */
    'family.png',   /* She has two cubs.                          */
    'mira.png',     /* Mira, the older one. She loves to climb.   */
    'sol.png',      /* Sol, the younger. He's afraid of the river.*/
    'listen.png',   /* Momo teaches them how to listen.         */
    'listen.png',   /* How to wait. How to stay.                  */
    'watched.png',  /* She doesn't know you're watching.          */
  ];

  const HUNTER_LINES = [
    { text: { en: 'You are a hunter.', zh: '你是个猎人。' }, speed: 60, wait: 1200 },
    { text: { en: 'You came for the skin.', zh: '你为皮毛而来。' }, speed: 55, wait: 1000 },
    { text: { en: 'It pays well.', zh: '它能卖个好价钱。' }, speed: 70, wait: 1500 },
  ];

  /* Per-line beat image for scene 2 (same dark forest + rifle, only the
     jaguar changes): unaware -> pelt in the light -> alarmed/looking back. */
  const HUNTER_BEATS = [
    'hidden.png',  /* You are a hunter.      */
    'pelt.png',    /* You came for the skin. */
    'alarm.png',   /* It pays well.          */
  ];

  const AFTERMATH_LINES = [
    { text: { en: "Momo doesn't move.", zh: '莫莫一动不动。' }, speed: 55, wait: 1500 },
    { text: { en: 'Sol calls for her.', zh: '索尔呼唤着她。' }, speed: 50, wait: 1500, sound: 'cry' },
    { text: { en: 'Mira waits by the water.', zh: '米拉在水边等待。' }, speed: 50, wait: 1200 },
    { text: { en: 'The night comes.', zh: '夜幕降临。' }, speed: 60, wait: 1500 },
    { text: { en: 'She taught them to wait.', zh: '她曾教它们等待。' }, speed: 50, wait: 2000, big: true },
    { text: { en: 'They are still waiting.', zh: '它们仍在等待。' }, speed: 55, wait: 2500, big: true },
  ];

  /* Scene 8 — the cubs left behind. Same rainforest, only the lone cub. */
  const CUB_LINES = [
    { text: { en: 'Sol crossed the river. The one he was always afraid of.', zh: '索尔渡过了那条河 —— 他一直害怕的那条。' }, speed: 50, wait: 1500 },
    { text: { en: 'No one was left to carry him across.', zh: '再没有谁能驮他过去了。' }, speed: 55, wait: 1800 },
    { text: { en: 'Mira climbed to the highest branch — the way her mother taught her.', zh: '米拉爬上了最高的枝头 —— 像母亲教过她的那样。' }, speed: 48, wait: 1500 },
    { text: { en: 'She watched the trees until dark. No one came.', zh: '她望着林子，直到天黑。没有人来。' }, speed: 52, wait: 2400, big: true },
  ];
  const CUB_BEATS = ['sol_river.png', 'sol_river.png', 'mira_tree.png', 'mira_tree.png'];

  /* Scene 10 — guardian reframe (the replay's new identity) */
  const GUARD_LINES = [
    { text: { en: 'This time, you are not the one with the rifle.', zh: '这一次，握枪的不是你。' }, speed: 52, wait: 1400 },
    { text: { en: 'You are a guardian of this forest — a ranger, a child of this land.', zh: '你是这片森林的守护者 —— 一名护林员，这片土地的孩子。' }, speed: 46, wait: 1600 },
    { text: { en: 'When the hunters come, you do not aim at the jaguars. You shield them.', zh: '当猎人来时，你不瞄准美洲豹。你护住它们。' }, speed: 48, wait: 1800 },
  ];
  const GUARD_NEEDED = 3;
  let guardCount = 0;

  /* ============ I18N (EN / 中文) ============ */
  let LANG = 'en';
  try { const s = localStorage.getItem('e6s_lang'); if (s === 'en' || s === 'zh') LANG = s; } catch (_) {}

  const I18N = {
    en: {
      cw: 'CONTENT WARNING · 16+',
      warnSub: 'You will be asked to do something<br>you cannot undo.',
      enter: 'Enter',
      clickContinue: 'Click to continue',
      clickShoot: '[ Click to shoot ]',
      pressEnter: '[ Press Enter ]',
      learnMore: 'Learn more',
      share: 'Share',
      shareMsg: 'Every 6 seconds, an animal dies because of us.',
      copied: 'Copied',
      references: 'References',
      worksCited: 'Works Cited',
      mla: 'MLA 9th Edition',
      back: 'Back',
      rewind: 'Rewind',
      rewindSub: "Return to any moment you've already seen",
      close: 'Close',
      openingTagline: "A story you shouldn't have opened.",
      skip: 'Skip',
      counterTpl: 'Since you opened this page, <em class="fig">{n}</em> wild animals have been killed.',
      choicePrompt: 'She still hasn\'t seen you.',
      waitBtn: 'Wait',
      shootBtn: 'Shoot',
      waitLines: ['You waited.', 'But the skin still pays.', 'Your finger moved anyway.'],
      guardianBtn: 'Walk it again, as a guardian',
      guardHint: 'Move to aim  ·  click to shield each one',
      guardResolve: 'They live. This time, they live.',
      returnBtn: 'Return',
      hints: {
        intro: 'Click anywhere to continue',
        0: 'Click  ENTER  to begin',
        1: 'Click anywhere to continue',
        2: 'Click anywhere to continue',
        3: 'Move mouse to aim  ·  left-click to shoot',
        4: 'Click anywhere to continue',
        5: 'Choose an option below',
        6: 'Click  BACK  to return',
        7: 'Make your choice',
        8: 'Click anywhere to continue',
        10: 'Click anywhere to continue',
        11: 'Move to aim  ·  click to shield each one',
      },
      hintPressEnter: 'Press  ENTER  to continue',
      sceneNames: { intro: 'Introduction', 0: 'Warning', 1: 'Warmth', 2: 'The Hunter', 7: 'The Choice', 3: 'The Shot', 4: 'Aftermath', 8: 'The Cubs', 5: 'The Truth', 6: 'Sources', 10: 'The Guardian', 11: 'Protect' },
      sceneDesc: { intro: 'Before you begin', 0: 'Content warning', 7: 'A choice that was never yours', 3: 'The hunt — you pull the trigger', 5: 'The truth & the data', 6: 'Works cited', 10: 'Walk it again, as a guardian', 11: 'You shield them' },
      reveal: {
        l1: 'Momo is not real.',
        l2: 'But every 6 seconds, a real one dies.',
        dataIntro: 'Every year, poachers kill:',
        stats: [
          { num: '20,000', label: 'elephants — shot for their tusks' },
          { num: '1,000+', label: 'rhinos — killed for their horns' },
          { num: '2,700,000', label: 'pangolins — skinned for their scales' },
        ],
        unnamed: 'And countless jaguars, sloths, macaws — unnamed.',
        brazilIntro: "In 2023, Brazil's environmental protection led to:",
        brazil: [
          '50% reduction in Amazon deforestation',
          'Largest land restitution to indigenous tribes',
          'Strict anti-poaching enforcement',
        ],
        notEnough: "But it's not enough.",
        notWithout: 'Not without you.',
      },
      intro: {
        data: [
          'Up to <em class="fig">2.7 million pangolins</em> are poached each year. Around <em class="fig">20,000 elephants</em>, for their ivory. More than <em class="fig">a thousand rhinos</em>, for their horns — and countless jaguars, sloths and macaws no one ever counts.',
          'Added together, that\'s roughly <em class="fig">one wild life taken every six seconds.</em>',
        ],
        note: "A number that size stops meaning anything. So I lifted one of them out of the statistics and gave her a name. She isn't real — the six seconds are. I'm not asking you to feel guilty; I just didn't want her to stay a number.",
      },
    },
    zh: {
      cw: '内容警告 · 16+',
      warnSub: '你将被要求去做一件<br>无法挽回的事。',
      enter: '进入',
      clickContinue: '点击继续',
      clickShoot: '[ 点击开枪 ]',
      pressEnter: '[ 按 Enter 继续 ]',
      learnMore: '了解更多',
      share: '分享',
      shareMsg: '每 6 秒，就有一只动物因我们而死。',
      copied: '已复制',
      references: '参考文献',
      worksCited: '参考文献',
      mla: 'MLA 第 9 版',
      back: '返回',
      rewind: '回溯',
      rewindSub: '回到你已看过的任意一刻',
      close: '关闭',
      openingTagline: '一个你本不该打开的故事。',
      skip: '跳过',
      counterTpl: '自你打开此页，已有 <em class="fig">{n}</em> 个野生生命被杀死。',
      choicePrompt: '她还没有发现你。',
      waitBtn: '等待',
      shootBtn: '开枪',
      waitLines: ['你等了。', '但皮还是值钱。', '你的手指还是动了。'],
      guardianBtn: '以守护者身份，重走一遍',
      guardHint: '移动瞄准  ·  点击护住每一只',
      guardResolve: '它们活了下来。这一次，它们活了下来。',
      returnBtn: '返回',
      hints: {
        intro: '点击任意处继续',
        0: '点击「进入」开始',
        1: '点击任意处继续',
        2: '点击任意处继续',
        3: '移动鼠标瞄准  ·  左键开枪',
        4: '点击任意处继续',
        5: '在下方做出选择',
        6: '点击「返回」',
        7: '做出你的选择',
        8: '点击任意处继续',
        10: '点击任意处继续',
        11: '移动瞄准  ·  点击护住每一只',
      },
      hintPressEnter: '按  ENTER  继续',
      sceneNames: { intro: '序', 0: '警告', 1: '温暖', 2: '猎人', 7: '选择', 3: '那一枪', 4: '余波', 8: '幼崽', 5: '真相', 6: '来源', 10: '守护者', 11: '守护' },
      sceneDesc: { intro: '开始之前', 0: '内容警告', 7: '一个从来不属于你的选择', 3: '狩猎 —— 你扣下扳机', 5: '真相与数据', 6: '参考文献', 10: '以守护者身份，重走一遍', 11: '你护住它们' },
      reveal: {
        l1: '莫莫并不存在。',
        l2: '但每过 6 秒，就有一个真实的生命死去。',
        dataIntro: '每一年，盗猎者杀死：',
        stats: [
          { num: '20,000', label: '头大象 —— 为象牙而被射杀' },
          { num: '1,000+', label: '头犀牛 —— 为犀角而被杀害' },
          { num: '2,700,000', label: '只穿山甲 —— 为鳞片而被剥皮' },
        ],
        unnamed: '还有无数美洲豹、树懒、金刚鹦鹉 —— 无人知其名。',
        brazilIntro: '2023 年，巴西的环境保护带来了：',
        brazil: [
          '亚马逊森林砍伐减少 50%',
          '对原住民部落史上最大规模的土地归还',
          '严格的反盗猎执法',
        ],
        notEnough: '但这还不够。',
        notWithout: '没有你，就不够。',
      },
      intro: {
        data: [
          '每年，多达 <em class="fig">270 万只穿山甲</em> 死于盗猎。约 <em class="fig">2 万头大象</em>，为了象牙。<em class="fig">一千多头犀牛</em>，为了犀角 —— 还有无数没人统计的美洲豹、树懒和金刚鹦鹉。',
          '加在一起，<em class="fig">大约每过六秒，就有一个野生的生命被夺走。</em>',
        ],
        note: '大到这种程度的数字，会失去意义。所以我把其中一个从统计里抽出来，给了她一个名字。她不是真的 —— 那六秒是真的。我不是要你愧疚，我只是不想让她，只剩下一个数字。',
      },
    },
  };

  const t = (key) => (I18N[LANG] && I18N[LANG][key] != null ? I18N[LANG][key] : I18N.en[key]);
  const lineText = (line) => (line && typeof line.text === 'object' ? (line.text[LANG] || line.text.en) : (line ? line.text : ''));
  function hintFor(scene) {
    if (scene === 3 && floodDone) return t('hintPressEnter');
    return I18N[LANG].hints[scene];
  }

  /* ============ TEXT ENGINE ============ */
  let textCtx = { lines: [], panel: '', prompt: '', nextScene: 0, onAdvance: null };

  async function playLine(panelSel, promptSel, line) {
    const myToken = playToken;
    canInteract = false;
    const panel = $(panelSel);
    const prompt = $(promptSel);

    /* log this moment so the player can rewind to it later */
    recordBeat(currentScene, lineIdx);

    prompt.classList.add('hidden');
    panel.textContent = '';

    if (line.big) panel.classList.add('text-big');
    else panel.classList.remove('text-big');

    await delay(400);
    if (myToken !== playToken) return;
    await typewrite(panel, lineText(line), line.speed || 50);
    if (myToken !== playToken) return;

    if (line.sound === 'cry') playCry();

    await delay(line.wait || 800);
    if (myToken !== playToken) return;
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
    playToken++;   /* abort any line still typing in the outgoing scene */
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

  /* Bottom-of-screen "how to continue" hint for every scene */
  const SCENE_HINTS = {
    0: 'Click  ENTER  to begin',
    1: 'Click anywhere to continue',
    2: 'Click anywhere to continue',
    3: 'Move mouse to aim  ·  left-click to shoot',
    4: 'Click anywhere to continue',
    5: 'Choose an option below',
    6: 'Click  BACK  to return',
  };

  function setHint(text, alert) {
    const h = $('#sceneHint');
    if (!h) return;
    h.textContent = text || '';
    h.classList.toggle('alert', !!alert);
    h.classList.toggle('show', !!text);
  }

  function enterScene(id) {
    setHint(hintFor(id), id === 3);
    /* scenes without per-line narration are logged as a single beat */
    if (id === 'intro' || id === 0 || id === 3 || id === 5 || id === 6 || id === 7 || id === 11) recordBeat(id, -1, '');
    switch (id) {
      case 'intro': enterIntro(); break;
      case 0: enterHorror();     break;
      case 1: enterWarm();       break;
      case 2: enterHunter();     break;
      case 7: enterChoice();     break;
      case 3: enterKill();       break;
      case 4: enterAftermath();  break;
      case 8: enterCub();        break;
      case 5: enterReveal();     break;
      case 6: /* references — static */ break;
      case 10: enterGuardianIntro(); break;
      case 11: enterGuardian();  break;
    }
  }

  /* ============ TYPEWRITER ============ */
  async function typewrite(el, text, speed = 45) {
    const myToken = playToken;
    el.textContent = '';
    el.classList.add('typewriter-cursor');
    for (const ch of text) {
      if (myToken !== playToken) { el.classList.remove('typewriter-cursor'); return; }
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

  /* Real big-cat roar/snarl — replaces the old synth drone as a ~2s
     one-shot event when the hunter scene begins. (SoundBible, CC-BY 3.0) */
  let roarEl = null;
  function playRoar() {
    try {
      if (!roarEl) { roarEl = new Audio('sounds/jaguar_roar.mp3'); roarEl.volume = 0.85; }
      roarEl.currentTime = 0;
      const p = roarEl.play();
      if (p && p.catch) p.catch(function () {});
      /* safety cap at ~3s in case a longer clip is dropped in later */
      clearTimeout(roarEl._t);
      roarEl._t = setTimeout(function () { try { roarEl.pause(); } catch (_) {} }, 3200);
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

  /* Gunshot: sharp crack + low boom. scale<1 dims it for overlapping bursts. */
  function playGunshot(scale = 1) {
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
      g.gain.value = 0.4 * scale;
      src.connect(hp); hp.connect(g); g.connect(audioCtx.destination);
      src.start();

      const osc = audioCtx.createOscillator();
      const og = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(90, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(25, audioCtx.currentTime + 0.18);
      og.gain.setValueAtTime(0.55 * scale, audioCtx.currentTime);
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

      /* one gunshot per splat — dimmed so overlapping bursts don't clip */
      playGunshot(0.18);

      /* accelerate: 180ms at start -> ~50ms near end */
      const t = i / count;
      const interval = Math.floor(180 * (1 - t * 0.72));
      await delay(interval);
    }

    /* show Enter prompt above the blood */
    await delay(800);
    const prompt = $('#promptKill');
    floodDone = true;
    prompt.textContent = t('pressEnter');
    prompt.style.opacity = '1';
    setHint(hintFor(3), true);
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

    /* reticle follows the cursor exactly */
    const ch = $('#crosshair');
    if (ch) ch.style.setProperty('--ch-pos', `translate(${e.clientX}px, ${e.clientY}px)`);

    /* rifle swings toward where you're aiming */
    const aim = $('#gunAim');
    if (aim) {
      const mx = (e.clientX / window.innerWidth - 0.5) * 2;
      const my = (e.clientY / window.innerHeight - 0.5) * 2;
      aim.style.transform = `translate(${mx * 70}px, ${my * 34}px) rotate(${mx * 16}deg)`;
    }

    /* lock-on highlight for the target under the reticle */
    const target = targetUnderPoint(e.clientX, e.clientY);
    let locked = false;
    $$('.target-animal').forEach(t => {
      const on = (t === target) && !t.classList.contains('fallen');
      t.classList.toggle('targeted', on);
      if (on) locked = true;
    });
    if (ch) ch.classList.toggle('locked', locked && canInteract);
  }

  /* Target under the reticle (with a little forgiveness); if several
     overlap, the one whose centre is closest to the aim point wins. */
  function targetUnderPoint(cx, cy) {
    const targets = $$('.target-animal:not(.fallen)');
    const pad = 24;
    let best = null, bestDist = Infinity;
    targets.forEach(t => {
      const r = t.getBoundingClientRect();
      if (cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad) {
        const d = Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2));
        if (d < bestDist) { bestDist = d; best = t; }
      }
    });
    return best;
  }

  /* ============ SCENE 0: HORROR OPENING ============ */
  function enterHorror() {
    canInteract = true;
  }

  /* ============ INTRODUCTION (author's note) ============ */
  function buildIntro(instant) {
    const body = $('#introBody');
    if (!body) return [];
    const content = I18N[LANG].intro;
    body.innerHTML = '';
    const els = [];
    content.data.forEach((html) => {
      const p = document.createElement('p');
      p.className = 'intro-line' + (instant ? ' show' : '');
      p.innerHTML = html;
      body.appendChild(p); els.push(p);
    });
    const rule = document.createElement('div');
    rule.className = 'intro-divider' + (instant ? ' show' : '');
    body.appendChild(rule); els.push(rule);
    const note = document.createElement('p');
    note.className = 'intro-line intro-note' + (instant ? ' show' : '');
    note.innerHTML = content.note;
    body.appendChild(note); els.push(note);
    return els;
  }

  async function enterIntro() {
    const myToken = playToken;
    $('#promptIntro').classList.add('hidden');
    canInteract = false;
    const els = buildIntro(false);
    await delay(500);
    for (const el of els) {
      if (myToken !== playToken) return;
      el.classList.add('show');
      await delay(850);
    }
    if (myToken !== playToken) return;
    await delay(300);
    $('#promptIntro').classList.remove('hidden');
    canInteract = true;
  }

  /* ============ SCENE 1: WARM STORIES (9 lines) ============ */
  let warmShownIsB = false;     /* which of the two bg layers is visible */
  let warmCurrentBeat = '';     /* current beat file, to skip no-op fades */

  /* Cross-dissolve scene 1's background to the beat for line `idx`. */
  function setWarmBeat(idx) {
    const file = WARM_BEATS[idx];
    if (!file || file === warmCurrentBeat) return;   /* same image — no fade */
    warmCurrentBeat = file;

    const a = $('#bg1'), b = $('#bg1b');
    const incoming = warmShownIsB ? a : b;   /* the hidden layer fades in */
    const outgoing = warmShownIsB ? b : a;
    incoming.style.backgroundImage = "url('images/warm/" + file + "')";
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    warmShownIsB = !warmShownIsB;
  }

  function enterWarm() {
    lineIdx = 0;

    /* reset the two background layers to the opening beat (no fade) */
    const a = $('#bg1'), b = $('#bg1b');
    warmShownIsB = false;
    warmCurrentBeat = WARM_BEATS[0];
    a.style.backgroundImage = "url('images/warm/" + WARM_BEATS[0] + "')";
    a.style.opacity = '1';
    b.style.opacity = '0';

    textCtx = {
      lines: WARM_LINES,
      panel: '#textPanel1',
      prompt: '#prompt1',
      nextScene: 2,
      onAdvance: function (idx) { setWarmBeat(idx); },
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 2: HUNTER (3 lines) ============ */
  let hunterShownIsB = false;
  let hunterCurrentBeat = '';

  function setHunterBeat(idx) {
    const file = HUNTER_BEATS[idx];
    if (!file || file === hunterCurrentBeat) return;
    hunterCurrentBeat = file;
    const a = $('#bg2'), b = $('#bg2b');
    const incoming = hunterShownIsB ? a : b;
    const outgoing = hunterShownIsB ? b : a;
    incoming.style.backgroundImage = "url('images/hunter/" + file + "')";
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    hunterShownIsB = !hunterShownIsB;
  }

  function enterHunter() {
    lineIdx = 0;

    /* one-shot jaguar roar marks the predator's arrival (replaces drone) */
    playRoar();

    /* reset the two background layers to the opening beat (no fade) */
    const a = $('#bg2'), b = $('#bg2b');
    hunterShownIsB = false;
    hunterCurrentBeat = HUNTER_BEATS[0];
    a.style.backgroundImage = "url('images/hunter/" + HUNTER_BEATS[0] + "')";
    a.style.opacity = '1';
    b.style.opacity = '0';

    textCtx = {
      lines: HUNTER_LINES,
      panel: '#textPanel2',
      prompt: '#prompt2',
      nextScene: 7,
      onAdvance: function (idx) { setHunterBeat(idx); },
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
    $$('.target-animal').forEach(t => t.classList.remove('fallen', 'targeted', 'hit'));

    /* show gun */
    const aim = $('#gunAim');
    if (aim) { aim.style.opacity = '1'; aim.style.pointerEvents = ''; aim.style.transform = ''; }

    /* reset reticle to centre until the player moves the mouse */
    const ch = $('#crosshair');
    if (ch) {
      ch.classList.remove('locked');
      ch.style.opacity = '';
      ch.style.setProperty('--ch-pos', 'translate(50vw, 50vh)');
    }

    const prompt = $('#promptKill');
    prompt.textContent = t('clickShoot');
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

    /* every shot fires the gun — feedback even on a miss */
    fireGun();
    recoilShake();
    playGunshot();

    const target = targetUnderPoint(e.clientX, e.clientY);
    if (!target) {
      /* missed — short lockout, no kill */
      canInteract = false;
      const ch = $('#crosshair');
      if (ch) ch.classList.remove('locked');
      setTimeout(() => { canInteract = true; }, 220);
      return;
    }

    canInteract = false;
    killCount++;

    /* blood at whatever you aimed at */
    const rect = target.getBoundingClientRect();
    spawnBloodAt(rect.left + rect.width / 2, rect.top + rect.height / 2, killCount);

    /* hit reaction, then the animal drops */
    target.classList.remove('targeted');
    target.classList.add('hit');
    setTimeout(() => { target.classList.remove('hit'); target.classList.add('fallen'); }, 150);

    const ch = $('#crosshair');
    if (ch) ch.classList.remove('locked');

    if (killCount >= KILLS_NEEDED) {
      /* all targets down — hide gun + reticle, start blood flood */
      setTimeout(() => {
        const aim = $('#gunAim');
        if (aim) { aim.style.opacity = '0'; aim.style.pointerEvents = 'none'; }
        if (ch) ch.style.opacity = '0';
        $('#promptKill').style.opacity = '0';
      }, 600);

      setTimeout(() => startBloodFlood(), 1500);
    } else {
      /* allow next shot after recoil settles */
      setTimeout(() => { canInteract = true; }, 300);
    }
  }

  /* ============ SCENE 4: AFTERMATH (6 lines, darkens) ============ */
  function enterAftermath() {
    stopDrone();
    lineIdx = 0;

    const bg = $('#bg4');
    bg.style.filter = 'brightness(0.75) saturate(0.7)';

    textCtx = {
      lines: AFTERMATH_LINES,
      panel: '#textPanel4',
      prompt: '#prompt4',
      nextScene: 8,
      onAdvance: function (idx) {
        /* progressive darkening — art is already night-toned, so stay gentle */
        const t = idx / AFTERMATH_LINES.length;
        const b = 0.75 - t * 0.35;   /* 0.75 -> 0.40 */
        const s = 0.70 - t * 0.35;   /* 0.70 -> 0.35 */
        bg.style.filter = `brightness(${b}) saturate(${s})`;
      },
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 8: THE CUBS LEFT BEHIND ============ */
  let cubShownIsB = false;
  let cubCurrentBeat = '';

  function setCubBeat(idx) {
    const file = CUB_BEATS[idx];
    if (!file || file === cubCurrentBeat) return;
    cubCurrentBeat = file;
    const a = $('#bg8'), b = $('#bg8b');
    const incoming = cubShownIsB ? a : b;
    const outgoing = cubShownIsB ? b : a;
    incoming.style.backgroundImage = "url('images/cub/" + file + "')";
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    cubShownIsB = !cubShownIsB;
  }
  function setCubLayerInstant(idx) {
    const a = $('#bg8'), b = $('#bg8b');
    cubShownIsB = false; cubCurrentBeat = CUB_BEATS[idx];
    a.style.backgroundImage = "url('images/cub/" + CUB_BEATS[idx] + "')";
    a.style.opacity = '1'; b.style.opacity = '0';
  }

  function enterCub() {
    lineIdx = 0;
    setCubLayerInstant(0);
    textCtx = {
      lines: CUB_LINES,
      panel: '#textPanel8',
      prompt: '#prompt8',
      nextScene: 5,
      onAdvance: function (idx) { setCubBeat(idx); },
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ GUARDIAN BRANCH (scenes 10–11) ============ */
  function enterGuardianIntro() {
    lineIdx = 0;
    textCtx = {
      lines: GUARD_LINES,
      panel: '#textPanel10',
      prompt: '#prompt10',
      nextScene: 11,
      onAdvance: null,
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  function guardTargetUnder(cx, cy) {
    const list = $$('.guardian-animal:not(.protected)');
    const pad = 26;
    let best = null, bestDist = Infinity;
    list.forEach((g) => {
      const r = g.getBoundingClientRect();
      if (cx >= r.left - pad && cx <= r.right + pad && cy >= r.top - pad && cy <= r.bottom + pad) {
        const d = Math.hypot(cx - (r.left + r.width / 2), cy - (r.top + r.height / 2));
        if (d < bestDist) { bestDist = d; best = g; }
      }
    });
    return best;
  }

  function handleGuardMove(e) {
    if (currentScene !== 11) return;
    const ret = $('#guardReticle');
    if (ret) ret.style.setProperty('--gr-pos', `translate(${e.clientX}px, ${e.clientY}px)`);
    const target = guardTargetUnder(e.clientX, e.clientY);
    $$('.guardian-animal').forEach((g) => g.classList.toggle('targeted', g === target && !g.classList.contains('protected')));
  }

  function handleProtect(e) {
    if (currentScene !== 11 || !canInteract || guardCount >= GUARD_NEEDED) return;
    const target = guardTargetUnder(e.clientX, e.clientY);
    if (!target) return;
    target.classList.remove('targeted');
    target.classList.add('protected');
    guardCount++;
    try { initAudio(); playChime(); } catch (_) {}
    if (guardCount >= GUARD_NEEDED) {
      canInteract = false;
      setTimeout(() => {
        const ret = $('#guardReticle');
        if (ret) ret.style.opacity = '0';
        $('#promptGuard').style.opacity = '0';
        const res = $('#guardResolve');
        res.textContent = t('guardResolve');
        res.classList.add('show');
        $('#btnGuardReturn').classList.remove('hidden');
        setHint('', false);
      }, 800);
    }
  }

  function enterGuardian() {
    guardCount = 0;
    $$('.guardian-animal').forEach((g) => g.classList.remove('protected', 'targeted'));
    const res = $('#guardResolve'); res.classList.remove('show'); res.textContent = '';
    $('#btnGuardReturn').classList.add('hidden');
    const ret = $('#guardReticle');
    if (ret) { ret.style.opacity = ''; ret.style.setProperty('--gr-pos', 'translate(50vw, 50vh)'); }
    const prompt = $('#promptGuard');
    prompt.textContent = t('guardHint');
    prompt.style.opacity = '1';
    canInteract = true;
  }

  /* ============ LIVE DEATH COUNTER (one every 6s) ============ */
  function deathCount() {
    if (!pageOpenTime) return 0;
    return Math.max(0, Math.floor((Date.now() - pageOpenTime) / 6000));
  }
  function renderDeathCounter() {
    const el = $('#deathCounter');
    if (!el) return;
    el.innerHTML = t('counterTpl').replace('{n}', deathCount().toLocaleString());
  }
  function startDeathCounter() {
    renderDeathCounter();
    const el = $('#deathCounter');
    if (el) el.classList.add('show');
    if (deathTimer) clearInterval(deathTimer);
    deathTimer = setInterval(renderDeathCounter, 1000);
  }

  /* ============ SCENE 7: THE CHOICE (illusory) ============ */
  function enterChoice() {
    const sc = $('#scene-7');
    if (sc) sc.classList.remove('committed');
    const buttons = $('#choiceButtons');
    const text = $('#choiceText');
    text.textContent = t('choicePrompt');
    text.classList.remove('typewriter-cursor');
    buttons.style.opacity = '1';
    buttons.style.pointerEvents = '';
    canInteract = true;
  }

  /* "Wait" still ends in the shot — the choice was never real. */
  async function chooseWait() {
    if (!canInteract) return;
    canInteract = false;
    const myToken = playToken;
    const buttons = $('#choiceButtons');
    const text = $('#choiceText');
    buttons.style.opacity = '0';
    buttons.style.pointerEvents = 'none';
    $('#scene-7').classList.add('committed');   /* cursor becomes a crosshair you can't shake */

    const lines = I18N[LANG].waitLines;
    await delay(700);
    for (const ln of lines) {
      if (myToken !== playToken) return;
      await typewrite(text, ln, 55);
      await delay(1400);
      if (myToken !== playToken) return;
      text.textContent = '';
    }
    if (myToken !== playToken) return;
    goTo(3);
  }

  /* ============ SCENE 5: REVEAL + DATA + CTA ============ */
  async function enterReveal() {
    const panel = $('#textPanel5');
    const dataBox = $('#poachingData');
    const ctaButtons = $('#ctaButtons');

    /* If returning from references, leave final state intact */
    if (revealComplete) {
      ctaButtons.style.opacity = '1';
      startDeathCounter();
      return;
    }

    panel.textContent = '';
    panel.classList.remove('text-big');
    dataBox.innerHTML = '';
    ctaButtons.style.opacity = '0';

    const R = I18N[LANG].reveal;
    const myToken = playToken;

    /* --- Narrative --- */
    await delay(2000);
    if (myToken !== playToken) return;

    await typewrite(panel, R.l1, 55);
    await delay(2500);
    panel.textContent = '';

    await typewrite(panel, R.l2, 45);
    await delay(1800);
    panel.textContent = '';

    /* live counter — animals killed since this page opened */
    startDeathCounter();
    await delay(3200);

    /* --- Poaching data --- */
    await delay(1000);

    const intro = document.createElement('div');
    intro.className = 'data-line data-intro';
    intro.textContent = R.dataIntro;
    dataBox.appendChild(intro);
    await delay(200);
    intro.classList.add('show');
    await delay(1000);

    for (const s of R.stats) {
      const div = document.createElement('div');
      div.className = 'data-line';
      div.innerHTML = '<span class="num">' + s.num + '</span><span class="label">' + s.label + '</span>';
      dataBox.appendChild(div);
      await delay(200);
      div.classList.add('show');
      await delay(1200);
    }

    await delay(1500);

    await typewrite(panel, R.unnamed, 42);
    await delay(2500);
    panel.textContent = '';

    /* --- Brazil progress --- */
    await delay(1500);

    const brazilIntro = document.createElement('div');
    brazilIntro.className = 'data-line data-intro brazil-intro';
    brazilIntro.textContent = R.brazilIntro;
    dataBox.appendChild(brazilIntro);
    await delay(200);
    brazilIntro.classList.add('show');
    await delay(1200);

    for (const stat of R.brazil) {
      const div = document.createElement('div');
      div.className = 'data-line brazil-line';
      div.innerHTML = '<span class="label">' + stat + '</span>';
      dataBox.appendChild(div);
      await delay(200);
      div.classList.add('show');
      await delay(1000);
    }

    await delay(2000);

    await typewrite(panel, R.notEnough, 60);
    await delay(2500);
    panel.textContent = '';

    /* "Not without you." — big, lingers */
    panel.classList.add('text-big');
    await typewrite(panel, R.notWithout, 65);
    await delay(2500);

    /* Show CTA buttons */
    ctaButtons.style.opacity = '1';
    revealComplete = true;
  }

  /* ============ HISTORY / REWIND ============ */
  const SCENE_NAMES = {
    0: 'Warning', 1: 'Warmth', 2: 'The Hunter',
    3: 'The Shot', 4: 'Aftermath', 5: 'The Truth', 6: 'Sources',
  };
  const SCENE_DESC = {
    0: 'Content warning',
    3: 'The hunt — you pull the trigger',
    5: 'The truth & the data',
    6: 'Works cited',
  };

  /* Text-scene config used to rebuild a narration scene at any line. */
  const SCENE_TEXT = {
    1: { lines: WARM_LINES, panel: '#textPanel1', prompt: '#prompt1', nextScene: 2, onAdvance: setWarmBeat },
    2: { lines: HUNTER_LINES, panel: '#textPanel2', prompt: '#prompt2', nextScene: 7, onAdvance: setHunterBeat },
    4: { lines: AFTERMATH_LINES, panel: '#textPanel4', prompt: '#prompt4', nextScene: 8, onAdvance: setAftermathFilterFor },
    8: { lines: CUB_LINES, panel: '#textPanel8', prompt: '#prompt8', nextScene: 5, onAdvance: setCubBeat },
    10: { lines: GUARD_LINES, panel: '#textPanel10', prompt: '#prompt10', nextScene: 11, onAdvance: null },
  };

  /* Instant (no-fade) setters used when rewinding into a scene. */
  function setWarmLayerInstant(idx) {
    const a = $('#bg1'), b = $('#bg1b');
    warmShownIsB = false; warmCurrentBeat = WARM_BEATS[idx];
    a.style.backgroundImage = "url('images/warm/" + WARM_BEATS[idx] + "')";
    a.style.opacity = '1'; b.style.opacity = '0';
  }
  function setHunterLayerInstant(idx) {
    const a = $('#bg2'), b = $('#bg2b');
    hunterShownIsB = false; hunterCurrentBeat = HUNTER_BEATS[idx];
    a.style.backgroundImage = "url('images/hunter/" + HUNTER_BEATS[idx] + "')";
    a.style.opacity = '1'; b.style.opacity = '0';
  }
  function setAftermathFilterFor(idx) {
    const t = idx / AFTERMATH_LINES.length;
    $('#bg4').style.filter = 'brightness(' + (0.75 - t * 0.35) + ') saturate(' + (0.70 - t * 0.35) + ')';
  }

  function recordBeat(scene, idx, text) {
    const li = (idx == null) ? -1 : idx;
    const key = scene + ':' + li;
    if (seenKeys[key]) return;
    seenKeys[key] = true;
    historyBeats.push({ scene: scene, lineIdx: li, text: text || '' });
  }

  function showSceneInstant(scene) {
    $$('.scene').forEach((s) => s.classList.remove('active', 'fade-out'));
    $('#scene-' + scene).classList.add('active');
    currentScene = scene;
  }

  /* Rebuild a narration scene (1/2/4) frozen at a specific line. */
  function startNarrationAt(scene, startLine) {
    const cfg = SCENE_TEXT[scene];
    lineIdx = startLine;
    if (scene === 1) setWarmLayerInstant(startLine);
    else if (scene === 2) setHunterLayerInstant(startLine);
    else if (scene === 4) setAftermathFilterFor(startLine);
    else if (scene === 8) setCubLayerInstant(startLine);

    textCtx = { lines: cfg.lines, panel: cfg.panel, prompt: cfg.prompt, nextScene: cfg.nextScene, onAdvance: cfg.onAdvance };

    const line = cfg.lines[startLine];
    const panel = $(cfg.panel), prompt = $(cfg.prompt);
    if (line.big) panel.classList.add('text-big'); else panel.classList.remove('text-big');
    panel.textContent = lineText(line);        /* show instantly — already read */
    prompt.classList.remove('hidden');
    canInteract = true;
  }

  function jumpTo(beat) {
    closeHistory();
    playToken++;                 /* kill any in-flight typewriter */
    isTransitioning = false;
    canInteract = false;
    floodDone = false;
    stopDrone();

    showSceneInstant(beat.scene);
    setHint(hintFor(beat.scene), beat.scene === 3);

    if (beat.scene === 1 || beat.scene === 2 || beat.scene === 4 || beat.scene === 8 || beat.scene === 10) {
      startNarrationAt(beat.scene, beat.lineIdx);
    } else {
      enterScene(beat.scene);    /* 0/3/5/6 simply re-enter */
    }
  }

  function buildHistoryList() {
    const list = $('#historyList');
    list.innerHTML = '';
    historyBeats.forEach((b) => {
      const row = document.createElement('button');
      row.className = 'hist-item';
      const tag = document.createElement('span');
      tag.className = 'hist-tag';
      tag.textContent = I18N[LANG].sceneNames[b.scene] || ('Scene ' + b.scene);
      const txt = document.createElement('span');
      txt.className = 'hist-text';
      if (b.lineIdx >= 0 && SCENE_TEXT[b.scene]) {
        txt.textContent = lineText(SCENE_TEXT[b.scene].lines[b.lineIdx]);
      } else {
        txt.textContent = I18N[LANG].sceneDesc[b.scene] || '';
      }
      row.appendChild(tag);
      row.appendChild(txt);
      row.addEventListener('click', (e) => { e.stopPropagation(); jumpTo(b); });
      list.appendChild(row);
    });
  }

  function openHistory() {
    buildHistoryList();
    $('#historyPanel').classList.add('open');
    const list = $('#historyList');
    list.scrollTop = list.scrollHeight;   /* newest at the bottom */
  }
  function closeHistory() {
    $('#historyPanel').classList.remove('open');
  }

  /* ============ LANGUAGE (EN / 中文) ============ */
  function setTxt(sel, val) { const e = $(sel); if (e) e.textContent = val; }

  function applyStaticLang() {
    setTxt('.horror-label', t('cw'));
    const sub = $('.horror-sub'); if (sub) sub.innerHTML = t('warnSub');
    setTxt('#btnStart', t('enter'));
    setTxt('#prompt1', t('clickContinue'));
    setTxt('#prompt2', t('clickContinue'));
    setTxt('#prompt4', t('clickContinue'));
    setTxt('#prompt8', t('clickContinue'));
    setTxt('#promptIntro', t('clickContinue'));
    setTxt('#btnLearn', t('learnMore'));
    setTxt('#btnShare', t('share'));
    setTxt('#btnRefs', t('references'));
    setTxt('#btnWait', t('waitBtn'));
    setTxt('#btnShoot', t('shootBtn'));
    setTxt('#btnGuardian', t('guardianBtn'));
    setTxt('#btnGuardReturn', t('returnBtn'));
    setTxt('.refs-title', t('worksCited'));
    setTxt('.refs-sub', t('mla'));
    setTxt('#btnBackFromRefs', t('back'));
    setTxt('.history-title', t('rewind'));
    setTxt('.history-sub', t('rewindSub'));
    setTxt('#historyClose', t('close'));
    setTxt('.history-btn-label', t('rewind'));
    setTxt('#openingTagline', t('openingTagline'));
    setTxt('#openingSkip', t('skip'));
    document.documentElement.setAttribute('lang', LANG === 'zh' ? 'zh' : 'en');
    $$('.lang-opt').forEach((b) => b.classList.toggle('active', b.dataset.lang === LANG));
  }

  function setLang(lang) {
    if (lang !== 'en' && lang !== 'zh') return;
    LANG = lang;
    try { localStorage.setItem('e6s_lang', lang); } catch (_) {}
    applyStaticLang();
    setHint(hintFor(currentScene), currentScene === 3);

    /* re-render the introduction instantly in the new language */
    if (currentScene === 'intro') buildIntro(true);

    /* re-render a currently-shown narration line in the new language */
    const cfg = SCENE_TEXT[currentScene];
    if (cfg) {
      const panel = $(cfg.panel);
      if (panel && lineIdx >= 0 && lineIdx < cfg.lines.length && !panel.classList.contains('typewriter-cursor')) {
        panel.textContent = lineText(cfg.lines[lineIdx]);
      }
    }
    if (currentScene === 3) {
      const pk = $('#promptKill');
      if (pk) pk.textContent = floodDone ? t('pressEnter') : t('clickShoot');
    }
    /* choice prompt (only while the buttons are still showing) */
    if (currentScene === 7) {
      const ct = $('#choiceText');
      if (ct && !ct.classList.contains('typewriter-cursor') && $('#choiceButtons').style.opacity !== '0') {
        ct.textContent = t('choicePrompt');
      }
    }
    /* guardian protect scene — refresh its live texts */
    if (currentScene === 11) {
      const pg = $('#promptGuard');
      if (pg && pg.style.opacity !== '0') pg.textContent = t('guardHint');
      const gr = $('#guardResolve');
      if (gr && gr.classList.contains('show')) gr.textContent = t('guardResolve');
    }

    /* keep the live counter in the current language */
    renderDeathCounter();
  }

  /* ============ OPENING SPLASH (original, Genshin-style title reveal) ============ */
  function playChime() {
    if (!audioCtx) return;
    try {
      const now = audioCtx.currentTime;
      [[528, 0.0], [792, 0.05], [1056, 0.10]].forEach((p) => {
        const o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = 'sine'; o.frequency.value = p[0];
        g.gain.setValueAtTime(0.0001, now + p[1]);
        g.gain.exponentialRampToValueAtTime(0.11, now + p[1] + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, now + p[1] + 2.4);
        o.connect(g); g.connect(audioCtx.destination);
        o.start(now + p[1]); o.stop(now + p[1] + 2.6);
      });
    } catch (_) {}
  }

  function runOpening() {
    const op = $('#opening');
    if (!op) return;

    /* drifting light motes */
    const pc = $('#openingParticles');
    if (pc) {
      for (let i = 0; i < 34; i++) {
        const d = document.createElement('span');
        d.className = 'omote';
        d.style.left = (Math.random() * 100) + '%';
        d.style.animationDuration = (10 + Math.random() * 8) + 's';   /* slower drift */
        d.style.animationDelay = (Math.random() * 9 - 4) + 's';       /* some already mid-rise */
        d.style.setProperty('--sc', (0.6 + Math.random() * 1.5).toFixed(2));
        pc.appendChild(d);
      }
    }

    /* best-effort chime (may be blocked until first gesture) */
    try { initAudio(); if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume(); playChime(); } catch (_) {}

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      op.classList.add('done');
      setTimeout(() => { op.style.display = 'none'; }, 2100);   /* match the 2s out-fade */
    };
    const timer = setTimeout(finish, 8200);   /* hold the title before the long fade */
    const skip = $('#openingSkip');
    if (skip) skip.addEventListener('click', (e) => { e.stopPropagation(); clearTimeout(timer); finish(); });
    op.addEventListener('click', () => { clearTimeout(timer); finish(); });
  }

  /* ============ EVENT WIRING ============ */
  function init() {
    /* Scene 0 -> Introduction */
    $('#btnStart').addEventListener('click', () => {
      if (!canInteract) return;
      initAudio();
      goTo('intro');
    });

    /* Introduction -> Scene 1 */
    $('#scene-intro').addEventListener('click', (e) => {
      if (currentScene !== 'intro') return;
      if (e.target.closest('.btn')) return;
      if (!canInteract) return;
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

    /* Scene 7: the illusory choice */
    const btnWait = $('#btnWait');
    if (btnWait) btnWait.addEventListener('click', (e) => { e.stopPropagation(); chooseWait(); });
    const btnShoot = $('#btnShoot');
    if (btnShoot) btnShoot.addEventListener('click', (e) => { e.stopPropagation(); if (canInteract) { canInteract = false; goTo(3); } });

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

    /* Scene 8: cubs left behind — click to advance lines */
    $('#scene-8').addEventListener('click', (e) => {
      if (currentScene !== 8) return;
      if (e.target.closest('.btn')) return;
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

    /* References buttons */
    const refsBtn = $('#btnRefs');
    if (refsBtn) refsBtn.addEventListener('click', () => goTo(6));
    const backRefsBtn = $('#btnBackFromRefs');
    if (backRefsBtn) backRefsBtn.addEventListener('click', () => goTo(5));

    /* Guardian replay branch */
    const guardianBtn = $('#btnGuardian');
    if (guardianBtn) guardianBtn.addEventListener('click', () => goTo(10));
    $('#scene-10').addEventListener('click', (e) => {
      if (currentScene !== 10) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });
    $('#scene-11').addEventListener('click', handleProtect);
    $('#scene-11').addEventListener('mousemove', handleGuardMove);
    const guardReturn = $('#btnGuardReturn');
    if (guardReturn) guardReturn.addEventListener('click', (e) => { e.stopPropagation(); goTo(5); });

    /* Share button */
    const shareBtn = $('#btnShare');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const msg = t('shareMsg');
        if (navigator.share) {
          navigator.share({ title: 'Every 6 Seconds', text: msg, url: location.href });
        } else {
          navigator.clipboard.writeText(msg + ' ' + location.href).then(() => {
            shareBtn.textContent = t('copied');
            setTimeout(() => { shareBtn.textContent = t('share'); }, 2000);
          });
        }
      });
    }

    /* Persistent rewind button + history panel */
    const histBtn = $('#historyBtn');
    if (histBtn) histBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const panel = $('#historyPanel');
      if (panel.classList.contains('open')) closeHistory();
      else openHistory();
    });
    const histPanel = $('#historyPanel');
    if (histPanel) histPanel.addEventListener('click', (e) => {
      if (e.target.id === 'historyPanel') closeHistory();   /* click backdrop to close */
    });
    const histClose = $('#historyClose');
    if (histClose) histClose.addEventListener('click', (e) => { e.stopPropagation(); closeHistory(); });

    /* start the "every 6 seconds" clock the moment the page is open */
    pageOpenTime = Date.now();

    /* Language toggle (top-left) */
    $$('.lang-opt').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      setLang(b.dataset.lang);
    }));
    applyStaticLang();

    /* Opening splash, then the 16+ page underneath */
    runOpening();

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
