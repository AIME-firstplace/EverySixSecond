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
  let heartbeatTimer = null;    /* (D) persistent 6s tick */

  let peltEndingTarget = null;   /* when set, 那张皮(9) ends on this ending instead of the truth */
  let endingContinueTo = null;   /* target scene for the ending「继续」button */

  /* (甲·双层) story unlock + which endings have been reached */
  let storyUnlocked = false;
  const unlockedEndings = new Set();
  try {
    storyUnlocked = localStorage.getItem('e6s_unlocked') === '1';
    JSON.parse(localStorage.getItem('e6s_endings') || '[]').forEach((e) => unlockedEndings.add(e));
  } catch (_) {}
  function unlockStory() {
    storyUnlocked = true;
    try { localStorage.setItem('e6s_unlocked', '1'); } catch (_) {}
  }
  function recordEnding(key) {
    unlockedEndings.add(key);
    try { localStorage.setItem('e6s_endings', JSON.stringify([...unlockedEndings])); } catch (_) {}
    unlockStory();
  }
  function endName(key) { return t('endName_' + key); }
  let flashbackShown = false;   /* (C) only flash once per kill scene */
  let ambientEl = null;         /* (E) rainforest ambience bed */
  let momentRAF = null;         /* (Moment) particle animation handle */

  /* ============ STORY DATA (JSON-driven) ============ */
  const WARM_LINES = [
    { text: { en: 'Her name is Momo.', zh: '她叫莫莫。' }, speed: 50, wait: 800 },
    { text: { en: 'They live deep in the Amazon.', zh: '她们住在亚马逊的深处。' }, speed: 45, wait: 700 },
    { text: { en: 'The water is still.', zh: '水面平静无波。' }, speed: 50, wait: 800 },
    { text: { en: 'She has two cubs.', zh: '她有两只幼崽。' }, speed: 50, wait: 700 },
    { text: { en: 'Mira, the older one. She loves to climb.', zh: '米拉，姐姐。她爱攀爬。' }, speed: 45, wait: 800 },
    { text: { en: "{cub}, the younger. He's afraid of the river.", zh: '{cub}，弟弟。他怕河水。' }, speed: 45, wait: 800 },
    { text: { en: 'She nudges him to the water’s edge. He freezes, afraid.', zh: '她把他轻轻推到水边。他僵住了，害怕。' }, speed: 50, wait: 700, gate: 'feed' },
    { text: { en: 'He drinks at last. The river does not take him.', zh: '他终于喝上了水。河水没有带走他。' }, speed: 46, wait: 900 },
    { text: { en: 'For the first time, he trusted the water — because you stayed.', zh: '他第一次，信任了这条河 —— 因为你陪着他。' }, speed: 46, wait: 1100 },
    { text: { en: 'Momo teaches them how to listen.', zh: '莫莫教它们如何倾听。' }, speed: 50, wait: 700 },
    { text: { en: 'How to wait. How to stay.', zh: '如何等待。如何留守。' }, speed: 55, wait: 1200 },
    { text: { en: "She doesn't know you're watching.", zh: '她不知道你正在窥视。' }, speed: 50, wait: 500 },
  ];

  /* Per-line "beat" image for scene 1. Same rainforest background in every
     frame — only the jaguar subjects change. Adjacent lines reuse a beat. */
  const WARM_BEATS = [
    'harlow.png',     /* Her name is Momo.                         */
    'harlow.png',     /* They live deep in the Amazon.              */
    'harlow.png',     /* The water is still.                        */
    'family.png',     /* She has two cubs.                          */
    'mira.png',       /* Mira, the older one. She loves to climb.   */
    'sol.png',        /* Sol, the younger. He's afraid of the river.*/
    'sol.png',        /* She nudges him to the water's edge (afraid)*/
    'sol_drink.png',  /* He drinks at last. (④ new art — animates)  */
    'sol_drink.png',  /* For the first time, he trusted the water.  */
    'listen.png',     /* Momo teaches them how to listen.           */
    'listen.png',     /* How to wait. How to stay.                  */
    'watched.png',    /* She doesn't know you're watching.          */
  ];

  const HUNTER_LINES = [
    { text: { en: 'You watched them for a long time, through the leaves.', zh: '你透过枝叶，看了它们很久。' }, speed: 52, wait: 1300 },
    { text: { en: 'The hands holding the branches apart are holding a rifle.', zh: '那双拨开枝叶的手，也握着一支枪。' }, speed: 48, wait: 1600 },
    { text: { en: 'You are a hunter.', zh: '你是个猎人。' }, speed: 60, wait: 1200 },
    { text: { en: 'You came for the skin.', zh: '你为皮毛而来。' }, speed: 55, wait: 1000 },
    { text: { en: 'It pays well.', zh: '它能卖个好价钱。' }, speed: 70, wait: 1500 },
  ];

  /* Per-line beat image for scene 2 (same dark forest + rifle, only the
     jaguar changes): watching -> the rifle -> unaware -> pelt -> alarmed. */
  const HUNTER_BEATS = [
    'hidden.png',  /* You watched them...    */
    'hidden.png',  /* ...holding a rifle.    */
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
    { text: { en: '{cub} crossed the river. The one he was always afraid of.', zh: '{cub}渡过了那条河 —— 他一直害怕的那条。' }, speed: 50, wait: 1500 },
    { text: { en: 'No one was left to carry him across.', zh: '再没有谁能驮他过去了。' }, speed: 55, wait: 1800 },
    { text: { en: 'Mira climbed to the highest branch — the way her mother taught her.', zh: '米拉爬上了最高的枝头 —— 像母亲教过她的那样。' }, speed: 48, wait: 1500 },
    { text: { en: 'She watched the trees until dark. No one came.', zh: '她望着林子，直到天黑。没有人来。' }, speed: 52, wait: 2400, big: true },
    { text: { en: 'Mira waited three more nights. Then the branch was empty.', zh: '米拉又守了三个夜晚。然后，那根枝头空了。' }, speed: 50, wait: 2000 },
    { text: { en: 'A cub alone rarely lasts a single season.', zh: '一只落单的幼崽，很少能熬过一整个旱季。' }, speed: 52, wait: 1900 },
    { text: { en: '{cub} stayed by the river — the water she once nudged him toward.', zh: '{cub}留在了河边 —— 那片她曾一点点把他推向的水。' }, speed: 48, wait: 1700 },
    { text: { en: 'Thin, and alone. But still here.', zh: '瘦弱，孤单。但还活着。' }, speed: 50, wait: 1800 },
    { text: { en: 'A cub almost never makes it without a mother. {cub} is the almost — still carrying the name you gave him.', zh: '没有母亲的幼崽，几乎无一幸免。{cub}就是那个「几乎」—— 仍带着你给他的名字。' }, speed: 48, wait: 2600, big: true },
  ];
  const CUB_BEATS = ['sol_river.png', 'sol_river.png', 'mira_tree.png', 'mira_tree.png', 'mira_tree.png', 'mira_tree.png', 'sol_river.png', 'sol_river.png', 'sol_river.png'];

  /* Scene 9 — where the skin goes (forest → market → wall). Echoes "it pays well". */
  const PELT_LINES = [
    { text: { en: 'Her skin was lifted from where she fell.', zh: '她的皮，从她倒下的地方被剥走。' }, speed: 50, wait: 1600 },
    { text: { en: 'It was sold at a stall — beside the ivory, the cages.', zh: '它被卖到一个摊位 —— 挨着象牙，挨着鸟笼。' }, speed: 48, wait: 1600 },
    { text: { en: 'Now it hangs on a wall, in a house she will never see.', zh: '如今它挂在一面墙上，在一座她永远见不到的房子里。' }, speed: 48, wait: 1800 },
    { text: { en: 'It paid well.', zh: '它，确实卖了个好价钱。' }, speed: 70, wait: 2400, big: true },
    { text: { en: "'It's beautiful,' a guest says. 'Is it real?'", zh: '「真漂亮，」一位客人说。「是真的吗？」' }, speed: 50, wait: 1700 },
    { text: { en: "'Of course it is,' the owner smiles.", zh: '「当然是真的，」主人微笑着。' }, speed: 50, wait: 1800 },
    { text: { en: 'No one in this bright room knows she ever had a name.', zh: '这间明亮的屋子里，没有人知道她曾有过一个名字。' }, speed: 48, wait: 1900 },
    { text: { en: 'The hunter pulled the trigger. But the wall is the reason.', zh: '猎人扣下了扳机。但那面墙，才是原因。' }, speed: 48, wait: 2600, big: true },
  ];
  const PELT_BEATS = ['pelt_forest.png', 'pelt_market.png', 'pelt_wall.png', 'pelt_wall.png', 'pelt_wall.png', 'pelt_wall.png', 'pelt_wall.png', 'pelt_wall.png'];

  /* Scene 10 — guardian reframe (the replay's new identity) */
  const GUARD_LINES = [
    { text: { en: 'This time, you are not the one with the rifle.', zh: '这一次，握枪的不是你。' }, speed: 52, wait: 1400 },
    { text: { en: 'You are a guardian of this forest — a ranger, a child of this land.', zh: '你是这片森林的守护者 —— 一名护林员，这片土地的孩子。' }, speed: 46, wait: 1600 },
    { text: { en: 'When the hunters come, you do not aim at the jaguars. You shield them.', zh: '当猎人来时，你不瞄准美洲豹。你护住它们。' }, speed: 48, wait: 1800 },
  ];
  const GUARD_NEEDED = 3;
  let guardCount = 0;

  /* Guardian replay — the full parallel walk (reuses existing backgrounds) */
  const GUARD_WARM_LINES = [
    { text: { en: 'Momo and her cubs are here — alive, the same as before.', zh: '莫莫和她的幼崽都在 —— 活着，和从前一样。' }, speed: 48, wait: 1500 },
    { text: { en: 'Only this time, someone watches the tree line for them.', zh: '只是这一次，有人替它们守着林线。' }, speed: 50, wait: 1700 },
  ];
  const GUARD_HUNT_LINES = [
    { text: { en: 'The hunter comes, the way he always does.', zh: '猎人来了，一如既往。' }, speed: 52, wait: 1400 },
    { text: { en: 'This time you do not raise a rifle — you step into the clearing.', zh: '这一次，你没有举枪 —— 你走进了那片空地。' }, speed: 48, wait: 1600 },
    { text: { en: 'You make yourself seen. You make him turn back.', zh: '你让自己被看见。你让他掉头离开。' }, speed: 50, wait: 1700 },
  ];
  const GUARD_END_LINES = [
    { text: { en: 'The cubs grow. Sol learns the river; Mira learns the canopy.', zh: '幼崽长大了。索尔学会了河，米拉学会了树冠。' }, speed: 48, wait: 1600 },
    { text: { en: 'Because someone stayed between them and the gun.', zh: '因为有人，一直挡在它们和枪口之间。' }, speed: 50, wait: 1800 },
    { text: { en: 'Every six seconds, one is lost. But not this one. Not today.', zh: '每六秒，就有一个消逝。但不是这一只。不是今天。' }, speed: 52, wait: 2600, big: true },
  ];

  /* Scene 15 · 支线① — She was once a cub too (Momo's own flashback). */
  const SUBLINE1_LINES = [
    { text: { en: 'Long before Sol. Long before Mira.', zh: '在索尔出生之前。在米拉出生之前。' }, speed: 50, wait: 1400 },
    { text: { en: 'Momo was small once, too.', zh: '莫莫，也曾经那么小。' }, speed: 52, wait: 1500 },
    { text: { en: 'Her own mother led her to this same water.', zh: '她自己的母亲，曾把她领到这同一片水边。' }, speed: 48, wait: 1500 },
    { text: { en: 'Nudged her in, the day she was afraid of it.', zh: '在她怕水的那天，把她一点点推进水里。' }, speed: 48, wait: 1600 },
    { text: { en: 'The forest raised her, the way it raises them all.', zh: '这片森林养大了她 —— 像它养大每一个孩子。' }, speed: 48, wait: 1700 },
    { text: { en: 'One generation, then the next. The same green, the same water — and the same crosshair, waiting in the leaves.', zh: '一代，又一代。同一片绿，同一片水 —— 还有枝叶里，同一个等待着的准星。' }, speed: 46, wait: 2600, big: true },
  ];

  /* Scene 20 · 支线② — Years later: Sol grown, the circle closes. */
  const SUBLINE2_LINES = [
    { text: { en: 'Years pass. The water is still here.', zh: '很多年过去了。这片水，还在。' }, speed: 50, wait: 1300 },
    { text: { en: '{cub} grew up. He never left this place.', zh: '{cub}长大了。他再没离开过这里。' }, speed: 48, wait: 1500 },
    { text: { en: 'Now there is a smaller one at his side — his own.', zh: '如今他身边，也有了一只更小的 —— 他自己的孩子。' }, speed: 48, wait: 1500 },
    { text: { en: 'Afraid of the water — just as he once was.', zh: '怕水 —— 就像当年的他。' }, speed: 48, wait: 1500 },
    { text: { en: 'He nudges the little one toward the edge. The circle closes.', zh: '他把那小家伙，一点点推向水边。一个圈，就此合上。' }, speed: 48, wait: 1700 },
    { text: { en: 'And in the trees — where you once stood — something is watching again.', zh: '而在林子深处 —— 你曾站立的地方 —— 有什么，又在注视。' }, speed: 46, wait: 2600, big: true },
  ];

  /* Ending「空枪」— you lowered the gun and walked away; the clock didn't stop. */
  const EMPTYGUN_LINES = [
    { text: { en: 'You lowered the rifle. You backed into the trees.', zh: '你放下了枪。你退回了林子里。' }, speed: 50, wait: 1500 },
    { text: { en: 'She never knew you were there. You told yourself you saved her.', zh: '她始终不知道你来过。你告诉自己：你救了她。' }, speed: 48, wait: 1600 },
    { text: { en: 'But the skin still pays — and down the river, another rifle was already raised.', zh: '可那张皮还是值钱 —— 而沿着河往下，另一支枪，早已举起。' }, speed: 48, wait: 1700 },
    { text: { en: 'Six seconds. Then six more. The clock did not care that you walked away.', zh: '六秒。又六秒。那座钟，不在乎你转身离开。' }, speed: 48, wait: 1800 },
    { text: { en: 'You saved this one. You did not save the rate.', zh: '你救了这一只。你没能救下那个速率。' }, speed: 46, wait: 2400, big: true },
  ];

  /* Ending「长夜」— you stayed; the orphaned cubs survive their first night. */
  const LONGNIGHT_LINES = [
    { text: { en: 'You stayed. You did not follow the money.', zh: '你留了下来。你没有追着钱走。' }, speed: 50, wait: 1500 },
    { text: { en: 'You could not bring their mother back — but you did not leave them alone.', zh: '你唤不回它们的母亲 —— 但你没有丢下它们。' }, speed: 48, wait: 1700 },
    { text: { en: 'Through the long, cold dark, the two cubs pressed together and waited.', zh: '在漫长冰冷的黑里，两只幼崽挤在一起，等着。' }, speed: 48, wait: 1700 },
    { text: { en: 'One kept its eyes open until the sky turned grey.', zh: '有一只，把眼睛睁到天色泛白。' }, speed: 48, wait: 1800 },
    { text: { en: 'Then — at first light — voices. Footsteps through the wet leaves.', zh: '然后 —— 天刚亮 —— 有人声。脚步踩过湿叶。' }, speed: 48, wait: 1700 },
    { text: { en: 'Not hunters. Rangers — a rescue team, radioed in before dawn.', zh: '不是猎人。是护林员 —— 是天亮前就被叫来的救援队。' }, speed: 48, wait: 1700 },
    { text: { en: '"Over here — quick — get them warm." Gentle hands lift them from the dark.', zh: '「在这儿 —— 快 —— 给它们保暖。」一双双手，把它们从黑暗里轻轻托起。' }, speed: 46, wait: 1900 },
    { text: { en: 'They lost their mother. But they were not lost. Not this time.', zh: '它们失去了母亲。但它们没有被丢下。这一次，没有。' }, speed: 46, wait: 2600, big: true },
  ];

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
      pressEnter: '[ Tap, or press Enter ]',
      learnMore: 'Learn more',
      share: 'Share',
      shareMsg: 'I named a jaguar cub {cub}. Every 6 seconds, an animal dies because of us.',
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
      defaultCub: 'Sol',
      nameLabel: 'Give one of her cubs a name:',
      namePlaceholder: 'Sol',
      saveCard: 'Save the card',
      cardStayed: 'You stayed {t}.',
      cardKilled: 'In that time, an estimated {n} wild animals were killed.',
      cardNamed: 'You gave one of them a name: {cub}.',
      cardClosing: 'Not without you.',
      momentLine: 'Remember this green.',
      momentLine2: "It won't be green when you come back.",
      counterTpl: 'In the <em class="fig">{t}</em> you have spent here, an estimated <em class="fig">{n}</em> wild animals were killed for human use.',
      counterNote: 'An illustrative estimate (one every 6 seconds), drawn from documented annual tolls: up to 2.7M pangolins, ~20,000 elephants, 1,000+ rhinos and countless more. — <a href="https://www.awf.org/blog/27-million-pangolins-are-poached-every-year-scales-and-meat" target="_blank" rel="noopener">AWF</a>',
      choicePrompt: 'She still hasn\'t seen you.',
      waitBtn: 'Wait',
      shootBtn: 'Shoot',
      hbLabel: 'lost',
      feedHint: 'Coax him to the water — tap the river',
      /* --- branching choices & multiple endings (甲·双层) --- */
      replayHint: 'This time, the choice is yours.',
      lowerBtn: 'Lower the gun',
      slipBtn: 'Slip away',
      followBtn: 'Follow the skin',
      stayBtn: 'Stay with them',
      forkPrompt: 'She is gone. What do you do now?',
      deathChar: 'DEAD',
      deathBeat1: 'A dry branch snapped under your boot.',
      deathBeat2: 'She whips her head around. She has seen you.',
      deathLine: 'You hesitated — and she was faster.',
      unlockTpl: 'ENDING UNLOCKED · 「{name}」',
      rewindChoiceBtn: 'Back to the choice',
      restartBtn: 'From the beginning',
      continueBtn: 'Follow the skin',
      namedRecall: 'You gave one of her cubs a name: <span class="cubname">{cub}</span>.',
      fate_xuejia: '{cub} survived — thin, and alone.',
      fate_daijia: 'They lived. You did not.',
      fate_changye: '{cub} was lifted out of the dark — alive.',
      fate_kongqiang: 'Someone else pulled the trigger. {cub} lost her mother all the same.',
      fate_poxiao: '{cub} grew up — safe.',
      actBtn: 'What you can do',
      actTitle: 'What actually helps',
      act1: 'Never buy wildlife products — skins, teeth, exotic pets. No demand, no killing.',
      act2: 'Back the people on the ground — rangers, and groups like <a href="https://panthera.org" target="_blank" rel="noopener">Panthera</a>, WWF, Rainforest Trust.',
      act3: 'Share one story. The fastest way a number becomes real to someone else — is you.',
      actClose: 'Close',
      endName_xuejia: 'Blood Money',
      endName_daijia: 'Reckoning',
      endName_changye: 'Nightfall',
      endName_kongqiang: 'Hollow',
      endName_poxiao: 'Daybreak',
      waitLines: ['You waited.', 'But the skin still pays.', 'Your finger moved anyway.'],
      refuseLines: [
        "You lower the rifle. You don't fire.",
        'Momo lifts her head. The cubs slip into the green. For one breath — they are gone.',
        'You let this family live.',
        'But the clock did not wait with you.',
        'Six seconds — somewhere you will never see, another one fell.',
        'The rifle is still in your hands. There is always another season. Another hunter.',
      ],
      guardianBtn: 'Walk it again, as a guardian',
      guardHint: 'Aim  ·  tap each one to keep it safe',
      guardResolve: 'They live. This time, they live.',
      returnBtn: 'Continue',
      citeJaguar: 'Jaguars are trafficked for their skins, teeth & skulls — <a href="https://cites.org/eng/CITES_study_illegal_trade_poaching_jaguar_pantheraonca_2112021" target="_blank" rel="noopener">CITES study, 2021</a>',
      hints: {
        intro: 'Click anywhere to continue',
        0: 'Click  ENTER  to begin',
        1: 'Click anywhere to continue',
        2: 'Click anywhere to continue',
        3: 'Aim  ·  click or tap to shoot',
        4: 'Click anywhere to continue',
        5: 'Choose an option below',
        6: 'Click  BACK  to return',
        7: 'Make your choice',
        8: 'Click anywhere to continue',
        9: 'Click anywhere to continue',
        10: 'Click anywhere to continue',
        11: 'Aim  ·  tap each one to keep it safe',
        12: 'Click anywhere to continue',
        13: 'Click anywhere to continue',
        14: 'Click anywhere to continue',
        16: 'Take it in  ·  click when you are ready',
      },
      hintPressEnter: 'Tap, click, or press  ENTER',
      sceneNames: { intro: 'Introduction', 0: 'Warning', 1: 'Warmth', 15: 'She Was a Cub Too', 16: 'The Moment', 2: 'The Hunter', 7: 'The Choice', 3: 'The Shot', 4: 'Aftermath', 8: 'The Cubs', 20: 'Years Later', 9: 'The Skin', 5: 'The Truth', 6: 'Sources', 10: 'The Guardian', 12: 'Watch', 13: 'Step In', 11: 'Protect', 14: 'They Live', 21: 'Reckoning', 22: 'Hollow', 23: 'Nightfall' },
      sceneDesc: { intro: 'Before you begin', 0: 'Content warning', 15: 'SIDE · a memory, one generation back', 20: 'SIDE · the circle closes, one generation on', 7: 'A choice that was never yours', 3: 'The hunt — you pull the trigger', 5: 'The truth & the data', 6: 'Works cited', 10: 'Walk it again, as a guardian', 11: 'You shield them', 21: 'ENDING · you hesitated', 22: 'ENDING · you walked away', 23: 'ENDING · the first night' },
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
          'Read this slowly. In the six seconds it takes, somewhere, one wild life is already gone.',
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
      pressEnter: '[ 点击，或按 Enter 继续 ]',
      learnMore: '了解更多',
      share: '分享',
      shareMsg: '我给一只美洲豹幼崽起名叫 {cub}。每 6 秒，就有一只动物因我们而死。',
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
      defaultCub: '索尔',
      nameLabel: '给她的一只幼崽起个名字：',
      namePlaceholder: '索尔',
      saveCard: '保存结局卡',
      cardStayed: '你在这里停留了 {t}。',
      cardKilled: '这期间，估计有 {n} 个野生生命被杀死。',
      cardNamed: '你给其中一只起名叫 {cub}。',
      cardClosing: '没有你，就不够。',
      momentLine: '记住这片绿。',
      momentLine2: '等你回来，它就不绿了。',
      counterTpl: '在你停留于此的 <em class="fig">{t}</em> 里，估计已有 <em class="fig">{n}</em> 个野生生命，因人类而死。',
      counterNote: '示意性估算（按每 6 秒一只），依据已记录的年度数字：穿山甲高达 270 万、大象约 2 万、犀牛 1000+，以及无数其他。— <a href="https://www.awf.org/blog/27-million-pangolins-are-poached-every-year-scales-and-meat" target="_blank" rel="noopener">AWF</a>',
      choicePrompt: '她还没有发现你。',
      waitBtn: '等待',
      shootBtn: '开枪',
      hbLabel: '已逝去',
      feedHint: '哄他到水边 —— 轻触河面',
      /* --- 分支选择 & 多结局 (甲·双层) --- */
      replayHint: '这一次，选择是你的。',
      lowerBtn: '放下枪',
      slipBtn: '悄悄退走',
      followBtn: '追着皮走',
      stayBtn: '留下陪它们',
      forkPrompt: '她不在了。现在，你怎么做？',
      deathChar: '死',
      deathBeat1: '你脚下，一根枯枝啪地断了。',
      deathBeat2: '她猛地回过头来。她，看见你了。',
      deathLine: '你迟疑了 —— 而她，比你快。',
      unlockTpl: '解锁结局 ·「{name}」',
      rewindChoiceBtn: '回到那个选择',
      restartBtn: '从头再来',
      continueBtn: '继续 · 跟着那张皮',
      namedRecall: '你给她的一只幼崽，起名叫 <span class="cubname">{cub}</span>。',
      fate_xuejia: '{cub} 独自活了下来 —— 瘦弱，孤单。',
      fate_daijia: '它们活了下来。你，没有。',
      fate_changye: '{cub} 被人从黑暗里抱了出来 —— 活着。',
      fate_kongqiang: '别人替你扣下了扳机。{cub} 还是失去了母亲。',
      fate_poxiao: '{cub} 长大了 —— 平安。',
      actBtn: '你能做什么',
      actTitle: '真正有用的，是这三件',
      act1: '永远别买野生制品 —— 皮、牙、异宠。没有需求，就没有猎杀。',
      act2: '支持一线的人 —— 护林员，以及 <a href="https://panthera.org" target="_blank" rel="noopener">Panthera</a>、WWF、雨林信托这样的组织。',
      act3: '分享一个故事。一个数字之所以能击中别人 —— 往往就因为，是你转了它。',
      actClose: '关闭',
      endName_xuejia: '血价',
      endName_daijia: '代价',
      endName_changye: '长夜',
      endName_kongqiang: '空枪',
      endName_poxiao: '破晓',
      waitLines: ['你等了。', '但皮还是值钱。', '你的手指还是动了。'],
      refuseLines: [
        '你放下了枪。你没有开火。',
        '莫莫抬起头。幼崽没入绿色之中。仅仅一瞬 —— 它们不见了。',
        '你放过了这一家。',
        '但那座钟，没有陪你一起等。',
        '六秒 —— 在你永远看不到的地方，又一只倒下了。',
        '枪，还在你手里。永远会有下一个旱季。下一个猎人。',
      ],
      guardianBtn: '以守护者身份，重走一遍',
      guardHint: '瞄准  ·  点击护住每一只',
      guardResolve: '它们活了下来。这一次，它们活了下来。',
      returnBtn: '继续',
      citeJaguar: '美洲豹因皮、牙、头骨遭非法贩运 — <a href="https://cites.org/eng/CITES_study_illegal_trade_poaching_jaguar_pantheraonca_2112021" target="_blank" rel="noopener">CITES 研究，2021</a>',
      hints: {
        intro: '点击任意处继续',
        0: '点击「进入」开始',
        1: '点击任意处继续',
        2: '点击任意处继续',
        3: '瞄准  ·  点击开枪',
        4: '点击任意处继续',
        5: '在下方做出选择',
        6: '点击「返回」',
        7: '做出你的选择',
        8: '点击任意处继续',
        9: '点击任意处继续',
        10: '点击任意处继续',
        11: '瞄准  ·  点击护住每一只',
        12: '点击任意处继续',
        13: '点击任意处继续',
        14: '点击任意处继续',
        16: '好好看看它  ·  准备好了再点',
      },
      hintPressEnter: '点击任意处，或按  ENTER',
      sceneNames: { intro: '序', 0: '警告', 1: '温暖', 15: '她也曾是幼崽', 16: '凝住的一刻', 2: '猎人', 7: '选择', 3: '那一枪', 4: '余波', 8: '幼崽', 20: '多年以后', 9: '那张皮', 5: '真相', 6: '来源', 10: '守护者', 12: '守望', 13: '挺身', 11: '守护', 14: '它们活着', 21: '代价', 22: '空枪', 23: '长夜' },
      sceneDesc: { intro: '开始之前', 0: '内容警告', 15: '支线 · 一段回忆，往上一代', 20: '支线 · 一个圈合上了，往下一代', 7: '一个从来不属于你的选择', 3: '狩猎 —— 你扣下扳机', 5: '真相与数据', 6: '参考文献', 10: '以守护者身份，重走一遍', 11: '你护住它们', 21: '结局 · 你迟疑了', 22: '结局 · 你转身离开', 23: '结局 · 第一个夜晚' },
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
          '慢慢读这句话。就在它花掉的这六秒里，某个地方，已经有一个野生的生命消失了。',
          '每年，多达 <em class="fig">270 万只穿山甲</em> 死于盗猎。约 <em class="fig">2 万头大象</em>，为了象牙。<em class="fig">一千多头犀牛</em>，为了犀角 —— 还有无数没人统计的美洲豹、树懒和金刚鹦鹉。',
          '加在一起，<em class="fig">大约每过六秒，就有一个野生的生命被夺走。</em>',
        ],
        note: '大到这种程度的数字，会失去意义。所以我把其中一个从统计里抽出来，给了她一个名字。她不是真的 —— 那六秒是真的。我不是要你愧疚，我只是不想让她，只剩下一个数字。',
      },
    },
  };

  const t = (key) => (I18N[LANG] && I18N[LANG][key] != null ? I18N[LANG][key] : I18N.en[key]);
  let cubNameCustom = '';   /* player-chosen cub name (A); empty = use default */
  const getCubName = () => (cubNameCustom || t('defaultCub'));
  function lineText(line) {
    let s = (line && typeof line.text === 'object') ? (line.text[LANG] || line.text.en) : (line ? line.text : '');
    return s.replace(/\{cub\}/g, getCubName());
  }
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

    if (line.gate === 'feed') {                 /* feed gate: stay locked until the water is tapped */
      await delay(line.wait || 800);
      if (myToken !== playToken) return;
      startFeedGate(promptSel);
      return;
    }

    canInteract = true;                         /* a click advances immediately now — no waiting out `wait` */
    await delay(line.wait || 800);
    if (myToken !== playToken) return;
    prompt.classList.remove('hidden');
  }

  /* (④) Feeding gate: a global click won't advance — only tapping the water
     does. The player completes the nudge Momo began; then Sol drinks. */
  function startFeedGate(promptSel) {
    const hot = $('#warmTouch');
    const prompt = $(promptSel);
    if (prompt) { prompt.textContent = t('feedHint'); prompt.classList.remove('hidden'); }
    if (!hot) { canInteract = true; return; }   /* fallback: behave like a normal line */
    hot.classList.add('show');
    hot.onclick = function (e) {
      if (e) e.stopPropagation();
      hot.onclick = null;
      hot.classList.remove('show');
      try { initAudio(); playChime(); } catch (_) {}
      const r = hot.getBoundingClientRect();
      spawnRipples(e ? e.clientX : r.left + r.width / 2, e ? e.clientY : r.top + r.height / 2);
      if (prompt) prompt.textContent = t('clickContinue');
      canInteract = true;
      advanceText();
    };
  }

  /* (④) expanding water rings where the cub's muzzle meets the surface */
  function spawnRipples(cx, cy) {
    const host = $('#scene-1');
    if (!host) return;
    for (let i = 0; i < 3; i++) {
      const ring = document.createElement('div');
      ring.className = 'ripple';
      ring.style.left = cx + 'px';
      ring.style.top = cy + 'px';
      ring.style.animationDelay = (i * 0.22) + 's';
      host.appendChild(ring);
      setTimeout(() => ring.remove(), 1500 + i * 220);
    }
  }

  function advanceText() {
    if (!canInteract) return;
    canInteract = false;
    playToken++;   /* abort the still-pending wait of the line we're leaving (prevents a late prompt flash) */
    lineIdx++;
    if (textCtx.onAdvance) textCtx.onAdvance(lineIdx);
    if (lineIdx < textCtx.lines.length) {
      playLine(textCtx.panel, textCtx.prompt, textCtx.lines[lineIdx]);
    } else if (textCtx.onEnd) {
      textCtx.onEnd();
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
  /* 支线 scenes — entering one plays a ~2s black-screen interlude first */
  const BRANCH_SCENES = new Set([15, 20]);

  function goTo(sceneId) {
    if (isTransitioning) return;
    isTransitioning = true;
    canInteract = false;
    playToken++;   /* abort any line still typing in the outgoing scene */
    const cur = $(`#scene-${currentScene}`);
    const nxt = $(`#scene-${sceneId}`);

    if (BRANCH_SCENES.has(sceneId) || BRANCH_SCENES.has(currentScene)) {
      /* main ↔ 支线 : 2s black interlude on the way in AND on the way out */
      const black = $('#blackout');
      if (black) black.classList.add('show');
      setTimeout(() => {
        cur.classList.remove('active', 'fade-out');
        nxt.classList.add('active');
        currentScene = sceneId;
        enterScene(sceneId);
        setTimeout(() => { if (black) black.classList.remove('show'); isTransitioning = false; }, 1150);
      }, 900);
      return;
    }

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
    3: 'Aim  ·  click or tap to shoot',
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
    document.body.classList.toggle('pure', id === 16);   /* wordless image hides all UI */
    setHint(hintFor(id), id === 3);
    /* scenes without per-line narration are logged as a single beat */
    if (id === 'intro' || id === 0 || id === 3 || id === 5 || id === 6 || id === 7 || id === 11 || id === 16) recordBeat(id, -1, '');
    switch (id) {
      case 'intro': enterIntro(); break;
      case 0: enterHorror();     break;
      case 1: enterWarm();       break;
      case 15: enterSubline1();  break;
      case 20: enterSubline2();  break;
      case 21: enterDeath();     break;
      case 22: enterEmptyGun();  break;
      case 23: enterLongNight(); break;
      case 16: enterMoment();    break;
      case 2: enterHunter();     break;
      case 7: enterChoice();     break;
      case 3: enterKill();       break;
      case 4: enterAftermath();  break;
      case 8: enterCub();        break;
      case 9: enterPelt();       break;
      case 5: enterReveal();     break;
      case 6: /* references — static */ break;
      case 10: enterGuardianIntro(); break;
      case 12: enterGuardWarm();  break;
      case 13: enterGuardHunt();  break;
      case 11: enterGuardian();  break;
      case 14: enterGuardEnd();   break;
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
    const nm = $('#introName');
    if (nm) { nm.classList.remove('hidden'); await delay(20); nm.classList.add('show'); }
    $('#promptIntro').classList.remove('hidden');
    canInteract = true;
  }

  function captureCubName() {
    const inp = $('#cubNameInput');
    if (inp && inp.value.trim()) cubNameCustom = inp.value.trim().slice(0, 14);
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
    startAmbient();   /* (E) rainforest bed begins */
    const hot = $('#warmTouch');   /* (④) reset the feeding beacon on every (re)entry */
    if (hot) { hot.onclick = null; hot.classList.remove('show'); }

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
      nextScene: 15,   /* 支线① : 她也曾是幼崽 (then returns to the hunter) */
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
    startAmbient();   /* (E) forest continues into the hunter scene */

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
    flashbackShown = false;   /* (C) arm the pre-shot flashback again */
    startAmbient();           /* (E) forest plays until the shot cuts it */
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

  /* leave the blood-flood for the aftermath — Enter, Space, or a click/tap */
  function advanceFromFlood() {
    if (currentScene !== 3 || !floodDone) return;
    floodDone = false;
    canInteract = false;
    goTo(4);
  }

  function handleKill(e) {
    if (!canInteract || killCount >= KILLS_NEEDED) return;
    const cx = e.clientX, cy = e.clientY;
    /* (C) the first trigger-pull: she looks up at you — one flash, then the shot */
    if (!flashbackShown) {
      flashbackShown = true;
      canInteract = false;
      showFlashback();
      setTimeout(() => { canInteract = true; doShot(cx, cy); }, 720);
      return;
    }
    doShot(cx, cy);
  }

  function doShot(cx, cy) {
    if (!canInteract || killCount >= KILLS_NEEDED) return;

    stopAmbient();   /* (E) the gunshot cuts the forest to silence */

    /* every shot fires the gun — feedback even on a miss */
    fireGun();
    recoilShake();
    playGunshot();

    const target = targetUnderPoint(cx, cy);
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
    stopAmbient();   /* (E) ensure the silence holds */
    lineIdx = 0;

    const bg = $('#bg4');
    bg.style.filter = 'brightness(0.75) saturate(0.7)';

    const fb = $('#forkButtons'); if (fb) { fb.classList.add('hidden'); fb.style.opacity = '0'; }
    textCtx = {
      lines: AFTERMATH_LINES,
      panel: '#textPanel4',
      prompt: '#prompt4',
      nextScene: 8,
      /* (甲·双层) on the unlocked replay, the aftermath forks: follow the skin, or stay */
      onEnd: storyUnlocked ? showForkB : null,
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
      nextScene: 20,   /* 支线② : 多年以后 (then returns to the skin) */
      onAdvance: function (idx) { setCubBeat(idx); },
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 15 · 支线① : SHE WAS ONCE A CUB TOO ============ */
  function enterSubline1() {
    lineIdx = 0;
    const a = $('#bg15'), b = $('#bg15b');
    a.style.backgroundImage = "url('images/warm/momo_memory.png')";
    a.style.opacity = '1';
    b.style.opacity = '0';
    textCtx = { lines: SUBLINE1_LINES, panel: '#textPanel15', prompt: '#prompt15', nextScene: 2, onAdvance: null };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 20 · 支线② : YEARS LATER (Sol grown) ============ */
  function enterSubline2() {
    lineIdx = 0;
    const a = $('#bg20'), b = $('#bg20b');
    a.style.backgroundImage = "url('images/warm/sol_grown.png')";
    a.style.opacity = '1';
    b.style.opacity = '0';
    textCtx = { lines: SUBLINE2_LINES, panel: '#textPanel20', prompt: '#prompt20', nextScene: 9, onAdvance: null };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 9: WHERE THE SKIN GOES ============ */
  let peltShownIsB = false;
  let peltCurrentBeat = '';

  function setPeltBeat(idx) {
    const file = PELT_BEATS[idx];
    if (!file || file === peltCurrentBeat) return;
    peltCurrentBeat = file;
    const a = $('#bg9'), b = $('#bg9b');
    const incoming = peltShownIsB ? a : b;
    const outgoing = peltShownIsB ? b : a;
    incoming.style.backgroundImage = "url('images/pelt/" + file + "')";
    incoming.style.opacity = '1';
    outgoing.style.opacity = '0';
    peltShownIsB = !peltShownIsB;
  }
  function setPeltLayerInstant(idx) {
    const a = $('#bg9'), b = $('#bg9b');
    peltShownIsB = false; peltCurrentBeat = PELT_BEATS[idx];
    a.style.backgroundImage = "url('images/pelt/" + PELT_BEATS[idx] + "')";
    a.style.opacity = '1'; b.style.opacity = '0';
  }

  function enterPelt() {
    lineIdx = 0;
    setPeltLayerInstant(0);
    const target = peltEndingTarget; peltEndingTarget = null;   /* 空枪 routes here, then lands its banner */
    textCtx = {
      lines: PELT_LINES,
      panel: '#textPanel9',
      prompt: '#prompt9',
      nextScene: 5,
      onAdvance: function (idx) { setPeltBeat(idx); },
      onEnd: target ? function () { recordEnding(target); showEndingActions(target, {}); } : null,
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
      nextScene: 12,
      onAdvance: null,
    };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* Guardian narration beats reuse existing backgrounds (set in CSS) */
  function enterGuardWarm() {
    lineIdx = 0;
    textCtx = { lines: GUARD_WARM_LINES, panel: '#textPanel12', prompt: '#prompt12', nextScene: 13, onAdvance: null };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }
  function enterGuardHunt() {
    lineIdx = 0;
    textCtx = { lines: GUARD_HUNT_LINES, panel: '#textPanel13', prompt: '#prompt13', nextScene: 11, onAdvance: null };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }
  function enterGuardEnd() {
    lineIdx = 0;
    recordEnding('poxiao');   /* reaching the guardian ending unlocks 破晓 + the replay choices */
    textCtx = { lines: GUARD_END_LINES, panel: '#textPanel14', prompt: '#prompt14', nextScene: 5, onAdvance: null };
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
    const elapsed = pageOpenTime ? (Date.now() - pageOpenTime) / 1000 : 0;
    el.innerHTML = t('counterTpl')
      .replace('{t}', fmtTime(elapsed))
      .replace('{n}', deathCount().toLocaleString());
  }
  function renderCounterNote() {
    const note = $('#deathCounterNote');
    if (note) note.innerHTML = t('counterNote');
    const rc = $('#revealRecall');   /* (peak-end) recall the name on the truth screen too */
    if (rc) rc.innerHTML = t('namedRecall').replace('{cub}', getCubName());
  }
  function startDeathCounter() {
    renderDeathCounter();
    renderCounterNote();
    const el = $('#deathCounter');
    if (el) el.classList.add('show');
    const note = $('#deathCounterNote');
    if (note) note.classList.add('show');
    if (deathTimer) clearInterval(deathTimer);
    deathTimer = setInterval(renderDeathCounter, 1000);
  }

  /* ============ (D) PERSISTENT 6-SECOND HEARTBEAT ============ */
  function playTick() {
    if (!audioCtx) return;
    try {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, audioCtx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.028, audioCtx.currentTime + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.14);
    } catch (_) {}
  }
  function tickHeartbeat() {
    const hb = $('#heartbeat');
    if (!hb) return;
    $('#hbNum').textContent = deathCount();
    hb.classList.remove('tick'); void hb.offsetWidth; hb.classList.add('tick');
    playTick();
  }
  function startHeartbeat() {
    const hb = $('#heartbeat');
    if (hb) { $('#hbNum').textContent = deathCount(); hb.classList.add('show'); }
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    heartbeatTimer = setInterval(tickHeartbeat, 6000);
  }

  /* ============ (C) PRE-SHOT FLASHBACK ============ */
  function showFlashback() {
    const fb = $('#flashback');
    if (!fb) return;
    fb.classList.add('show');
    setTimeout(() => fb.classList.remove('show'), 600);
  }

  /* ============ (E) RAINFOREST AMBIENCE (cut by the shot) ============ */
  function fadeAudio(el, target, ms) {
    if (!el) return;
    const steps = 12, dt = Math.max(20, ms / steps), start = el.volume, diff = target - start;
    let i = 0;
    const iv = setInterval(() => {
      i++;
      el.volume = Math.max(0, Math.min(1, start + diff * (i / steps)));
      if (i >= steps) clearInterval(iv);
    }, dt);
  }
  function startAmbient() {
    try {
      if (!ambientEl) { ambientEl = new Audio('sounds/rainforest.mp3'); ambientEl.loop = true; ambientEl.volume = 0; }
      if (ambientEl.paused) { const p = ambientEl.play(); if (p && p.catch) p.catch(() => {}); }
      fadeAudio(ambientEl, 0.26, 1400);
    } catch (_) {}
  }
  function stopAmbient() {           /* abrupt = the silence after the shot */
    if (ambientEl) { try { ambientEl.pause(); } catch (_) {} }
  }

  /* ============ (B) SHAREABLE ENDING CARD (canvas PNG) ============ */
  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }
  function drawPaw(x, cx, cy, r) {
    x.save();
    x.fillStyle = 'rgba(229,194,130,0.85)';
    x.beginPath(); x.ellipse(cx, cy + r * 0.55, r * 0.95, r * 0.75, 0, 0, Math.PI * 2); x.fill();
    [[-1.15, -0.85, 0.42], [-0.42, -1.3, 0.48], [0.42, -1.3, 0.48], [1.15, -0.85, 0.42]].forEach((t) => {
      x.beginPath(); x.ellipse(cx + t[0] * r, cy + t[1] * r, r * t[2], r * t[2] * 1.25, 0, 0, Math.PI * 2); x.fill();
    });
    x.restore();
  }
  function makeCard() {
    const W = 1200, H = 630;
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const x = c.getContext('2d');
    x.fillStyle = '#0d0e10'; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(W / 2, H * 0.4, 40, W / 2, H * 0.4, W * 0.72);
    g.addColorStop(0, 'rgba(26,36,31,0.65)'); g.addColorStop(1, 'rgba(8,9,11,1)');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(229,194,130,0.5)'; x.lineWidth = 2; x.strokeRect(28, 28, W - 56, H - 56);

    x.textAlign = 'center';
    x.fillStyle = '#f3ece0';
    x.font = '700 62px Georgia, "Songti SC", serif';
    x.fillText('EVERY 6 SECONDS', W / 2, 142);
    x.strokeStyle = 'rgba(229,194,130,0.7)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(W / 2 - 120, 176); x.lineTo(W / 2 + 120, 176); x.stroke();

    const elapsed = pageOpenTime ? (Date.now() - pageOpenTime) / 1000 : 0;
    const lines = [
      t('cardStayed').replace('{t}', fmtTime(elapsed)),
      t('cardKilled').replace('{n}', deathCount().toLocaleString()),
      t('cardNamed').replace('{cub}', getCubName()),
    ];
    x.fillStyle = '#d8d2c7'; x.font = '32px Georgia, "Songti SC", serif';
    let y = 268;
    lines.forEach((ln) => { x.fillText(ln, W / 2, y); y += 60; });

    drawPaw(x, W / 2, 478, 24);

    x.fillStyle = '#c0392b'; x.font = 'italic 26px Georgia, "Songti SC", serif';
    x.fillText(t('cardClosing'), W / 2, 552);
    x.fillStyle = '#7d766b'; x.font = '18px "Courier New", monospace';
    x.fillText('every-six-seconds.vercel.app', W / 2, H - 56);

    try {
      const a = document.createElement('a');
      a.href = c.toDataURL('image/png');
      a.download = 'every-six-seconds.png';
      a.click();
    } catch (_) {}
  }

  /* ============ SCENE 16: "THE MOMENT" — living tableau ============ */
  function setMomentTitle() {
    const el = $('#momentLine');
    if (!el) return;
    el.innerHTML =
      '<span class="ml-a">' + t('momentLine') + '</span>' +
      '<span class="ml-b">' + t('momentLine2') + '</span>';
  }

  function startMomentParticles() {
    const cv = $('#momentCanvas');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    const resize = () => { cv.width = window.innerWidth; cv.height = window.innerHeight; };
    resize();
    if (!window.__momentResize) {
      window.__momentResize = true;
      window.addEventListener('resize', () => { if (currentScene === 16) resize(); });
    }
    const N = 80, ps = [];
    for (let i = 0; i < N; i++) {
      const fire = Math.random() < 0.22;
      ps.push({
        x: Math.random() * cv.width, y: Math.random() * cv.height,
        r: fire ? (1.8 + Math.random() * 2.4) : (0.6 + Math.random() * 1.6),
        vx: (Math.random() - 0.5) * 0.3, vy: -(0.08 + Math.random() * 0.4),
        a: Math.random() * Math.PI * 2, tw: 0.4 + Math.random() * 1.6, fire: fire,
      });
    }
    if (momentRAF) cancelAnimationFrame(momentRAF);
    function frame(ts) {
      if (currentScene !== 16) { ctx.clearRect(0, 0, cv.width, cv.height); momentRAF = null; return; }
      ctx.clearRect(0, 0, cv.width, cv.height);
      const tt = ts * 0.001;
      for (const p of ps) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -12) { p.y = cv.height + 12; p.x = Math.random() * cv.width; }
        if (p.x < -12) p.x = cv.width + 12; else if (p.x > cv.width + 12) p.x = -12;
        const tw = 0.5 + 0.5 * Math.sin(tt * p.tw + p.a);
        const alpha = (p.fire ? 0.9 : 0.45) * tw;
        const rr = p.r * (p.fire ? (1 + 0.5 * tw) : 1) * 4;
        const grd = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rr);
        grd.addColorStop(0, 'rgba(255,238,185,' + alpha + ')');
        grd.addColorStop(0.4, 'rgba(229,194,130,' + (alpha * 0.5) + ')');
        grd.addColorStop(1, 'rgba(229,194,130,0)');
        ctx.fillStyle = grd;
        ctx.beginPath(); ctx.arc(p.x, p.y, rr, 0, Math.PI * 2); ctx.fill();
      }
      momentRAF = requestAnimationFrame(frame);
    }
    momentRAF = requestAnimationFrame(frame);
  }

  function enterMoment() {
    /* pure wordless image: no text, no UI (hidden via body.pure). Let it land,
       give them time to sit with it / screenshot, then a click reveals the CTA. */
    canInteract = false;
    setTimeout(() => { if (currentScene === 16) canInteract = true; }, 1400);
  }

  /* ============ SCENE 7: THE CHOICE (illusory) ============ */
  function enterChoice() {
    startAmbient();   /* (E) forest still alive during the choice */
    const sc = $('#scene-7');
    if (sc) sc.classList.remove('committed');
    const text = $('#choiceText');
    text.classList.remove('typewriter-cursor', 'narration', 'text-big');
    const forced = $('#choiceButtons');
    const real = $('#choiceButtons3');
    if (storyUnlocked) {
      /* (甲·双层) replay — the choice is finally real */
      text.textContent = t('replayHint');
      forced.classList.add('hidden');
      real.classList.remove('hidden');
      real.style.opacity = '1'; real.style.pointerEvents = '';
    } else {
      /* first time — the choice was never yours */
      text.textContent = t('choicePrompt');
      real.classList.add('hidden');
      forced.classList.remove('hidden');
      forced.style.opacity = '1'; forced.style.pointerEvents = '';
    }
    canInteract = true;
  }

  function hideChoiceButtons() {
    ['#choiceButtons', '#choiceButtons3'].forEach((s) => {
      const e = $(s); if (e) { e.style.opacity = '0'; e.style.pointerEvents = 'none'; }
    });
  }
  /* real choice · SHOOT — leads into the main line (→ aftermath → fork B) */
  function chooseShootReal() {
    if (!canInteract) return; canInteract = false;
    hideChoiceButtons();
    $('#scene-7').classList.add('committed');
    goTo(3);
  }
  /* real choice · LOWER THE GUN — you hesitate, the jaguar is faster → death「代价」*/
  function chooseLower() {
    if (!canInteract) return; canInteract = false;
    hideChoiceButtons();
    goTo(21);
  }
  /* real choice · SLIP AWAY — Empty Gun「空枪」*/
  function chooseSlip() {
    if (!canInteract) return; canInteract = false;
    hideChoiceButtons();
    goTo(22);
  }

  /* ============ FORK B (after the aftermath, unlocked replay) ============ */
  function showForkB() {
    canInteract = false;
    const p = $('#prompt4'); if (p) p.classList.add('hidden');
    const fb = $('#forkButtons');
    if (fb) { fb.classList.remove('hidden'); fb.style.opacity = '1'; fb.style.pointerEvents = ''; }
  }
  function hideForkB() {
    const fb = $('#forkButtons'); if (fb) { fb.style.opacity = '0'; fb.style.pointerEvents = 'none'; fb.classList.add('hidden'); }
  }
  function chooseFollow() { hideForkB(); goTo(8); }   /* follow the skin → 真相 = 血价 */
  function chooseStay() { hideForkB(); goTo(23); }    /* stay with the cubs → 长夜 */

  /* ============ SCENE 21 · DEATH ENDING 「代价」 ============ */
  async function enterDeath() {
    const myToken = playToken;
    canInteract = false;
    hideEndingActions();
    const ds = $('#deathScreen'); if (ds) ds.classList.remove('show');
    const dc = $('#deathChar'); if (dc) { dc.textContent = t('deathChar'); dc.style.opacity = ''; dc.style.transition = ''; }
    const dl = $('#deathLine'); if (dl) dl.textContent = '';
    const bg = $('#bg21');
    const panel = $('#textPanel21');
    if (panel) panel.textContent = '';
    if (bg) bg.classList.remove('lunge');
    try { initAudio(); } catch (_) {}

    /* ① the hunter gives himself away — the jaguar is still unaware */
    if (bg) bg.style.backgroundImage = "url('images/hunter/hidden.png')";
    await delay(500);
    if (myToken !== playToken) return;
    if (panel) await typewrite(panel, t('deathBeat1'), 48);
    await delay(1500);
    if (myToken !== playToken) return;

    /* ② she turns her head — she has seen you */
    if (panel) panel.textContent = '';
    if (bg) bg.style.backgroundImage = "url('images/hunter/alarm.png')";
    try { playCry(); } catch (_) {}
    await delay(450);
    if (myToken !== playToken) return;
    if (panel) await typewrite(panel, t('deathBeat2'), 48);
    await delay(1500);
    if (myToken !== playToken) return;

    /* ③ she explodes toward the camera — the lunge rushes in, then red flash, then black */
    if (panel) panel.textContent = '';
    if (bg) {
      bg.style.backgroundImage = "url('images/backgrounds/jaguar_lunge.png')";
      bg.classList.remove('lunge'); void bg.offsetWidth; bg.classList.add('lunge');
    }
    try { playCry(); } catch (_) {}
    await delay(1050);                            /* let the lunge land */
    if (myToken !== playToken) return;
    const flash = $('#deathFlash');
    if (flash) { flash.classList.remove('flash'); void flash.offsetWidth; flash.classList.add('flash'); }
    await delay(430);
    if (myToken !== playToken) return;

    /* ④ third-person aftermath — she stands over what the tall grass hides */
    if (bg) { bg.classList.remove('lunge'); bg.style.backgroundImage = "url('images/backgrounds/death_aftermath.png')"; }
    await delay(2300);
    if (myToken !== playToken) return;

    /* 2 seconds of black before the 死 lands */
    if (dc) dc.style.opacity = '0';
    if (ds) ds.classList.add('show');
    await delay(2000);
    if (myToken !== playToken) return;
    if (dc) { dc.style.transition = 'opacity 0.9s ease'; dc.style.opacity = '1'; }
    await delay(1500);
    if (myToken !== playToken) return;
    if (dl) dl.textContent = t('deathLine');
    await delay(1700);
    if (myToken !== playToken) return;
    recordEnding('daijia');
    showEndingActions('daijia', { rewind: true });   /* offer 回档 back to the choice */
  }

  /* ============ SCENE 22 · ENDING 「空枪」 ============ */
  /* you walked away — but the skin still gets sold; the narration flows
     straight into 那张皮(9), which then lands the 空枪/Hollow banner. */
  function enterEmptyGun() {
    lineIdx = 0;
    const bg = $('#bg22'); if (bg) bg.style.backgroundImage = "url('images/backgrounds/forest_main.png')";
    textCtx = { lines: EMPTYGUN_LINES, panel: '#textPanel22', prompt: '#prompt22', nextScene: 0,
      onEnd: function () { peltEndingTarget = 'kongqiang'; goTo(9); } };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SCENE 23 · ENDING 「长夜」 ============ */
  function enterLongNight() {
    lineIdx = 0;
    const bg = $('#bg23'); if (bg) bg.style.backgroundImage = "url('images/backgrounds/longnight.png')";
    textCtx = { lines: LONGNIGHT_LINES, panel: '#textPanel23', prompt: '#prompt23', nextScene: 0,
      onEnd: function () { recordEnding('changye'); showEndingActions('changye', {}); } };
    playLine(textCtx.panel, textCtx.prompt, textCtx.lines[0]);
  }

  /* ============ SHARED ENDING ACTIONS (unlock banner + rewind / continue / restart) ============ */
  function showEndingActions(key, opts) {
    opts = opts || {};
    canInteract = false;
    /* (peak-end) recall the cub the player named, and how it ended */
    const recall = $('#endingRecall');
    if (recall) {
      const cub = getCubName();
      const named = t('namedRecall').replace('{cub}', cub);
      const fate = (t('fate_' + key) || '').replace(/\{cub\}/g, cub);
      recall.innerHTML = named + (fate ? '<br>' + fate : '');
    }
    const u = $('#endingUnlock'); if (u) u.textContent = t('unlockTpl').replace('{name}', endName(key));
    const rw = $('#btnRewindChoice'); if (rw) rw.classList.toggle('hidden', !opts.rewind);
    const ct = $('#btnContinue');
    if (ct) {
      const hasCont = opts.continueTo != null;
      ct.classList.toggle('hidden', !hasCont);
      endingContinueTo = hasCont ? opts.continueTo : null;
    }
    const wrap = $('#endingActions'); if (wrap) wrap.classList.add('show');
  }
  function hideEndingActions() {
    const wrap = $('#endingActions'); if (wrap) wrap.classList.remove('show');
  }
  function showActScreen() { const s = $('#actScreen'); if (s) s.classList.add('show'); }
  function hideActScreen() { const s = $('#actScreen'); if (s) s.classList.remove('show'); }

  /* "Wait" still ends in the shot — the choice was never real. */
  async function chooseWait() {
    if (!canInteract) return;
    canInteract = false;
    const myToken = playToken;
    const buttons = $('#choiceButtons');
    const text = $('#choiceText');
    buttons.style.opacity = '0';
    buttons.style.pointerEvents = 'none';
    text.classList.add('narration');   /* switch to the standard bottom-letterbox ADV format */
    $('#scene-7').classList.add('committed');   /* cursor becomes a crosshair you can't shake */

    /* (D) The refusal is real — this family slips away. But the clock does
       not stop: the heartbeat counter ticks, another one falls elsewhere,
       and the rifle stays in your hands until the shot is taken anyway. */
    const lines = I18N[LANG].refuseLines;
    await delay(700);
    for (let i = 0; i < lines.length; i++) {
      if (myToken !== playToken) return;
      await typewrite(text, lines[i], 50);
      if (i === 1 || i === 4) { try { initAudio(); tickHeartbeat(); } catch (_) {} }
      await delay(i >= 3 ? 1700 : 1400);
      if (myToken !== playToken) return;
      text.textContent = '';
    }
    if (myToken !== playToken) return;
    goTo(3);
  }

  /* ============ SCENE 5: REVEAL + DATA + CTA ============ */
  async function enterReveal() {
    recordEnding('xuejia');   /* reaching the truth/data is the 血价 ending — also unlocks the replay choices */
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
    await delay(2800);
    if (myToken !== playToken) return;

    /* close on the wordless image; the CTA waits behind it (revisited on click) */
    revealComplete = true;
    ctaButtons.style.opacity = '1';   /* readied for when they return from the image */
    goTo(16);
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
    1: { lines: WARM_LINES, panel: '#textPanel1', prompt: '#prompt1', nextScene: 15, onAdvance: setWarmBeat },
    15: { lines: SUBLINE1_LINES, panel: '#textPanel15', prompt: '#prompt15', nextScene: 2, onAdvance: null },
    2: { lines: HUNTER_LINES, panel: '#textPanel2', prompt: '#prompt2', nextScene: 7, onAdvance: setHunterBeat },
    4: { lines: AFTERMATH_LINES, panel: '#textPanel4', prompt: '#prompt4', nextScene: 8, onAdvance: setAftermathFilterFor },
    8: { lines: CUB_LINES, panel: '#textPanel8', prompt: '#prompt8', nextScene: 20, onAdvance: setCubBeat },
    20: { lines: SUBLINE2_LINES, panel: '#textPanel20', prompt: '#prompt20', nextScene: 9, onAdvance: null },
    9: { lines: PELT_LINES, panel: '#textPanel9', prompt: '#prompt9', nextScene: 5, onAdvance: setPeltBeat },
    10: { lines: GUARD_LINES, panel: '#textPanel10', prompt: '#prompt10', nextScene: 12, onAdvance: null },
    12: { lines: GUARD_WARM_LINES, panel: '#textPanel12', prompt: '#prompt12', nextScene: 13, onAdvance: null },
    13: { lines: GUARD_HUNT_LINES, panel: '#textPanel13', prompt: '#prompt13', nextScene: 11, onAdvance: null },
    14: { lines: GUARD_END_LINES, panel: '#textPanel14', prompt: '#prompt14', nextScene: 5, onAdvance: null },
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
    else if (scene === 9) setPeltLayerInstant(startLine);

    textCtx = { lines: cfg.lines, panel: cfg.panel, prompt: cfg.prompt, nextScene: cfg.nextScene, onAdvance: cfg.onAdvance };

    const line = cfg.lines[startLine];
    const panel = $(cfg.panel), prompt = $(cfg.prompt);
    if (line.big) panel.classList.add('text-big'); else panel.classList.remove('text-big');
    panel.textContent = lineText(line);        /* show instantly — already read */
    prompt.classList.remove('hidden');
    canInteract = true;
  }

  /* hide any lingering ending overlay (banner / 死 screen / black) before navigating away */
  function clearEndingUI() {
    const ea = $('#endingActions'); if (ea) ea.classList.remove('show');
    const ds = $('#deathScreen'); if (ds) ds.classList.remove('show');
    const dc = $('#deathChar'); if (dc) dc.style.opacity = '';
    const bo = $('#blackout'); if (bo) bo.classList.remove('show');
    const as = $('#actScreen'); if (as) as.classList.remove('show');
    const fb = $('#forkButtons'); if (fb) { fb.classList.add('hidden'); fb.style.opacity = '0'; }
    const c3 = $('#choiceButtons3'); if (c3) c3.style.opacity = '0';
    const b21 = $('#bg21'); if (b21) b21.classList.remove('lunge');
  }

  function jumpTo(beat) {
    closeHistory();
    clearEndingUI();
    playToken++;                 /* kill any in-flight typewriter */
    isTransitioning = false;
    canInteract = false;
    floodDone = false;
    stopDrone();

    showSceneInstant(beat.scene);
    setHint(hintFor(beat.scene), beat.scene === 3);

    if ([1, 2, 4, 8, 9, 10, 12, 13, 14].indexOf(beat.scene) !== -1) {
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
    clearEndingUI();
    buildHistoryList();
    $('#historyPanel').classList.add('open');
    const list = $('#historyList');
    list.scrollTop = list.scrollHeight;   /* newest at the bottom */
  }
  function closeHistory() {
    $('#historyPanel').classList.remove('open');
  }

  /* ============ DEVELOPER SCENE-JUMP ============ */
  const DEV_SCENES = ['intro', 0, 1, 15, 2, 7, 3, 4, 8, 20, 9, 5, 6, 10, 12, 13, 11, 14, 21, 22, 23];
  function buildDevList() {
    const list = $('#devList');
    if (!list) return;
    list.innerHTML = '';
    DEV_SCENES.forEach((id) => {
      const b = document.createElement('button');
      b.className = 'dev-item';
      const name = (I18N[LANG].sceneNames[id]) || ('Scene ' + id);
      b.innerHTML = '<span class="dev-id">' + id + '</span>' + name;
      b.addEventListener('click', (e) => { e.stopPropagation(); devJump(id); });
      list.appendChild(b);
    });
  }
  function openDevPanel() { buildDevList(); $('#devPanel').classList.add('open'); }
  function closeDevPanel() { $('#devPanel').classList.remove('open'); }

  /* Jump straight to the start of any scene (resets interactive ones) */
  function devJump(scene) {
    closeDevPanel();
    closeHistory();
    clearEndingUI();
    playToken++;
    isTransitioning = false;
    canInteract = false;
    floodDone = false;
    revealComplete = false;
    stopDrone();
    showSceneInstant(scene);
    enterScene(scene);
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
    setTxt('#prompt9', t('clickContinue'));
    setTxt('#prompt15', t('clickContinue'));
    setTxt('#prompt20', t('clickContinue'));
    setTxt('#prompt12', t('clickContinue'));
    setTxt('#prompt13', t('clickContinue'));
    setTxt('#prompt14', t('clickContinue'));
    setTxt('#prompt16', t('clickContinue'));
    setTxt('#promptIntro', t('clickContinue'));
    setTxt('#cubNameLabel', t('nameLabel'));
    const ci = $('#cubNameInput'); if (ci) ci.placeholder = t('namePlaceholder');
    setTxt('#btnLearn', t('learnMore'));
    setTxt('#btnShare', t('share'));
    setTxt('#btnCard', t('saveCard'));
    setTxt('#btnRefs', t('references'));
    setTxt('#btnWait', t('waitBtn'));
    setTxt('#btnShoot', t('shootBtn'));
    setTxt('#btnShoot3', t('shootBtn'));
    setTxt('#btnLower', t('lowerBtn'));
    setTxt('#btnSlip', t('slipBtn'));
    setTxt('#btnFollow', t('followBtn'));
    setTxt('#btnStay', t('stayBtn'));
    setTxt('#btnRewindChoice', t('rewindChoiceBtn'));
    setTxt('#btnContinue', t('continueBtn'));
    setTxt('#btnRestart', t('restartBtn'));
    setTxt('#btnAct', t('actBtn'));
    setTxt('#btnAct2', t('actBtn'));
    setTxt('#btnActClose', t('actClose'));
    setTxt('#actTitle', t('actTitle'));
    ['act1', 'act2', 'act3'].forEach((id) => { const e = $('#' + id); if (e) e.innerHTML = t(id); });
    setTxt('#prompt22', t('clickContinue'));
    setTxt('#prompt23', t('clickContinue'));
    setTxt('#hbLabel', t('hbLabel'));
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
    const c9 = $('#cite9'); if (c9) c9.innerHTML = t('citeJaguar');
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

    /* the living-tableau title (with the cub's name) */
    if (currentScene === 16) setMomentTitle();

    /* keep the live counter in the current language */
    renderDeathCounter();
    renderCounterNote();
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

    /* (no sound — silent logo splash) */

    let ended = false;
    const finish = () => {
      if (ended) return;
      ended = true;
      op.classList.add('done');
      setTimeout(() => { op.style.display = 'none'; }, 2100);   /* match the 2s out-fade */
    };
    const timer = setTimeout(finish, 9500);   /* logo lands ~4.5s, holds, then fades */
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

    /* Introduction -> Scene 1 (name a cub on the way) */
    $('#scene-intro').addEventListener('click', (e) => {
      if (currentScene !== 'intro') return;
      if (e.target.closest('.btn')) return;
      if (e.target.closest('.intro-name')) return;   /* don't advance while naming */
      if (!canInteract) return;
      captureCubName();
      goTo(1);
    });
    const cubInput = $('#cubNameInput');
    if (cubInput) cubInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && currentScene === 'intro' && canInteract) {
        e.preventDefault();
        captureCubName();
        cubInput.blur();
        goTo(1);
      }
    });

    /* Scene 1: warm text — click to advance lines */
    $('#scene-1').addEventListener('click', (e) => {
      if (currentScene !== 1) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 16: wordless closing image — click to reveal the closing actions */
    $('#scene-16').addEventListener('click', () => {
      if (currentScene !== 16) return;
      if (!canInteract) return;
      goTo(5);
    });

    /* Scene 2: hunter text — click to advance lines */
    $('#scene-2').addEventListener('click', (e) => {
      if (currentScene !== 2) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 15 · 支线① : flashback — click to advance lines */
    $('#scene-15').addEventListener('click', (e) => {
      if (currentScene !== 15) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 20 · 支线② : years later — click to advance lines */
    $('#scene-20').addEventListener('click', (e) => {
      if (currentScene !== 20) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 7: the illusory choice */
    const btnWait = $('#btnWait');
    if (btnWait) btnWait.addEventListener('click', (e) => { e.stopPropagation(); chooseWait(); });
    const btnShoot = $('#btnShoot');
    if (btnShoot) btnShoot.addEventListener('click', (e) => { e.stopPropagation(); if (canInteract) { canInteract = false; goTo(3); } });

    /* (甲·双层) unlocked real choices + fork B + ending actions */
    const btnShoot3 = $('#btnShoot3');
    if (btnShoot3) btnShoot3.addEventListener('click', (e) => { e.stopPropagation(); chooseShootReal(); });
    const btnLower = $('#btnLower');
    if (btnLower) btnLower.addEventListener('click', (e) => { e.stopPropagation(); chooseLower(); });
    const btnSlip = $('#btnSlip');
    if (btnSlip) btnSlip.addEventListener('click', (e) => { e.stopPropagation(); chooseSlip(); });
    const btnFollow = $('#btnFollow');
    if (btnFollow) btnFollow.addEventListener('click', (e) => { e.stopPropagation(); chooseFollow(); });
    const btnStay = $('#btnStay');
    if (btnStay) btnStay.addEventListener('click', (e) => { e.stopPropagation(); chooseStay(); });
    const btnRewindChoice = $('#btnRewindChoice');
    if (btnRewindChoice) btnRewindChoice.addEventListener('click', (e) => {
      e.stopPropagation();
      hideEndingActions();
      const ds = $('#deathScreen'); if (ds) ds.classList.remove('show');
      goTo(7);
    });
    const btnContinue = $('#btnContinue');
    if (btnContinue) btnContinue.addEventListener('click', (e) => {
      e.stopPropagation();
      const to = endingContinueTo;
      hideEndingActions();
      if (to != null) goTo(to);
    });
    const btnRestart = $('#btnRestart');
    if (btnRestart) btnRestart.addEventListener('click', (e) => { e.stopPropagation(); location.reload(); });
    const btnAct = $('#btnAct');
    if (btnAct) btnAct.addEventListener('click', (e) => { e.stopPropagation(); showActScreen(); });
    const btnAct2 = $('#btnAct2');
    if (btnAct2) btnAct2.addEventListener('click', (e) => { e.stopPropagation(); showActScreen(); });
    const btnActClose = $('#btnActClose');
    if (btnActClose) btnActClose.addEventListener('click', (e) => { e.stopPropagation(); hideActScreen(); });
    const actScreen = $('#actScreen');
    if (actScreen) actScreen.addEventListener('click', (e) => { if (e.target.id === 'actScreen') hideActScreen(); });

    /* Scene 22 / 23 endings — click to advance narration */
    $('#scene-22').addEventListener('click', (e) => {
      if (currentScene !== 22) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });
    $('#scene-23').addEventListener('click', (e) => {
      if (currentScene !== 23) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 3: kill shots */
    $('#scene-3').addEventListener('click', (e) => {
      if (currentScene !== 3) return;
      if (floodDone) { advanceFromFlood(); return; }   /* tap/click to move on (mobile-friendly) */
      handleKill(e);
    });

    /* Scene 3: aiming — mouse + touch (mobile) */
    $('#scene-3').addEventListener('mousemove', handleMouseMove);
    $('#scene-3').addEventListener('touchstart', (e) => { if (e.touches[0]) handleMouseMove(e.touches[0]); }, { passive: true });
    $('#scene-3').addEventListener('touchmove', (e) => { if (e.touches[0]) handleMouseMove(e.touches[0]); }, { passive: true });

    /* Scene 4: aftermath text — click to advance lines */
    $('#scene-4').addEventListener('click', (e) => {
      if (currentScene !== 4) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 8: cubs left behind — click to advance lines */
    $('#scene-8').addEventListener('click', (e) => {
      if (currentScene !== 8) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Scene 9: where the skin goes — click to advance lines */
    $('#scene-9').addEventListener('click', (e) => {
      if (currentScene !== 9) return;
      if (e.target.closest('.btn')) return;
      advanceText();
    });

    /* Enter or Space — advance from blood flood to aftermath */
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ' || e.code === 'Space') && currentScene === 3 && floodDone) {
        e.preventDefault();
        advanceFromFlood();
      }
    });

    /* References buttons */
    const refsBtn = $('#btnRefs');
    if (refsBtn) refsBtn.addEventListener('click', () => goTo(6));
    const backRefsBtn = $('#btnBackFromRefs');
    if (backRefsBtn) backRefsBtn.addEventListener('click', () => goTo(5));

    /* (B) shareable ending card */
    const cardBtn = $('#btnCard');
    if (cardBtn) cardBtn.addEventListener('click', (e) => { e.stopPropagation(); makeCard(); });

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
    $('#scene-11').addEventListener('touchstart', (e) => { if (e.touches[0]) handleGuardMove(e.touches[0]); }, { passive: true });
    $('#scene-11').addEventListener('touchmove', (e) => { if (e.touches[0]) handleGuardMove(e.touches[0]); }, { passive: true });
    const guardReturn = $('#btnGuardReturn');
    if (guardReturn) guardReturn.addEventListener('click', (e) => { e.stopPropagation(); goTo(14); });
    [12, 13, 14].forEach((n) => {
      $('#scene-' + n).addEventListener('click', (e) => {
        if (currentScene !== n) return;
        if (e.target.closest('.btn')) return;
        advanceText();
      });
    });

    /* Share button */
    const shareBtn = $('#btnShare');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const msg = t('shareMsg').replace('{cub}', getCubName());
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

    /* Developer scene-jump: toggle with ` , close with Esc */
    document.addEventListener('keydown', (e) => {
      if (e.key === '`' || e.code === 'Backquote' || e.key === '·') {
        e.preventDefault();
        const p = $('#devPanel');
        if (p.classList.contains('open')) closeDevPanel(); else openDevPanel();
      } else if (e.key === 'Escape') {
        closeDevPanel();
      }
    });
    const devPanel = $('#devPanel');
    if (devPanel) devPanel.addEventListener('click', (e) => { if (e.target.id === 'devPanel') closeDevPanel(); });

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

    /* (D) the every-6-seconds heartbeat runs for the whole experience */
    startHeartbeat();

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
