/* Jiu-Jitsu Name Atlas — local study app */
(function () {
  "use strict";

  const DATA = window.ATLAS_DATA;
  if (!DATA) {
    document.body.innerHTML = "<p style='padding:40px;color:#fff'>Falta el archivo de datos. Ejecuta make_data.py primero.</p>";
    return;
  }

  const TECH = DATA.techniques;
  const CATS = Object.fromEntries(DATA.categories.map((c) => [c.id, c]));
  const GLOSSARY = DATA.glossary;
  const TECH_BY_ID = Object.fromEntries(TECH.map((t) => [t.id, t]));
  const I18N = window.ATLAS_I18N || { en: {}, es: {} };
  const GRADES = DATA.grades || [];
  const LANGS = DATA.meta.languages || ["en", "es"];

  const STORAGE = {
    known: "jj_atlas_known",
    best: "jj_atlas_best",
    flashMode: "jj_atlas_flash_mode",
    speedDir: "jj_atlas_speed_dir",
    speedMode: "jj_atlas_speed_mode",
    rounds: "jj_atlas_rounds",
    roundsPicks: "jj_atlas_rounds_picks",
    deck: "jj_atlas_deck",
    glossaryMode: "jj_atlas_glossary_mode",
    lang: "jj_atlas_lang",
    grade: "jj_atlas_grade",
    theme: "jj_atlas_theme",
  };

  const THEME_CHOICES = ["auto", "light", "dark"];

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function readRaw(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      /* private mode or file:// restrictions: keep the session in memory */
    }
  }

  function queryParam(name) {
    try {
      return new URLSearchParams(location.search).get(name);
    } catch (_) {
      return null;
    }
  }

  function initialLang() {
    const fromUrl = queryParam("lang");
    if (LANGS.includes(fromUrl)) return fromUrl;
    const stored = readRaw(STORAGE.lang);
    if (LANGS.includes(stored)) return stored;
    // Spanish (Spain) is the default; English stays available in the toggle.
    return "es";
  }

  function initialTheme() {
    const fromUrl = queryParam("theme");
    if (THEME_CHOICES.includes(fromUrl)) return fromUrl;
    const stored = readRaw(STORAGE.theme);
    if (THEME_CHOICES.includes(stored)) return stored;
    // Follow the OS until the reader chooses otherwise.
    return "auto";
  }

  function resolvedTheme(choice) {
    if (choice === "light" || choice === "dark") return choice;
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    } catch (_) {
      return "light";
    }
  }

  function updateThemeLabel() {
    const button = $("#theme-toggle");
    if (button) {
      const label = t("theme." + state.theme);
      button.setAttribute("data-theme-choice", state.theme);
      button.setAttribute("title", t("theme.title", { label }));
      button.setAttribute("aria-label", t("theme.aria", { label }));
      const text = button.querySelector("[data-theme-label]");
      if (text) text.textContent = label;
    }
    // The settings sheet offers the three choices explicitly.
    $$("#theme-seg button").forEach((btn) => {
      const active = btn.getAttribute("data-theme-choice") === state.theme;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
  }

  function applyTheme(choice, persist = true) {
    state.theme = THEME_CHOICES.includes(choice) ? choice : "auto";
    const resolved = resolvedTheme(state.theme);
    const root = document.documentElement;
    root.setAttribute("data-theme", resolved);
    root.setAttribute("data-theme-choice", state.theme);
    root.style.colorScheme = resolved;
    if (persist) writeRaw(STORAGE.theme, state.theme);
    updateThemeLabel();
  }

  const state = {
    view: "today",
    lang: initialLang(),
    theme: initialTheme(),
    filterCategory: "all",
    grade: ["all", ...(DATA.grades || []).map((g) => g.id)].includes(queryParam("grade"))
      ? queryParam("grade")
      : readRaw(STORAGE.grade) || "all",
    search: "",
    onlyUnknown: false,
    known: readJSON(STORAGE.known, {}),
    flashMode: readRaw(STORAGE.flashMode) || "name",
    deck: readRaw(STORAGE.deck) === "glossary" ? "glossary" : "techniques",
    glossaryMode: readRaw(STORAGE.glossaryMode) === "guide" ? "guide" : "words",
    flashIndex: 0,
    flashFlipped: false,
    flashOrder: TECH.map((t) => t.id),
    modalId: null,
    modalFrame: 0,
    glossaryGroup: "all",
    glossarySearch: "",
    videoRate: 1,
    speed: {
      running: false,
      score: 0,
      total: 0,
      best: Number(readRaw(STORAGE.best) || 0),
      time: 60,
      timerId: null,
      transitionId: null,
      question: null,
      answered: false,
      missed: [],
      options: [],
      picked: null,
      finished: false,
      newBest: false,
      dir: readRaw(STORAGE.speedDir) === "picture" ? "picture" : "name",
    },
    speedMode: readRaw(STORAGE.speedMode) === "rounds" ? "rounds" : "quick",
    rounds: {
      running: false,
      phase: "idle",
      round: 0,
      rounds: 8,
      work: 60,
      rest: 15,
      pairs: false,
      reps: 0,
      totalReps: 0,
      secondsLeft: 0,
      timerId: null,
      queue: [],
      picks: null,
      prepCue: "start",
    },
  };

  /* ---------------- helpers ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function saveKnown() {
    writeRaw(STORAGE.known, JSON.stringify(state.known));
  }

  function isKnown(id) {
    return Boolean(state.known[id]);
  }

  function setKnown(id, value) {
    if (value) state.known[id] = true;
    else delete state.known[id];
    saveKnown();
  }

  function categoryOf(tech) {
    return CATS[tech.category] || DATA.categories[0];
  }

  /* YouTube will not play without a referrer, and a page opened from disk
     sends none, so there the button stays an ordinary link instead of handing
     the reader a player that can only fail. */
  const EMBED_OK = location.protocol === "http:" || location.protocol === "https:";

  function videoIdFrom(url) {
    const match = String(url || "").match(/(?:v=|youtu\.be\/|embed\/)([A-Za-z0-9_-]{6,})/);
    return match ? match[1] : null;
  }

  function sourceUrl(tech) {
    const source = tech.source;
    if (!source || !source.url) return "#";
    if (!source.start) return source.url;
    return `${source.url}${source.url.includes("?") ? "&" : "?"}t=${source.start}s`;
  }

  function heroFrame(tech) {
    if (!tech.frames || !tech.frames.length) return null;
    return tech.frames[tech.hero - 1] || tech.frames[0];
  }

  /* ---------------- language ---------------- */

  function t(key, vars) {
    const table = I18N[state.lang] || I18N.en || {};
    let str = table[key] || (I18N.en && I18N.en[key]) || key;
    if (vars) {
      Object.keys(vars).forEach((name) => {
        str = str.replace(new RegExp("\\{" + name + "\\}", "g"), vars[name]);
      });
    }
    return str;
  }

  function pick(obj, field) {
    if (state.lang === "es" && obj[field + "_es"]) return obj[field + "_es"];
    return obj[field];
  }

  function pickArray(obj, field) {
    if (state.lang === "es" && Array.isArray(obj[field + "_es"])) return obj[field + "_es"];
    return obj[field] || [];
  }

  function applyI18n() {
    document.documentElement.lang = state.lang;
    $$("[data-i18n]").forEach((el) => {
      const value = t(el.getAttribute("data-i18n"));
      if (value) el.textContent = value;
    });
    $$("[data-i18n-placeholder]").forEach((el) => {
      const value = t(el.getAttribute("data-i18n-placeholder"));
      if (value) el.setAttribute("placeholder", value);
    });
    $$("[data-i18n-aria]").forEach((el) => {
      const value = t(el.getAttribute("data-i18n-aria"));
      if (value) el.setAttribute("aria-label", value);
    });
    $$("[data-i18n-alt]").forEach((el) => {
      const value = t(el.getAttribute("data-i18n-alt"));
      if (value) el.setAttribute("alt", value);
    });
    document.title = t("app.docTitle");
    const meta = document.querySelector('meta[name="description"]');
    if (meta) meta.setAttribute("content", t("app.description"));
    const tagline = $("#tagline");
    if (tagline) {
      const gradeText = state.grade === "all" ? t("grade.all") : t("grade." + state.grade);
      tagline.textContent = t("tagline", { n: activeTech().length, grade: gradeText });
    }
    const footer = $("#footer-meta");
    if (footer) footer.textContent = t("footer.meta", { n: TECH.length, g: GLOSSARY.length });
    $$("[data-lang]").forEach((btn) => {
      const active = btn.getAttribute("data-lang") === state.lang;
      btn.classList.toggle("active", active);
      btn.setAttribute("aria-pressed", String(active));
    });
    syncScopeChip();
    syncFiltersBadge();
    updateThemeLabel();
  }

  function setLang(lang) {
    if (!LANGS.includes(lang)) return;
    state.lang = lang;
    writeRaw(STORAGE.lang, lang);
    applyI18n();
    renderBeltBar();
    renderCategoryChips();
    renderBrowse();
    renderFlash();
    renderGlossaryChips();
    renderGlossary();
    renderGlossaryCategories();
    renderNameGrammar();
    renderKyuGuide();
    renderToday();
    renderSpeedDir();
    renderSpeedMode();
    updateSpeedStats();
    if (state.speed.finished) renderSpeedEnd();
    else if (state.speed.question && state.speed.running) renderSpeedQuestion();
    if (state.modalId) openModal(state.modalId, { updateHash: false, frame: state.modalFrame, keepFocus: true });
  }

  function setGrade(grade) {
    state.grade = grade;
    writeRaw(STORAGE.grade, grade);
    rebuildFlashOrder();
    if (state.speed.running) stopSpeedToStart();
    renderBeltBar();
    renderCategoryChips();
    renderBrowse();
    renderFlash();
    renderGlossaryCategories();
    renderKyuGuide();
    renderToday();
    renderSpeedDir();
    applyI18n();
    updateSpeedStats();
    if (state.view === "browse") window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* Japanese TTS reads Latin script one letter at a time, and kanji has
     several readings (前 can be "mae" or "zen"). Hiragana has exactly one
     reading, so every name is converted to hiragana before speaking. */
  const HIRAGANA = {
    age: "あげ",
    ashi: "あし",
    ashibo: "あしぼ",
    atemi: "あてみ",
    ayumi: "あゆみ",
    barai: "ばらい",
    bo: "ぼう",
    choku: "ちょく",
    dachi: "だち",
    dan: "だん",
    de: "で",
    dojo: "どうじょう",
    empi: "えんぴ",
    eri: "えり",
    fusegi: "ふせぎ",
    gaeshi: "がえし",
    gake: "がけ",
    garami: "がらみ",
    gari: "がり",
    gatame: "がため",
    gedan: "げだん",
    geri: "げり",
    goshi: "ごし",
    guruma: "ぐるま",
    gyaku: "ぎゃく",
    ha: "は",
    hadaka: "はだか",
    haito: "はいと",
    hara: "はら",
    harai: "はらい",
    heiko: "へいこう",
    hiza: "ひざ",
    hon: "ほん",
    ichi: "いち",
    ikkyo: "いっきょう",
    irimi: "いりみ",
    jigo: "じご",
    jigotai: "じごたい",
    jime: "じめ",
    jitsu: "じつ",
    juji: "じゅうじ",
    jutsu: "じゅつ",
    jodan: "じょうだん",
    jyodan: "じょうだん",
    kagi: "かぎ",
    kakato: "かかと",
    kake: "かけ",
    kami: "かみ",
    kannuki: "かんぬき",
    kansetsu: "かんせつ",
    kata: "かた",
    katame: "かため",
    ken: "けん",
    kesa: "けさ",
    kihon: "きほん",
    kiri: "きり",
    ko: "こ",
    kokutsu: "こくつ",
    komi: "こみ",
    koshi: "こし",
    kote: "こて",
    kubi: "くび",
    kumikata: "くみかた",
    kuzure: "くずれ",
    kuzushi: "くずし",
    kyo: "きょう",
    kyu: "きゅう",
    mae: "まえ",
    mata: "また",
    mawari: "まわり",
    mawashi: "まわし",
    mikazuki: "みかづき",
    morote: "もろて",
    nagashi: "ながし",
    nage: "なげ",
    nami: "なみ",
    ne: "ね",
    neko: "ねこ",
    ni: "に",
    nikyo: "にきょう",
    no: "の",
    o: "お",
    oi: "おい",
    okuri: "おくり",
    omote: "おもて",
    osae: "おさえ",
    otoshi: "おとし",
    rei: "れい",
    ritsu: "りつ",
    sabaki: "さばき",
    san: "さん",
    sankyo: "さんきょう",
    seiza: "せいざ",
    seme: "せめ",
    sensei: "せんせい",
    seoi: "せおい",
    shiho: "しほう",
    shiko: "しこ",
    shime: "しめ",
    shintai: "しんたい",
    shisei: "しせい",
    shizen: "しぜん",
    shizentai: "しぜんたい",
    shuto: "しゅと",
    soto: "そと",
    sukui: "すくい",
    tai: "たい",
    tate: "たて",
    teisho: "ていしょ",
    tetsu: "てつ",
    tetsui: "てつい",
    tori: "とり",
    tsugi: "つぎ",
    tsuki: "つき",
    tsukuri: "つくり",
    tsuri: "つり",
    uchi: "うち",
    ude: "うで",
    uke: "うけ",
    ukemi: "うけみ",
    uki: "うき",
    ura: "うら",
    uraken: "うらけん",
    ushiro: "うしろ",
    waki: "わき",
    waza: "わざ",
    yoko: "よこ",
    za: "ざ",
    zenkutsu: "ぜんくつ",
  };

  function japaneseText(text) {
    const raw = String(text || "").trim();
    if (!raw) return raw;
    /* Glossary variants such as "Goshi / Koshi" speak the first form. */
    const first = raw.split("/")[0].trim();
    const direct = HIRAGANA[first.toLowerCase()];
    if (direct) return direct;
    const words = first.split(/\s+/).filter(Boolean);
    const mapped = words.map((word) => HIRAGANA[word.toLowerCase()]);
    if (mapped.length && mapped.every(Boolean)) return mapped.join("");
    return first;
  }

  /* The reading, written under the kanji: how the word is actually said. It is
     the same romaji map the speech uses, so the two can never disagree. Empty
     when the word has no kana mapping. */
  function kanaFor(text) {
    const raw = String(text || "").trim();
    const kana = japaneseText(raw);
    return kana && kana !== raw ? kana : "";
  }

  let voiceCache = [];
  let warnedNoJapanese = false;
  let speechUnlocked = false;

  function refreshVoices() {
    if (!("speechSynthesis" in window)) return voiceCache;
    voiceCache = window.speechSynthesis.getVoices() || [];
    return voiceCache;
  }

  function hasJapaneseVoice() {
    const voices = voiceCache.length ? voiceCache : refreshVoices();
    return voices.some((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ja"));
  }

  /* iOS/Android keep getVoices() empty and refuse speech until a real user
     gesture has happened. A silent utterance on the first gesture unlocks the
     synth and nudges the browser into loading its voice list. */
  function primeSpeech() {
    if (!("speechSynthesis" in window) || speechUnlocked) return;
    speechUnlocked = true;
    refreshVoices();
    const synth = window.speechSynthesis;
    const primer = new SpeechSynthesisUtterance(" ");
    primer.volume = 0;
    primer.lang = "ja-JP";
    primer.rate = 10;
    try {
      synth.speak(primer);
    } catch (_) {
      /* priming is best-effort */
    }
  }

  function initVoices() {
    if (!("speechSynthesis" in window)) return;
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    const unlock = () => primeSpeech();
    window.addEventListener("pointerdown", unlock, { once: true, passive: true });
    window.addEventListener("touchstart", unlock, { once: true, passive: true });
    window.addEventListener("click", unlock, { once: true });
  }

  const PREFERRED_JA = [
    "kyoko", "otoya", "haruka", "o-ren", "google 日本語", "google japanese",
    "microsoft haruka", "microsoft ayumi", "microsoft ichiro", "microsoft nanami",
  ];
  const NOVELTY_JA = [
    "eddy", "flo", "grandma", "grandpa", "reed", "rocko", "sandy", "shelley",
    "albert", "bad news", "bahh", "bells", "boing", "bubbles", "cellos",
    "good news", "jester", "organ", "superstar", "trinoids", "whisper",
    "wobble", "zarvox",
  ];

  function voiceScore(voice) {
    const name = (voice.name || "").toLowerCase();
    const lang = (voice.lang || "").toLowerCase();
    if (!lang.startsWith("ja")) return -1;
    let score = 0;
    if (lang === "ja-jp") score += 10;
    if (PREFERRED_JA.some((word) => name.includes(word))) score += 100;
    if (NOVELTY_JA.some((word) => name.includes(word))) score -= 50;
    if (voice.localService) score += 2;
    return score;
  }

  function japaneseVoice() {
    const voices = voiceCache.length ? voiceCache : refreshVoices();
    const japanese = voices.filter((voice) => voice.lang && voice.lang.toLowerCase().startsWith("ja"));
    if (!japanese.length) return null;
    return japanese.sort((a, b) => voiceScore(b) - voiceScore(a))[0];
  }

  function maybeWarnNoJapanese() {
    if (warnedNoJapanese) return;
    if (!refreshVoices().length) return;
    if (hasJapaneseVoice()) return;
    warnedNoJapanese = true;
    alert(t("noJapaneseVoice"));
  }

  function speak(text) {
    if (!("speechSynthesis" in window)) {
      alert(t("noAudio"));
      return null;
    }
    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(japaneseText(text));
    utterance.lang = "ja-JP";
    utterance.rate = 0.85;
    const voice = japaneseVoice();
    if (voice) utterance.voice = voice;

    /* Speak synchronously so the tap's user activation is preserved. Deferring
       behind voiceschanged/setTimeout dropped the first tap on iOS/Android,
       where speech must start inside the gesture. */
    synth.cancel();
    try {
      synth.resume();
    } catch (_) {
      /* resume is a no-op on desktop browsers */
    }
    synth.speak(utterance);

    if (voice) {
      maybeWarnNoJapanese();
    } else {
      /* Voices often only load right after the first speak; warn once known. */
      let done = false;
      const check = () => {
        if (done) return;
        done = true;
        synth.removeEventListener("voiceschanged", check);
        refreshVoices();
        maybeWarnNoJapanese();
      };
      if (refreshVoices().length) check();
      else {
        synth.addEventListener("voiceschanged", check);
        setTimeout(check, 800);
      }
    }
    return utterance;
  }

  function speakButton(text, extraClass = "") {
    return `<button type="button" class="speak-btn ${extraClass}" data-speak="${escapeHtml(text)}" aria-label="${escapeHtml(t("speak"))}" title="${escapeHtml(t("speak"))}">🔊</button>`;
  }

  /* Break "mae (front) + tsuki (thrust)" into word chips. */
  const PHASE_ES = {
    "Approach": "Acercamiento",
    "Balance": "Equilibrio",
    "Completion": "Finalización",
    "Entangle": "Entrelazado",
    "Final throw": "Proyección final",
    "Hips In": "Caderas dentro",
    "Landing": "Aterrizaje",
    "Lift": "Elevación",
    "Lock applied": "Luxación aplicada",
    "Reap": "Siega",
    "Scoop": "Cuchara",
    "Swing": "Arco",
    "Throw 1": "Proyección 1",
    "Throw 2": "Proyección 2",
    "Throw 3": "Proyección 3",
    "Throw 4": "Proyección 4",
    "Throw 5": "Proyección 5",
    "Bend": "Flexión",
    "Block": "Bloqueo",
    "Bow": "Saludo",
    "Chamber": "Recogida",
    "Control": "Control",
    "Crouch": "Agacharse",
    "Defensive stance": "Postura defensiva",
    "Drive": "Impulso",
    "Drop": "Caída",
    "Entry": "Entrada",
    "Face off": "Cara a cara",
    "Feet together": "Pies juntos",
    "Finish": "Final",
    "First thrust": "Primera estocada",
    "Follow": "Seguimiento",
    "Front stance": "Postura adelantada",
    "Grip": "Agarre",
    "Guard": "Guardia",
    "Hold": "Control",
    "Impact": "Impacto",
    "Kick": "Patada",
    "Kneel": "Arrodillarse",
    "Land": "Aterrizaje",
    "Lapel grip": "Agarre de solapa",
    "Lock": "Luxación",
    "Natural stance": "Postura natural",
    "Pin": "Inmovilización",
    "Pivot": "Pivote",
    "Recover": "Recuperación",
    "Roll": "Rodar",
    "Roll back": "Rodar atrás",
    "Second thrust": "Segunda estocada",
    "Seiza": "Seiza",
    "Sequence": "Secuencia",
    "Settle": "Asentarse",
    "Shiko dachi": "Shiko dachi",
    "Sink": "Hundirse",
    "Sit back": "Sentarse atrás",
    "Sleeve + lapel": "Manga + solapa",
    "Slide": "Deslizar",
    "Stand": "De pie",
    "Stand straight": "De pie recto",
    "Start": "Inicio",
    "Step": "Paso",
    "Step in": "Entrar",
    "Sweep": "Barrido",
    "Throw": "Proyección",
    "Thrown": "Proyectado",
    "Turn": "Giro",
    "Turn through": "Giro completo",
    "Turn to front": "Girar al frente",
    "Uke down": "Uke en el suelo",
    "Upright": "Erguido",
    "Walk": "Caminar",
    "Widen": "Abrir",
    "Wind up": "Preparación",
    "First": "Primera",
    "Second": "Segunda",
    "Third": "Tercera",
    "Fourth": "Cuarta",
    "Move": "Movimiento",
    "Retract": "Recogida",
    "Return": "Vuelta",
    "Set": "Colocación",
    "Squeeze": "Apriete",
    "Stance": "Postura",
    "Strike": "Golpe",
    "chamber": "recogida",
    "choke": "estrangulación",
    "collar grip": "agarre de solapa",
    "completion": "finalización",
    "control": "control",
    "crescent kick": "patada en medialuna",
    "cross grip": "agarre cruzado",
    "entangle": "enganche",
    "final throw": "proyección final",
    "finish": "final",
    "first throw": "primera proyección",
    "follow through": "seguimiento",
    "grip": "agarre",
    "grip arm": "brazo de agarre",
    "guard": "guardia",
    "hammer strike": "golpe de martillo",
    "hook punch": "puñetazo en gancho",
    "later throw": "proyección posterior",
    "lift": "elevación",
    "lock applied": "luxación aplicada",
    "mount": "montada",
    "position": "posición",
    "pull and lift": "tirar y elevar",
    "raise fist": "alzar el puño",
    "reaping leg": "pierna de barrido",
    "recovery": "recuperación",
    "return": "vuelta",
    "reverse grip": "agarre inverso",
    "salute": "saludo",
    "scoop lift": "elevación de cuchara",
    "second throw": "segunda proyección",
    "stance": "postura",
    "sweeping leg": "pierna de barrido",
    "third throw": "tercera proyección",
    "throw": "proyección",
    "two-handed block": "bloqueo a dos manos"
  };

  function phaseLabel(frame) {
    if (state.lang === "es" && PHASE_ES[frame.phase]) return PHASE_ES[frame.phase];
    return frame.phase;
  }

  /* One sound, several words: the breakdown's meaning says which kanji belongs
     under a name part, so "kata (single)" is not shown as the kata of "form". */
  function kanjiFor(word, hint) {
    if (word.toLowerCase() === "kata") {
      const h = (hint || "").toLowerCase();
      if (/single|one side|\bun\b|\buno\b|lado/.test(h)) return "\u7247";
      if (/shoulder|hombro/.test(h)) return "\u80a9";
    }
    return "";
  }

  function wordParts(tech) {
    return String(pick(tech, "literal") || "")
      .split("+")
      .map((part) => {
        const match = part.trim().match(/^(.+?)\s*\((.+)\)$/);
        if (!match) return { word: part.trim(), meaning: "" };
        return { word: match[1].trim(), meaning: match[2].trim() };
      })
      .filter((part) => part.word);
  }

  function glossaryForWord(word) {
    const key = word.toLowerCase();
    const exact = GLOSSARY.filter((item) => item.term.toLowerCase() === key);
    if (exact.length) return exact.find((i) => i.group === "name-parts") || exact[0];
    // Headwords like "Goshi / Koshi" or "Nage Waza" answer for each of their words.
    const loose = GLOSSARY.filter((item) =>
      item.term.toLowerCase().split(/[/\s]+/).filter(Boolean).includes(key));
    return loose.find((i) => i.group === "name-parts") || loose[0] || null;
  }

  /* term -> the techniques whose names contain it. Derived from the same
     resolution the word chips use, so the two views can never disagree. */
  const TERM_TO_TECHS = (() => {
    const map = new Map();
    TECH.forEach((tech) => {
      wordParts(tech).forEach((part) => {
        const term = glossaryForWord(part.word);
        if (!term) return;
        const key = term.term.toLowerCase();
        if (!map.has(key)) map.set(key, []);
        const list = map.get(key);
        if (!list.includes(tech.id)) list.push(tech.id);
      });
    });
    return map;
  })();

  function techniquesForTerm(term) {
    return TERM_TO_TECHS.get(term.trim().toLowerCase()) || [];
  }

  /* The name breakdown as runnable text. On a browse card these are pointer
     only on purpose: making 300 words focusable would wreck keyboard order,
     and the card's own chips are one tap away. */
  function literalLinks(tech) {
    return wordParts(tech)
      .map((part) => {
        const term = glossaryForWord(part.word);
        const word = term
          ? `<span class="word-link" data-gloss="${escapeHtml(term.term)}">${escapeHtml(part.word)}</span>`
          : `<b>${escapeHtml(part.word)}</b>`;
        return part.meaning ? `${word} (${escapeHtml(part.meaning)})` : word;
      })
      .join(" + ");
  }

  function wordChips(tech, options = {}) {
    const parts = wordParts(tech);
    if (!parts.length) return "";
    const chips = parts
      .map((part) => {
        const term = glossaryForWord(part.word);
        const meaning = part.meaning || (term && pick(term, "meaning")) || "";
        const reading = kanjiFor(part.word, part.meaning) || (term && term.reading ? term.reading : "");
        const title = term && pick(term, "note") ? pick(term, "note") : "";
        const kana = kanaFor(part.word);
        // The word itself opens its glossary entry; the speaker stays a
        // separate button, since nesting one button inside another is invalid.
        const wordMark = term
          ? `<b class="word-link" role="button" tabindex="0" data-gloss="${escapeHtml(term.term)}" title="${escapeHtml(t("glossary.open"))}">${escapeHtml(part.word)}</b>`
          : `<b>${escapeHtml(part.word)}</b>`;
        return `<span class="word-chip" title="${escapeHtml(title)}">${wordMark}${
          reading ? `<span class="word-kanji">${escapeHtml(reading)}</span>` : ""
        }${kana ? `<span class="kana">${escapeHtml(kana)}</span>` : ""}<span class="word-meaning">${escapeHtml(meaning)}</span>${speakButton(part.word, "chip-speak")}</span>`;
      })
      .join("");
    return `<div class="word-chips ${options.className || ""}" aria-label="${escapeHtml(t("modal.wordParts"))}">${chips}</div>`;
  }

  function frameCells(tech, labels = true, limit = 6) {
    return tech.frames
      .slice(0, limit)
      .map(
        (frame) => `
        <div class="strip-cell">
          <img src="${frame.src}" alt="${escapeHtml(tech.japanese)} — ${escapeHtml(phaseLabel(frame))}" loading="lazy">
          ${labels ? `<span class="phase">${escapeHtml(phaseLabel(frame))}</span>` : ""}
        </div>`
      )
      .join("");
  }

  function stripClass(count) {
    return `strip-${Math.min(Math.max(count, 3), 6)}`;
  }

  /* One frame at a time, snapped, with tappable dots. A phone cannot read a
     filmstrip squeezed across the card, and the frames are the whole point of
     the answer, so on the card they get a stage rather than a sliver. */
  function flashGallery(tech) {
    if (!tech.frames || !tech.frames.length) return "";
    const slides = tech.frames
      .map(
        (frame, index) => `
        <figure class="flash-slide">
          <img src="${frame.src}" alt="${escapeHtml(tech.japanese)} — ${escapeHtml(phaseLabel(frame))}" loading="${index === 0 ? "eager" : "lazy"}">
          <figcaption class="flash-slide-label">${escapeHtml(phaseLabel(frame))}</figcaption>
        </figure>`
      )
      .join("");
    const dots = tech.frames.length > 1
      ? `<div class="flash-dots">${tech.frames
          .map(
            (frame, index) =>
              `<button type="button" class="flash-dot${index === 0 ? " active" : ""}" data-dot="${index}" aria-label="${escapeHtml(phaseLabel(frame))}"></button>`
          )
          .join("")}</div>`
      : "";
    return `
      <div class="flash-gallery" data-gallery>
        <div class="flash-track">${slides}</div>
        ${dots}
      </div>`;
  }

  function toggleKnownMark() {
    const key = currentKey();
    if (!key) return;
    setKnown(key, !isKnown(key));
    renderBrowse();
    renderFlash();
    renderToday();
  }

  /* Marks a card as known without moving on. It sits on the card because it is
     a statement about the card, not a step in the flow. */
  function markToggle(key) {
    const known = isKnown(key);
    return `
      <div class="flash-mark-row">
        <button type="button" class="flash-mark ${known ? "is-known" : ""}" data-flash-mark aria-pressed="${known}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M20 6 9 17l-5-5"></path></svg>
          ${t("flash.known")}
        </button>
      </div>`;
  }

  function syncGalleryDots(track) {
    const gallery = track.closest("[data-gallery]");
    if (!gallery || !track.clientWidth) return;
    const index = Math.round(track.scrollLeft / track.clientWidth);
    gallery.querySelectorAll(".flash-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === index);
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function matchesSearch(tech, query) {
    if (!query) return true;
    const cat = categoryOf(tech);
    const haystack = [
      tech.japanese,
      tech.translation,
      tech.translation_es,
      tech.literal,
      tech.literal_es,
      tech.cue,
      tech.cue_es,
      cat.name,
      cat.meaning,
      cat.meaning_es,
      ...(tech.key_points || []),
      ...(tech.key_points_es || []),
      ...(tech.mistakes || []),
      ...(tech.mistakes_es || []),
    ]
      .join(" ")
      .toLowerCase();
    return haystack.includes(query);
  }

  function shuffle(items) {
    const copy = items.slice();
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /* ---------------- view switching ---------------- */

  /* Everything that can be shown, then the subset that owns a tab. The
     speed round is launched from Hoy rather than sitting in the bar. */
  const VIEWS = ["today", "browse", "flashcards", "glossary", "speed"];
  const TABS = ["today", "browse", "flashcards", "speed", "glossary"];

  function writeHash(hash) {
    if (location.hash === hash) return;
    try {
      history.replaceState(null, "", hash);
    } catch (_) {
      location.hash = hash;
    }
  }

  function setView(view, options = {}) {
    if (!VIEWS.includes(view)) return;
    if (state.view === "speed" && view !== "speed") {
      if (state.speed.running) stopSpeedToStart();
      if (state.rounds.running) stopRoundsToStart();
    }
    state.view = view;
    closeSheet();
    closeModal();
    syncHeaderForView();
    VIEWS.forEach((name) => {
      const section = document.getElementById(`view-${name}`);
      if (section) section.hidden = name !== view;
    });
    TABS.forEach((name) => {
      const tab = document.querySelector(`.tab[data-view="${name}"]`);
      if (!tab) return;
      const active = name === view;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    if (view === "today") renderToday();
    if (view === "browse") renderBrowse();
    if (view === "flashcards") renderFlash();
    if (view === "glossary") {
      renderGlossaryMode();
      renderGlossary();
    }
    if (view === "speed") {
      updateSpeedStats();
      renderSpeedMode();
      if (state.speedMode === "quick" && !state.speed.running && !state.speed.question) showSpeedStart();
    }
    if (options.updateHash !== false) writeHash(`#${view}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  /* ---------------- browse ---------------- */

  function renderCategoryChips() {
    const hosts = $$("[data-cat-host]");
    if (!hosts.length) return;
    const pool = activeTech();
    const counts = pool.reduce((acc, tech) => {
      acc[tech.category] = (acc[tech.category] || 0) + 1;
      return acc;
    }, {});
    const items = [
      `<button class="chip ${state.filterCategory === "all" ? "active" : ""}" data-cat="all">${t("cat.all")} <span class="chip-count">${pool.length}</span></button>`,
    ];
    DATA.categories.forEach((cat) => {
      const count = counts[cat.id] || 0;
      items.push(
        `<button class="chip ${state.filterCategory === cat.id ? "active" : ""}" data-cat="${cat.id}" title="${escapeHtml(pick(cat, "meaning"))}">${cat.name} <span class="chip-count">${count}</span></button>`
      );
    });
    const html = items.join("");
    hosts.forEach((host) => { host.innerHTML = html; });
    syncFiltersBadge();
  }

  function syncFiltersBadge() {
    const badge = $("#filters-badge");
    if (!badge) return;
    const active = (state.filterCategory !== "all" ? 1 : 0) + (state.onlyUnknown ? 1 : 0);
    badge.hidden = active === 0;
    badge.textContent = String(active);
    const button = $("#filters-btn");
    if (button) {
      button.setAttribute("aria-label", t("filters.open") + (active ? " · " + active : ""));
    }
  }

  function activeTech() {
    if (state.grade === "all") return TECH;
    return TECH.filter((tech) => tech.grade_id === state.grade);
  }

  function beltChipsHTML() {
    const counts = TECH.reduce((acc, tech) => {
      acc[tech.grade_id] = (acc[tech.grade_id] || 0) + 1;
      return acc;
    }, {});
    const items = [
      `<button type="button" class="belt-chip" data-grade="all" aria-pressed="false">
        <span class="belt-chip-dot" style="--belt-color:#8b8b8b"></span>${t("grade.all")}
        <span class="chip-count">${TECH.length}</span>
      </button>`,
    ];
    GRADES.forEach((grade) => {
      const count = counts[grade.id] || 0;
      items.push(
        `<button type="button" class="belt-chip" data-grade="${grade.id}" aria-pressed="false" style="--belt-color:${grade.color}">
          <span class="belt-chip-dot"></span>${t("grade." + grade.id)}
          <span class="chip-count">${count}</span>
        </button>`
      );
    });
    return items.join("");
  }

  function renderBeltBar() {
    const hosts = $$("[data-belt-host]");
    if (!hosts.length) return;
    // Build once per language; afterwards only sync the active state so the
    // clicked chip keeps keyboard focus instead of being torn out of the DOM.
    hosts.forEach((host) => {
      if (host.dataset.built !== state.lang) {
        host.innerHTML = beltChipsHTML();
        host.dataset.built = state.lang;
      }
    });
    syncBeltBar();
  }

  function syncBeltBar() {
    $$("[data-belt-host] .belt-chip").forEach((chip) => {
      const active = chip.getAttribute("data-grade") === state.grade;
      chip.classList.toggle("active", active);
      chip.setAttribute("aria-pressed", String(active));
      if (active) {
        // Keep the selected belt visible when the host scrolls horizontally.
        const bar = chip.closest(".belt-bar");
        if (bar && bar.scrollWidth > bar.clientWidth) {
          const left = chip.offsetLeft;
          const right = left + chip.offsetWidth;
          const visibleLeft = bar.scrollLeft;
          const visibleRight = visibleLeft + bar.clientWidth;
          if (left < visibleLeft || right > visibleRight) {
            bar.scrollLeft = Math.max(0, left - bar.clientWidth / 2 + chip.offsetWidth / 2);
          }
        }
      }
    });
    syncScopeChip();
    const lede = $("#browse-lede");
    if (lede) {
      const gradeName = t("grade." + state.grade).split(" · ")[0];
      lede.textContent =
        state.grade === "all"
          ? t("browse.ledeAll")
          : t("browse.ledeGrade", { grade: gradeName });
    }
  }

  function syncScopeChip() {
    const label = $("#scope-label");
    if (!label) return;
    const grade = GRADES.find((g) => g.id === state.grade);
    const dot = $("#scope-dot");
    if (dot) dot.style.setProperty("--belt-color", grade ? grade.color : "#8b8b8b");
    label.textContent = t("grade." + state.grade);
  }

  function renderGlossaryCategories() {
    const host = $("#glossary-categories-body");
    if (!host) return;
    const counts = activeTech().reduce((acc, tech) => {
      acc[tech.category] = (acc[tech.category] || 0) + 1;
      return acc;
    }, {});
    host.innerHTML = DATA.categories
      .map(
        (cat) => `
        <article class="category-card" style="--cat-color:${cat.color}">
          <div class="category-card-top">
            <span class="category-kanji">${cat.kanji}</span>
            <span class="category-name">${cat.name} ${speakButton(cat.name)}</span>
            <span class="category-count">${counts[cat.id] || 0}</span>
          </div>
          <p class="category-meaning">${escapeHtml(pick(cat, "meaning"))}</p>
          <p class="category-desc">${escapeHtml(pick(cat, "description"))}</p>
        </article>`
      )
      .join("");
  }

  function filteredTechniques() {
    const query = state.search.trim().toLowerCase();
    const items = activeTech().filter((tech) => {
      if (state.filterCategory !== "all" && tech.category !== state.filterCategory) return false;
      if (state.onlyUnknown && isKnown(tech.id)) return false;
      return matchesSearch(tech, query);
    });
    return items.sort((a, b) => a.order - b.order);
  }

  function formatViews(count) {
    if (!count) return "";
    if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
    if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
    return String(count);
  }

  function gradeLabel(tech) {
    const key = "grade." + tech.grade_id;
    const translated = t(key);
    if (translated && translated !== key) return translated;
    return `${tech.grade} · ${tech.belt}`;
  }

  function gradeBadge(tech) {
    const grade = GRADES.find((g) => g.id === tech.grade_id);
    const color = grade ? grade.color : "#8b8b8b";
    return `<span class="grade-badge" style="--belt-color:${color}">${escapeHtml(gradeLabel(tech))}</span>`;
  }

  function renderBrowse() {
    const host = $("#browse-grid");
    const empty = $("#browse-empty");
    renderBeltBar();
    const items = filteredTechniques();
    host.innerHTML = items
      .map((tech) => {
        const cat = categoryOf(tech);
        const known = isKnown(tech.id);
        const common = tech.common === 1 ? t("common.core") : t("common.also");
        const hasFrames = tech.frames && tech.frames.length > 0;
        const strip = hasFrames
          ? `<div class="card-strip ${stripClass(tech.frames.length)}">${frameCells(tech, true, 6)}</div>`
          : `<div class="card-strip empty"><span class="empty-name">${escapeHtml(tech.japanese)}</span><span class="empty-note">${t("card.noFrames")}</span></div>`;
        const frameText = hasFrames
          ? escapeHtml(`${tech.frames.length} ${t("browse.frames")}`)
          : `<span class="card-pending">${escapeHtml(t("card.noFrames"))}</span>`;
        const footerLead = [frameText, literalLinks(tech)].filter(Boolean).join(" · ");
        return `
          <article class="tech-card" tabindex="0" role="button" aria-label="${escapeHtml(t("browse.openCard", { name: tech.japanese }))}" style="--cat-color:${cat.color}" data-id="${tech.id}">
            ${strip}
            <div class="card-body">
              <div class="card-topline">
                <span class="cat-badge">${cat.name}</span>
                ${gradeBadge(tech)}
              </div>
              <h3 class="card-title">${tech.japanese} ${speakButton(tech.japanese)}</h3>
              <p class="card-translation">${escapeHtml(pick(tech, "translation"))}</p>
              <p class="card-cue">${escapeHtml(pick(tech, "cue"))}</p>
              <div class="card-footer">
                <span>${footerLead}</span>
                <span class="common-badge">${common}</span>
                <span class="known-mark" ${known ? "" : "hidden"}>✓ ${t("modal.known")}</span>
              </div>
            </div>
          </article>`;
      })
      .join("");
    const gradeEmpty =
      state.grade !== "all" &&
      !TECH.some((tech) => tech.grade_id === state.grade);
    const emptyText = $("#browse-empty-text");
    if (emptyText) {
      emptyText.textContent = gradeEmpty ? t("browse.emptyGrade") : t("browse.empty");
    }
    empty.hidden = items.length > 0;
  }

  /* A clear button only earns its space when there is something to clear. */
  function syncClearButtons() {
    $$("[data-clear]").forEach((button) => {
      const input = document.getElementById(button.getAttribute("data-clear"));
      if (input) button.hidden = !input.value;
    });
  }

  function clearBrowseFilters() {
    state.filterCategory = "all";
    state.grade = "all";
    state.search = "";
    state.onlyUnknown = false;
    $("#search").value = "";
    $$("#only-unknown, #only-unknown-sheet").forEach((box) => { box.checked = false; });
    syncClearButtons();
    renderCategoryChips();
    renderBeltBar();
    renderBrowse();
  }

  function setOnlyUnknown(value) {
    state.onlyUnknown = !!value;
    $$("#only-unknown, #only-unknown-sheet").forEach((box) => { box.checked = state.onlyUnknown; });
    syncFiltersBadge();
    renderBrowse();
  }

  /* ---------------- phone sheets ---------------- */

  const SHEET_TRIGGERS = {
    "sheet-belt": "scope-btn",
    "sheet-filters": "filters-btn",
    "sheet-settings": "settings-btn",
    "sheet-rounds": "rounds-pick-btn",
  };
  let openSheetId = null;

  function openSheet(id) {
    const sheet = document.getElementById(id);
    if (!sheet || openSheetId === id) return;
    if (openSheetId) closeSheet();
    sheet.hidden = false;
    markDragSurface(sheet.querySelector(".sheet-panel"));
    openSheetId = id;
    const trigger = document.getElementById(SHEET_TRIGGERS[id]);
    if (trigger) trigger.setAttribute("aria-expanded", "true");
  }

  function closeSheet() {
    if (!openSheetId) return;
    const sheet = document.getElementById(openSheetId);
    if (sheet) sheet.hidden = true;
    const trigger = document.getElementById(SHEET_TRIGGERS[openSheetId]);
    if (trigger) trigger.setAttribute("aria-expanded", "false");
    openSheetId = null;
  }

  /* Sheets are pulled, not only tapped. A downward drag on the sheet *or* on
     the backdrop dismisses it; a shorter pull springs back. Listening on the
     whole wrapper matters because the backdrop is a big, obvious thing to drag.
     The drag is ignored while content inside the panel has been scrolled away
     from its top, so scrolling still works. */
  function enableDragToClose(wrapper, panel, close) {
    if (!wrapper || !panel) return;
    let startY = null;
    let delta = 0;

    wrapper.addEventListener(
      "touchstart",
      (event) => {
        let node = event.target;
        while (node && node !== wrapper) {
          if (node.scrollTop > 0) { startY = null; return; }
          node = node.parentElement;
        }
        startY = event.touches[0].clientY;
        delta = 0;
      },
      { passive: true }
    );

    wrapper.addEventListener(
      "touchmove",
      (event) => {
        if (startY === null) return;
        delta = event.touches[0].clientY - startY;
        if (delta <= 0) { delta = 0; return; }
        if (event.cancelable) event.preventDefault();
        panel.style.transform = `translateY(${delta}px)`;
      },
      { passive: false }
    );

    const release = () => {
      if (startY === null) return;
      const shouldClose = delta > 90;
      startY = null;
      delta = 0;
      panel.style.transition = "transform 200ms var(--ease)";
      panel.style.transform = shouldClose ? "translateY(100%)" : "translateY(0)";
      setTimeout(() => {
        panel.style.transition = "";
        panel.style.transform = "";
        if (shouldClose) close();
      }, 200);
    };

    wrapper.addEventListener("touchend", release);
    wrapper.addEventListener("touchcancel", release);
  }

  /* touch-action is read once, when a gesture begins, so it has to be set
     before the finger lands. A panel with nothing to scroll can own the whole
     gesture up front, which is what makes the drag dependable there. When there
     is something to scroll — the panel itself, or a scroller inside it like the
     card layout — the browser keeps the gesture and the drag falls back to
     measuring movement. */
  function markDragSurface(panel, scroller) {
    if (!panel) return;
    const target = scroller || panel;
    const scrollable = target.scrollHeight > target.clientHeight + 1;
    panel.style.touchAction = scrollable ? "" : "none";
  }

  // The category filter only means something in Browse.
  function syncHeaderForView() {
    const filtersButton = $("#filters-btn");
    if (filtersButton) filtersButton.hidden = state.view !== "browse";
    // The glossary wears its switch in the header, the one strip that never
    // scrolls away, so the reading is always one tap from the words.
    const modeButton = $("#glossary-mode");
    if (modeButton) modeButton.hidden = state.view !== "glossary";
    const actions = $(".flash-actions");
    if (actions) actions.hidden = state.view !== "flashcards";
  }

  /* ---------------- modal ---------------- */

  function openModal(id, options = {}) {
    const tech = TECH_BY_ID[id];
    if (!tech) return;
    // The body is about to be replaced, taking any player with it.
    stagePlayer = null;
    const cat = categoryOf(tech);
    const known = isKnown(id);
    const hasFrames = tech.frames && tech.frames.length > 0;
    const startFrame = options.frame != null ? options.frame : (tech.hero || 1) - 1;
    state.modalId = tech.id;
    state.modalFrame = hasFrames ? Math.max(0, Math.min(startFrame, tech.frames.length - 1)) : 0;
    const frame = hasFrames ? tech.frames[state.modalFrame] : null;
    const thumbs = hasFrames
      ? tech.frames
          .map(
            (item, index) => `
        <button class="stage-thumb ${index === state.modalFrame ? "active" : ""}" data-frame="${index}" role="tab" aria-selected="${index === state.modalFrame}" aria-label="${escapeHtml(phaseLabel(item))}">
          <img src="${item.src}" alt="" loading="lazy">
          <span>${escapeHtml(phaseLabel(item))}</span>
        </button>`
          )
          .join("")
      : "";

    const video = tech.source && tech.source.url
      ? { id: videoIdFrom(tech.source.url), start: Number(tech.source.start || 0) }
      : null;
    const visual = hasFrames
      ? `<div class="modal-visual" style="--cat-color:${cat.color}">
          <div class="modal-stage-wrap">
            <div class="modal-stage">
              <div class="stage-actions">
                <button class="stage-action ${known ? "is-known" : ""}" data-known-toggle="${tech.id}">${known ? "✓ " + t("modal.known") : t("modal.markKnown")}</button>
                ${video && EMBED_OK ? `<button class="stage-action" data-play-source="${video.id}" data-play-start="${video.start}">▶ ${t("modal.play")}</button>
                <div class="stage-speeds" role="group" aria-label="${t("modal.speed")}" hidden>
                  ${[0.25, 0.5, 1].map((rate) => `<button type="button" class="stage-speed ${rate === state.videoRate ? "active" : ""}" data-rate="${rate}" aria-pressed="${rate === state.videoRate}">${rate}×</button>`).join("")}
                </div>` : `<a class="stage-action" href="${sourceUrl(tech)}" target="_blank" rel="noopener">${t("modal.watch")} ↗</a>`}
              </div>
              <img id="stage-img" src="${frame.src}" alt="${escapeHtml(tech.japanese)} — ${escapeHtml(phaseLabel(frame))}">
              <div class="stage-video" hidden></div>
              <span class="stage-phase" id="stage-phase">${escapeHtml(phaseLabel(frame))}</span>
              <span class="stage-count" id="stage-count">${state.modalFrame + 1} / ${tech.frames.length}</span>
              <button class="stage-nav prev" data-stage-step="-1" aria-label="${t("modal.prevFrame")}">←</button>
              <button class="stage-nav next" data-stage-step="1" aria-label="${t("modal.nextFrame")}">→</button>
            </div>
            <div class="stage-thumbs" role="tablist" aria-label="${t("modal.phases")}">${thumbs}</div>
          </div>
        </div>`
      : `<div class="modal-visual no-frames" style="--cat-color:${cat.color}">
          <div class="no-frames-panel">
            <span class="no-frames-kanji">${cat.kanji}</span>
            <p>${t("modal.noFrames")}</p>
            <div class="stage-actions static">
              <button class="stage-action ${known ? "is-known" : ""}" data-known-toggle="${tech.id}">${known ? "✓ " + t("modal.known") : t("modal.markKnown")}</button>
            </div>
          </div>
        </div>`;

    const sourceLine = tech.source && tech.source.title
      ? `<div class="modal-source"><span>${t("modal.source")}: <a href="${sourceUrl(tech)}" target="_blank" rel="noopener">${escapeHtml(tech.source.title)}</a> · ${escapeHtml(tech.source.channel)} · ${(tech.frames || []).length} ${t("browse.frames")}</span></div>`
      : `<div class="modal-source"><span>${t("modal.syllabusEntry")}</span></div>`;

    $("#modal-content").innerHTML = `
      <div class="modal-layout ${hasFrames ? "" : "no-stage"}" tabindex="0">
        ${visual}
        <div class="modal-info">
          <div class="modal-hero">
            <div class="modal-badges">
              <span class="cat-badge">${cat.name} · ${escapeHtml(pick(cat, "meaning"))}</span>
              ${gradeBadge(tech)}
            </div>
            <h2 id="modal-title">${tech.japanese} ${speakButton(tech.japanese)}</h2>
            <p class="modal-translation">${escapeHtml(pick(tech, "translation"))}</p>
            ${wordChips(tech, { className: "modal-word-chips" })}
          </div>
          <div class="modal-body">
            <section class="modal-section">
              <h4>${t("modal.whatToLookFor")}</h4>
              <p>${escapeHtml(pick(tech, "cue"))}</p>
              <ul>${pickArray(tech, "key_points").map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
            </section>
            <section class="modal-section">
              <h4>${t("modal.mistakes")}</h4>
              <ul>${pickArray(tech, "mistakes").map((mistake) => `<li>${escapeHtml(mistake)}</li>`).join("")}</ul>
            </section>
            ${sourceLine}
          </div>
        </div>
      </div>`;

    const modal = $("#modal");
    modal.hidden = false;
    markDragSurface($(".modal-panel", modal), $(".modal-layout", modal));
    document.body.style.overflow = "hidden";
    if (options.updateHash !== false) writeHash(`#card/${tech.id}`);
    const close = $(".modal-close", modal);
    if (close && !options.keepFocus) close.focus({ preventScroll: true });
  }

  function selectModalFrame(index) {
    const tech = TECH_BY_ID[state.modalId];
    if (!tech || !tech.frames || !tech.frames.length) return;
    // Another frame means the video is done with; show the still again.
    stopStageVideo();
    const count = tech.frames.length;
    const next = ((index % count) + count) % count;
    state.modalFrame = next;
    const frame = tech.frames[next];
    const img = $("#stage-img");
    if (img) {
      img.src = frame.src;
      img.alt = `${tech.japanese} — ${phaseLabel(frame)}`;
    }
    const phase = $("#stage-phase");
    if (phase) phase.textContent = phaseLabel(frame);
    const counter = $("#stage-count");
    if (counter) counter.textContent = `${next + 1} / ${count}`;
    $$(".stage-thumb").forEach((thumb, i) => {
      const active = i === next;
      thumb.classList.toggle("active", active);
      thumb.setAttribute("aria-selected", String(active));
    });
  }

  function stepModalFrame(delta) {
    if (!state.modalId) return;
    selectModalFrame(state.modalFrame + delta);
  }

  function closeModal() {
    stopStageVideo();
    const modal = $("#modal");
    modal.hidden = true;
    document.body.style.overflow = "";
    $("#modal-content").innerHTML = "";
    state.modalId = null;
    state.modalFrame = 0;
    if (location.hash.startsWith("#card/")) writeHash(`#${state.view}`);
  }

  let youTubeApi = null;
  let stagePlayer = null;

  function loadYouTubeApi() {
    if (youTubeApi) return youTubeApi;
    youTubeApi = new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) { resolve(window.YT); return; }
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === "function") previous();
        resolve(window.YT);
      };
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.onerror = reject;
      document.head.appendChild(script);
    });
    return youTubeApi;
  }

  /* Playing in place beats throwing the reader into a new tab, and the source
     credit below still links out for anyone who wants the full page.

     The player runs through YouTube's own API rather than a bare iframe: a
     click here is not a gesture the cross-origin frame inherits, so autoplay
     has to be asked for from inside it. The same handle is what lets us stop
     playback when the reader moves to another frame. */
  function playStageSource(button) {
    const stage = button.closest(".modal-stage");
    const host = stage && $(".stage-video", stage);
    const id = button.getAttribute("data-play-source");
    if (!stage || !host || !id) return;
    const start = Number(button.getAttribute("data-play-start") || 0);

    host.innerHTML = '<div class="stage-video-mount"></div>';
    host.hidden = false;
    stage.classList.add("is-playing");
    button.hidden = true;

    loadYouTubeApi()
      .then((YT) => {
        if (!stage.classList.contains("is-playing") || !host.isConnected) return;
        const mount = $(".stage-video-mount", host);
        if (!mount) return;
        stagePlayer = new YT.Player(mount, {
          videoId: id,
          playerVars: {
            start,
            autoplay: 1,
            rel: 0,
            playsinline: 1,
            origin: location.origin,
          },
          events: {
            onReady: (event) => {
              const player = event.target;
              try { player.playVideo(); } catch (_) { /* policy said no */ }
              try {
                player.setPlaybackRate(state.videoRate || 1);
                const speeds = $(".stage-speeds", stage);
                if (speeds) speeds.hidden = false;
              } catch (_) { /* rate not available */ }

              /* Safari will not let a tap on our page start audio inside a
                 cross-origin frame, so "play with sound" can silently do
                 nothing there. Muted playback is always allowed, so if the
                 player is still cued a moment later, start it muted and let
                 one tap on its own speaker bring the sound back. */
              setTimeout(() => {
                if (!stage.isConnected) return;
                let state;
                try { state = player.getPlayerState(); } catch (_) { return; }
                // -1 unstarted, 2 paused, 5 cued: anything but playing or buffering
                if (state !== -1 && state !== 2 && state !== 5) return;
                try {
                  player.mute();
                  player.playVideo();
                } catch (_) { /* nothing more we can do */ }
              }, 1400);
            },
          },
        });
      })
      .catch(() => {
        // No API (offline, blocked): fall back to a plain embed.
        host.innerHTML = `<iframe src="https://www.youtube-nocookie.com/embed/${id}?start=${start}&autoplay=1&rel=0&playsinline=1"
          title="${escapeHtml(t("modal.play"))}"
          referrerpolicy="strict-origin-when-cross-origin"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowfullscreen></iframe>`;
      });
  }

  /* Put the still back. Called whenever the reader moves on, so a video can
     never carry on playing behind a different frame. */
  function stopStageVideo() {
    const stage = $(".modal-stage.is-playing");
    if (!stage) return;
    if (stagePlayer) {
      try { stagePlayer.destroy(); } catch (_) { /* already gone */ }
      stagePlayer = null;
    }
    const host = $(".stage-video", stage);
    if (host) {
      host.innerHTML = "";
      host.hidden = true;
    }
    stage.classList.remove("is-playing");
    const speeds = $(".stage-speeds", stage);
    if (speeds) speeds.hidden = true;
    const button = $("[data-play-source]", stage);
    if (button) button.hidden = false;
  }

  function toggleKnownFromModal(button) {
    const id = button.getAttribute("data-known-toggle");
    const next = !isKnown(id);
    setKnown(id, next);
    button.textContent = next ? "✓ " + t("modal.known") : t("modal.markKnown");
    button.classList.toggle("is-known", next);
    renderBrowse();
    renderFlash();
  }

  /* ---------------- training rounds ----------------

     The class drill: a bell, a clock and a swap. You choose the exercises;
     the app keeps time, counts the 4-3-2-1 in and out, and swaps the roles.
     The music is yours. */

  const ROUNDS_LIMITS = { rounds: [1, 30], work: [10, 300], rest: [0, 300] };
  let roundWakeLock = null;
  const SOUND_ELS = {};

  /* Round audio is played through media elements, not Web Audio: iOS mutes a
     Web Audio context with the ringer switch, while media (the same path the
     YouTube player takes) still sounds. One Audio per clip, primed on the
     Start tap so the count can then play itself on the beat. */
  function soundEl(name) {
    if (!SOUND_ELS[name]) {
      const el = new Audio(`count/${name}.wav`);
      el.preload = "auto";
      SOUND_ELS[name] = el;
    }
    return SOUND_ELS[name];
  }

  function playSound(name, volume) {
    const el = soundEl(name);
    try {
      // Every real play sets the element audible itself, so an earlier silent
      // prime on the same element can never leak through or be heard twice.
      el.muted = false;
      el.volume = volume == null ? 1 : volume;
      el.currentTime = 0;
      const p = el.play();
      if (p && p.catch) p.catch(() => { /* blocked until a tap */ });
    } catch (_) { /* nothing we can do */ }
  }

  /* The cues are spoken in English in both interface languages: a single good
     voice beats a good voice reading Spanish it cannot pronounce. */
  const CUE_LANG = "en";
  const ROUND_SOUNDS = ["bell", "blip",
    "en-n1", "en-n2", "en-n3", "en-n4", "en-start", "en-go", "en-rest", "en-stop"];

  function preloadRoundAudio() {
    ROUND_SOUNDS.forEach((name) => { try { soundEl(name).load(); } catch (_) { /* ignore */ } });
  }

  /* The first ring is immediate; the rest follow, so the bell leads the count. */
  function roundBell(rings) {
    playSound("bell");
    for (let i = 1; i < rings; i += 1) setTimeout(() => playSound("bell"), i * 380);
  }

  function roundBlip() { playSound("blip", 0.6); }

  /* Each cue is one 4-second recording: "cuatro, tres, dos, uno" on the exact
     second marks, then the word - Start!, Go!, Rest! or Stop!. One file per
     cue, played once, so it lands on the 4-3-2-1 on screen and cannot repeat. */
  /* The numbers are one recording of 4-3-2-1, shared by every cue, played whole
     and never cut. The cue's word is a separate recording, started on the beat
     at 3.5 s - so the numbers are identical everywhere and no word is clipped. */
  /* Every word is its own recording, so the voice is exactly as generated:
     one number per blink, and the cue word at the moment the count finishes. */
  function playNum(n) {
    playSound(`${CUE_LANG}-n${n}`);
  }
  /* iOS only allows programmatic playback on a media element that a gesture has
     already started. This plays every clip silently once, inside the Start tap,
     so the numbers and the words are all unlocked before they are needed. */
  function primeRoundAudio() {
    return Promise.all(
      ROUND_SOUNDS.map(
        (name) =>
          new Promise((resolve) => {
            const el = soundEl(name);
            const done = () => {
              try { el.pause(); el.currentTime = 0; } catch (_) { /* ignore */ }
              el.muted = false;
              el.volume = 1;
              resolve();
            };
            try { el.muted = true; el.volume = 0; const p = el.play(); if (p && p.then) p.then(done, done); else done(); }
            catch (_) { done(); }
          })
      )
    );
  }

  function playWord(name) {
    playSound(`${CUE_LANG}-${name}`);
  }

  function stopCue() {
    ROUND_SOUNDS.forEach((n) => { const el = SOUND_ELS[n]; if (el) el.onended = null; });
    ROUND_SOUNDS.forEach((name) => {
      const el = SOUND_ELS[name];
      if (!el) return;
      try { el.pause(); el.currentTime = 0; } catch (_) { /* ignore */ }
    });
  }

  function roundBuzz(pattern) {
    try { if (navigator.vibrate) navigator.vibrate(pattern); } catch (_) { /* none */ }
  }

  async function roundWakeLockOn() {
    try {
      if ("wakeLock" in navigator && !roundWakeLock) {
        roundWakeLock = await navigator.wakeLock.request("screen");
      }
    } catch (_) { /* denied */ }
  }
  function roundWakeLockOff() {
    try { if (roundWakeLock) { roundWakeLock.release(); roundWakeLock = null; } } catch (_) { /* gone */ }
  }

  function readRoundsCfg() {
    const saved = readJSON(STORAGE.rounds, {}) || {};
    const r = state.rounds;
    ["rounds", "work", "rest"].forEach((key) => {
      if (typeof saved[key] === "number" && !Number.isNaN(saved[key])) r[key] = saved[key];
    });
    if (typeof saved.pairs === "boolean") r.pairs = saved.pairs;
    const picks = readJSON(STORAGE.roundsPicks, null);
    r.picks = Array.isArray(picks) ? picks : null;
  }
  function saveRoundsCfg() {
    const { rounds, work, rest, pairs } = state.rounds;
    writeRaw(STORAGE.rounds, JSON.stringify({ rounds, work, rest, pairs }));
  }
  function saveRoundsPicks() {
    writeRaw(STORAGE.roundsPicks, JSON.stringify(state.rounds.picks));
  }

  function adjustRoundsCfg(key, delta) {
    const [min, max] = ROUNDS_LIMITS[key];
    state.rounds[key] = Math.max(min, Math.min(max, state.rounds[key] + delta));
    saveRoundsCfg();
    renderRoundsConfig();
  }

  /* The exercises the session will drill: the picked ones, or the whole belt. */
  function roundsEffectiveIds() {
    const pool = activeTech().map((t) => t.id);
    const picks = state.rounds.picks;
    if (picks === null) return pool;
    if (!picks.length) return [];
    const set = new Set(picks);
    const kept = pool.filter((id) => set.has(id));
    return kept.length ? kept : pool;
  }

  function renderRoundsConfig() {
    const r = state.rounds;
    const set = (id, text) => { const el = $(id); if (el) el.textContent = text; };
    set("#cfg-rounds", String(r.rounds));
    set("#cfg-work", r.work + "s");
    set("#cfg-rest", r.rest ? r.rest + "s" : t("rounds.none"));
    const pairs = $("#cfg-pairs");
    if (pairs) pairs.checked = r.pairs;
    const ids = roundsEffectiveIds();
    const all = r.picks === null || ids.length === activeTech().length;
    set("#rounds-pick-label", all ? t("rounds.selectedAll", { n: activeTech().length }) : t("rounds.selectedSome", { n: ids.length }));
    $$("#speed-rounds [data-cfg]").forEach((button) => {
      const key = button.getAttribute("data-cfg");
      const delta = Number(button.getAttribute("data-delta"));
      const [min, max] = ROUNDS_LIMITS[key];
      button.disabled = delta < 0 ? r[key] <= min : r[key] >= max;
    });
    const start = $("#rounds-start-btn");
    if (start) {
      start.disabled = ids.length === 0;
      start.textContent = ids.length === 0 ? t("rounds.empty") : t("rounds.start");
    }
  }

  function showRoundsStart() {
    const start = $("#rounds-start");
    const session = $("#rounds-session");
    const end = $("#rounds-end");
    if (start) start.hidden = false;
    if (session) session.hidden = true;
    if (end) end.hidden = true;
    renderRoundsConfig();
  }
  function showRoundsSession() {
    const start = $("#rounds-start");
    const session = $("#rounds-session");
    const end = $("#rounds-end");
    if (start) start.hidden = true;
    if (session) session.hidden = false;
    if (end) end.hidden = true;
  }

  function roundsQueue() {
    const ids = new Set(roundsEffectiveIds());
    const pool = activeTech().filter((tech) => ids.has(tech.id));
    for (let i = pool.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool;
  }

  async function startRounds() {
    const r = state.rounds;
    const queue = roundsQueue();
    if (!queue.length) return;
    r.running = true;
    r.phase = "prep";
    r.round = 0;
    r.secondsLeft = 4;
    r.prepCue = "start";
    r.queue = queue;
    roundWakeLockOn();
    showRoundsSession();
    renderRoundsSession();
    await primeRoundAudio();
    if (!r.running) return;
    playNum(4);
    clearInterval(r.timerId);
    r.timerId = setInterval(roundsTick, 1000);
  }

  /* A count-in: the numbers sound on each blink, the word when it reaches 0. */
  function beginPrep(cue) {
    const r = state.rounds;
    r.phase = "prep";
    r.secondsLeft = 4;
    r.prepCue = cue || "go";
    renderRoundsSession();
    playNum(4);
  }

  function beginRound() {
    const r = state.rounds;
    r.round += 1;
    r.phase = "work";
    r.secondsLeft = r.work;
    roundBuzz([120, 60, 120]);
    renderRoundsSession();
  }

  function finishRound() {
    const r = state.rounds;
    roundBuzz([160, 80, 160, 80, 160]);
    if (r.round >= r.rounds) { endRounds(); return; }
    if (r.rest >= 1) {
      r.phase = "rest";
      r.secondsLeft = r.rest;
      renderRoundsSession();
    } else {
      // No rest: go straight into a count-in whose word is "Go!".
      beginPrep("go");
    }
  }

  function roundsTick() {
    const r = state.rounds;
    if (!r.running) return;
    r.secondsLeft -= 1;
    if (r.secondsLeft <= 0) {
      // The count has finished: say the word for this transition, then move on.
      if (r.phase === "prep") {
        playWord(r.prepCue === "go" ? "go" : "start");
        beginRound();
      } else if (r.phase === "work") {
        if (r.round >= r.rounds) playWord("stop");
        else if (r.rest >= 1) playWord("rest");
        finishRound();
      } else if (r.phase === "rest") {
        playWord("go");
        beginRound();
      }
      return;
    }
    // One number on each blink - through the count-in, the last four seconds
    // of work, and the last four seconds of the rest, which counts into "Go!".
    if (r.phase !== "idle" && r.phase !== "done" && r.secondsLeft <= 4) playNum(r.secondsLeft);
    renderRoundsSession();
  }

  function endRounds() {
    const r = state.rounds;
    r.running = false;
    r.phase = "done";
    clearInterval(r.timerId);
    r.timerId = null;
    roundWakeLockOff();
    roundBell(3);
    const session = $("#rounds-session");
    const end = $("#rounds-end");
    if (session) session.hidden = true;
    if (end) end.hidden = false;
    const score = $("#rounds-end-score");
    if (score) score.textContent = r.rounds === 1 ? t("rounds.roundsDoneOne") : t("rounds.roundsDone", { n: r.rounds });
  }

  function stopRoundsToStart() {
    const r = state.rounds;
    r.running = false;
    r.phase = "idle";
    clearInterval(r.timerId);
    r.timerId = null;
    roundWakeLockOff();
    stopCue();
    showRoundsStart();
  }

  function renderRoundsSession() {
    const r = state.rounds;
    const phase = $("#rounds-phase");
    const clock = $("#rounds-clock");
    if (!clock) return;
    let label = t("rounds.workLabel");
    if (r.phase === "prep") label = t("rounds.prepare");
    else if (r.phase === "rest") label = t("rounds.restLabel");
    if (phase) phase.textContent = label;
    clock.textContent = String(Math.max(0, r.secondsLeft));
    clock.classList.toggle("is-prep", r.phase === "prep");
    clock.classList.toggle("is-rest", r.phase === "rest");
    clock.classList.toggle("is-count", r.phase === "prep" || (r.phase === "work" && r.secondsLeft <= 4));
    const meta = $("#rounds-meta");
    if (meta) meta.textContent = t("rounds.roundOf", { n: Math.max(1, r.round), total: r.rounds });
    const word = $("#rounds-word");
    if (word) {
      let key = "";
      if (r.phase === "prep") key = r.prepCue === "go" ? "rounds.sayGo" : "rounds.sayStart";
      else if (r.phase === "work" && r.secondsLeft <= 4) key = r.round >= r.rounds ? "rounds.sayStop" : "rounds.sayRest";
      else if (r.phase === "rest" && r.secondsLeft <= 4) key = "rounds.sayGo";
      word.hidden = !key;
      if (key) word.textContent = t(key);
    }
    const role = $("#rounds-role");
    if (role) {
      if (r.pairs && r.phase === "work") {
        role.hidden = false;
        role.textContent = r.round % 2 === 1 ? t("rounds.toriYou") : t("rounds.toriPartner");
      } else {
        role.hidden = true;
      }
    }
    const target = $("#rounds-target");
    if (target) {
      const idx = r.phase === "rest" ? r.round : Math.max(0, r.round - 1);
      const tech = r.queue.length ? r.queue[((idx % r.queue.length) + r.queue.length) % r.queue.length] : null;
      if (tech) {
        const hero = heroFrame(tech);
        target.innerHTML = `${hero ? `<img src="${hero.src}" alt="">` : ""}<span class="rounds-target-name">${escapeHtml(tech.japanese)}</span><span class="rounds-target-sub">${escapeHtml(pick(tech, "translation"))}</span>`;
      } else {
        target.innerHTML = "";
      }
    }
  }

  function renderRoundsPicks() {
    const host = $("#rounds-picks");
    if (!host) return;
    const picks = Array.isArray(state.rounds.picks) ? new Set(state.rounds.picks) : null;
    const pool = activeTech();
    host.innerHTML = DATA.categories
      .map((cat) => {
        const items = pool.filter((tech) => tech.category === cat.id);
        if (!items.length) return "";
        return `<div class="pick-group">
          <p class="pick-group-label" style="--cat-color:${cat.color}">${escapeHtml(cat.name)}<b>${items.length}</b></p>
          ${items
            .map((tech) => {
              const on = picks === null || picks.has(tech.id);
              return `<label class="pick-row"><input type="checkbox" data-pick="${tech.id}" ${on ? "checked" : ""}> <span>${escapeHtml(tech.japanese)}</span></label>`;
            })
            .join("")}
        </div>`;
      })
      .join("");
  }

  function openRoundsSheet() {
    renderRoundsPicks();
    openSheet("sheet-rounds");
  }

  function setRoundsPicks(picks) {
    state.rounds.picks = picks;
    saveRoundsPicks();
    renderRoundsPicks();
    renderRoundsConfig();
  }

  function toggleRoundsPick(input) {
    const current = new Set(roundsEffectiveIds());
    if (input.checked) current.add(input.getAttribute("data-pick"));
    else current.delete(input.getAttribute("data-pick"));
    setRoundsPicks([...current]);
  }

  function setSpeedMode(mode) {
    if (mode !== "quick" && mode !== "rounds") return;
    if (state.speedMode === mode) return;
    if (state.speed.running) stopSpeedToStart();
    if (state.rounds.running) stopRoundsToStart();
    state.speedMode = mode;
    writeRaw(STORAGE.speedMode, mode);
    renderSpeedMode();
  }

  function renderSpeedMode() {
    const rounds = state.speedMode === "rounds";
    const quick = $("#speed-quick");
    const host = $("#speed-rounds");
    if (quick) quick.hidden = rounds;
    if (host) host.hidden = !rounds;
    $$("#speed-mode [data-smode]").forEach((button) => {
      const on = button.getAttribute("data-smode") === state.speedMode;
      button.classList.toggle("active", on);
      button.setAttribute("aria-pressed", String(on));
    });
    if (rounds && !state.rounds.running) showRoundsStart();
  }

  /* ---------------- today ---------------- */

  function dayIndex() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return Math.floor((start - new Date(now.getFullYear(), 0, 0)) / 86400000);
  }

  /* The same pick all day, and the same pick whatever the language: only the
     copy around it is translated. */
  function dailyPick(list, offset) {
    if (!list.length) return null;
    return list[(dayIndex() * 7 + offset * 13) % list.length];
  }

  function renderToday() {
    const date = $("#today-date");
    if (date) {
      try {
        date.textContent = new Date().toLocaleDateString(state.lang === "es" ? "es-ES" : "en-GB", {
          weekday: "long",
          day: "numeric",
          month: "long",
        });
      } catch (_) {
        date.textContent = "";
      }
    }

    const word = dailyPick(GLOSSARY, 0);
    const wordHost = $("#today-word");
    if (wordHost) {
      wordHost.innerHTML = word
        ? `<p class="today-card-label">${escapeHtml(t("today.word"))}</p>
           <h3 class="today-word">${escapeHtml(word.term)} ${speakButton(word.term)}</h3>
           <p class="today-reading">${escapeHtml(word.reading)}${kanaFor(word.term) ? `<span class="kana">${escapeHtml(kanaFor(word.term))}</span>` : ""}</p>
           <p class="today-meaning">${escapeHtml(pick(word, "meaning"))}</p>
           <p class="today-note">${escapeHtml(pick(word, "note"))}</p>
           <button type="button" class="ghost today-open" data-gloss="${escapeHtml(word.term)}">${escapeHtml(t("glossary.open"))}</button>`
        : "";
    }

    const tech = dailyPick(activeTech(), 3);
    const techHost = $("#today-tech");
    if (techHost) {
      const hero = tech ? heroFrame(tech) : null;
      techHost.innerHTML = tech
        ? `<p class="today-card-label">${escapeHtml(t("today.technique"))}</p>
           ${hero ? `<button type="button" class="today-thumb" data-open-card="${tech.id}"><img src="${hero.src}" alt="" loading="lazy"></button>` : ""}
           <h3 class="today-word">${escapeHtml(tech.japanese)} ${speakButton(tech.japanese)}</h3>
           <p class="today-meaning">${escapeHtml(pick(tech, "translation"))}</p>
           <p class="today-note">${escapeHtml(pick(tech, "cue"))}</p>
           <button type="button" class="ghost today-open" data-open-card="${tech.id}">${escapeHtml(t("today.openCard"))}</button>`
        : "";
    }

    const progress = $("#today-progress");
    if (progress) {
      const pool = activeTech();
      const known = pool.filter((item) => isKnown(item.id)).length;
      const pct = pool.length ? Math.round((known / pool.length) * 100) : 0;
      progress.innerHTML = `
        <div class="today-progress-head">
          <span>${escapeHtml(t("today.known", { n: known, total: pool.length }))}</span>
          <span class="today-progress-pct">${pct}%</span>
        </div>
        <div class="today-bar"><i style="width:${pct}%"></i></div>
        <p class="today-best">${escapeHtml(t("today.best", { n: state.speed.best }))}</p>`;
    }
  }

  /* ---------------- flashcards ---------------- */

  function isGlossaryDeck() {
    return state.deck === "glossary";
  }

  /* The vocabulary deck follows the belt scope: the words the techniques of
     the selected belt actually use. */
  function glossaryDeck() {
    if (state.grade === "all") return GLOSSARY;
    const ids = new Set(activeTech().map((tech) => tech.id));
    return GLOSSARY.filter((item) =>
      (TERM_TO_TECHS.get(item.term.toLowerCase()) || []).some((id) => ids.has(id)));
  }

  function currentCard() {
    if (isGlossaryDeck()) {
      const term = state.flashOrder[state.flashIndex];
      return GLOSSARY.find((item) => item.term === term) || null;
    }
    const fallback = activeTech()[0] || TECH[0];
    return TECH_BY_ID[state.flashOrder[state.flashIndex]] || fallback;
  }

  /* The known store is keyed by technique id or by term, depending on the deck. */
  function currentKey() {
    const card = currentCard();
    if (!card) return null;
    return isGlossaryDeck() ? card.term : card.id;
  }

  function rebuildFlashOrder() {
    state.flashOrder = isGlossaryDeck()
      ? glossaryDeck().map((item) => item.term)
      : activeTech().map((tech) => tech.id);
    state.flashIndex = 0;
    state.flashFlipped = false;
  }

  function renderFlash() {
    const host = $("#flash-content");
    if (!state.flashOrder.length) {
      host.innerHTML = `<p class="flash-empty">${t(isGlossaryDeck() ? "flash.emptyDeck" : "flash.emptyGrade")}</p>`;
      $("#flash-progress").textContent = "";
      $("#flash-hint").textContent = "";
      const actions = $(".flash-actions");
      if (actions) actions.hidden = state.view !== "flashcards";
      return;
    }

    $$("#flash-deck button").forEach((button) => {
      const active = button.getAttribute("data-deck") === state.deck;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });
    const swap = $("#flash-swap");
    if (swap) {
      // A vocabulary card has one direction, so the swap has nothing to do.
      swap.hidden = isGlossaryDeck();
      const label = t(state.flashMode === "image" ? "flash.dirImage" : "flash.dirName");
      swap.setAttribute("aria-label", label);
      swap.setAttribute("title", label);
    }
    if (isGlossaryDeck()) return renderGlossaryCard();
    const tech = currentCard();
    if (!tech) return;
    const cat = categoryOf(tech);
    const known = isKnown(tech.id);
    const flipped = state.flashFlipped;
    const hasFrames = tech.frames && tech.frames.length > 0;
    const card = $("#flashcard");
    if (card) card.classList.toggle("is-back", flipped);

    $("#flash-known").checked = known;
    $("#flash-progress").textContent = t("flash.counter", { n: state.flashIndex + 1, total: state.flashOrder.length });
    $("#flash-hint").textContent = flipped ? t("flash.backHint") : t("flash.flipHint");
    const flipButton = $("#flash-flip");
    if (flipButton) flipButton.textContent = t(flipped ? "flash.hide" : "flash.show");

    // Phone loop: the action row swaps between "reveal" and the two grades.
    // Visibility follows the view, not this function, because renderFlash also
    // runs on load and on language or belt changes.
    const actions = $(".flash-actions");
    if (actions) actions.hidden = state.view !== "flashcards";
    const primaryM = $("#flash-primary-m");
    if (primaryM) primaryM.textContent = t(flipped ? "flash.next" : "flash.show");
    const count = $("#flash-count");
    if (count) count.textContent = `${state.flashIndex + 1} / ${state.flashOrder.length}`;
    const fill = $("#flash-bar-fill");
    if (fill) fill.style.width = `${((state.flashIndex + 1) / state.flashOrder.length) * 100}%`;

    const swapIcon = $("#flash-swap");
    if (swapIcon) swapIcon.setAttribute("aria-pressed", String(state.flashMode === "image"));

    if (!flipped) {
      if (state.flashMode === "name" || !hasFrames) {
        host.innerHTML = `
          ${markToggle(tech.id)}
          <span class="cat-badge flash-category" style="--cat-color:${cat.color}">${cat.name}</span>
          ${gradeBadge(tech)}
          <h2 class="flash-name">${tech.japanese} ${speakButton(tech.japanese)}</h2>
          ${wordChips(tech, { className: "flash-word-chips" })}
          <p class="flash-prompt">${t("flash.namePrompt")}</p>`;
      } else {
        host.innerHTML = `
          ${flashGallery(tech)}
          <p class="flash-prompt">${t("flash.imagePrompt")}</p>`;
      }
      return;
    }

    // On the back, only repeat the frames when the front showed the name.
    // In "image" mode the frames are already on the front.
    const showBackImages = hasFrames && state.flashMode === "name";
    const imageBlock = showBackImages ? flashGallery(tech) : "";

    const points = pickArray(tech, "key_points");

    host.innerHTML = `
      ${imageBlock}
      ${markToggle(tech.id)}
      <span class="cat-badge flash-category" style="--cat-color:${cat.color}">${cat.name}</span>
      ${gradeBadge(tech)}
      <h2 class="flash-back-title">${tech.japanese} ${speakButton(tech.japanese)}</h2>
      <p class="flash-back-sub">${escapeHtml(pick(tech, "translation"))}</p>
      ${wordChips(tech, { className: "flash-word-chips" })}
      <p class="flash-cue">${escapeHtml(pick(tech, "cue"))}</p>
      <ul class="flash-points">${points.map((point) => `<li>${escapeHtml(point)}</li>`).join("")}</ul>
      <button class="flash-open" data-open-card="${tech.id}">${t("flash.openCard")}</button>`;
  }

  /* A vocabulary card: the term on the front, what it means and where it is
     used on the back. Same one-button loop as a technique card. */
  function renderGlossaryCard() {
    const host = $("#flash-content");
    const item = currentCard();
    const flipped = state.flashFlipped;
    const card = $("#flashcard");
    if (card) card.classList.toggle("is-back", flipped);
    if (!item) {
      host.innerHTML = `<p class="flash-empty">${t("flash.emptyDeck")}</p>`;
      $("#flash-progress").textContent = "";
      $("#flash-hint").textContent = "";
      return;
    }

    $("#flash-known").checked = isKnown(item.term);
    $("#flash-progress").textContent = t("flash.counter", { n: state.flashIndex + 1, total: state.flashOrder.length });
    $("#flash-hint").textContent = flipped ? t("flash.backHint") : t("flash.flipHint");
    const flipButton = $("#flash-flip");
    if (flipButton) flipButton.textContent = t(flipped ? "flash.hide" : "flash.show");
    const primaryM = $("#flash-primary-m");
    if (primaryM) primaryM.textContent = t(flipped ? "flash.next" : "flash.show");
    const count = $("#flash-count");
    if (count) count.textContent = `${state.flashIndex + 1} / ${state.flashOrder.length}`;
    const fill = $("#flash-bar-fill");
    if (fill) fill.style.width = `${((state.flashIndex + 1) / state.flashOrder.length) * 100}%`;

    if (!flipped) {
      host.innerHTML = `
        ${markToggle(item.term)}
        <h2 class="flash-name">${escapeHtml(item.term)} ${speakButton(item.term)}</h2>
        <p class="flash-reading">${escapeHtml(item.reading)}${kanaFor(item.term) ? `<span class="kana">${escapeHtml(kanaFor(item.term))}</span>` : ""}</p>
        <p class="flash-prompt">${t("flash.wordPrompt")}</p>`;
      return;
    }

    const ids = techniquesForTerm(item.term);
    const uses = ids.length
      ? `<p class="flash-cue">${escapeHtml(t("glossary.uses", { n: ids.length }))}</p>
         <div class="flash-uses">${ids
           .map((id) => {
             const tech = TECH_BY_ID[id];
             return tech
               ? `<button type="button" class="glossary-use" data-open-card="${id}">${escapeHtml(tech.japanese)}</button>`
               : "";
           })
           .join("")}</div>`
      : "";

    host.innerHTML = `
      ${markToggle(item.term)}
      <h2 class="flash-back-title">${escapeHtml(item.term)} ${speakButton(item.term)}</h2>
      <p class="flash-back-sub">${escapeHtml(item.reading)}${kanaFor(item.term) ? `<span class="kana">${escapeHtml(kanaFor(item.term))}</span>` : ""}</p>
      <p class="flash-cue">${escapeHtml(pick(item, "meaning"))}</p>
      <p class="flash-note">${escapeHtml(pick(item, "note"))}</p>
      ${uses}`;
  }

  function flipFlash() {
    state.flashFlipped = !state.flashFlipped;
    renderFlash();
    if (state.flashFlipped) {
      const card = $("#flashcard");
      if (card) requestAnimationFrame(() => card.scrollIntoView({ block: "nearest", behavior: "instant" }));
    }
  }

  function moveFlash(delta) {
    if (!state.flashOrder.length) return;
    state.flashIndex = (state.flashIndex + delta + state.flashOrder.length) % state.flashOrder.length;
    state.flashFlipped = false;
    renderFlash();
  }

  function shuffleFlash() {
    state.flashOrder = shuffle(state.flashOrder);
    state.flashIndex = 0;
    state.flashFlipped = false;
    renderFlash();
  }

  function setFlashMode(mode) {
    state.flashMode = mode;
    writeRaw(STORAGE.flashMode, mode);
    state.flashFlipped = false;
    renderFlash();
  }

  /* Which of the two decks you are studying is one choice, not a per-screen
     setting: pick Vocabulary in the cards and the round follows you there. */
  function setDeck(deck) {
    if (deck !== "techniques" && deck !== "glossary") return;
    if (state.deck === deck) return;
    state.deck = deck;
    writeRaw(STORAGE.deck, deck);
    if (state.speed.running) stopSpeedToStart();
    state.flashFlipped = false;
    rebuildFlashOrder();
    renderFlash();
    renderSpeedDir();
  }

  function toggleFlashKnown() {
    const key = currentKey();
    if (!key) return;
    const next = !isKnown(key);
    setKnown(key, next);
    $("#flash-known").checked = next;
    renderBrowse();
    renderFlash();
    renderToday();
  }


  /* ---------------- speed round ---------------- */

  function updateSpeedStats() {
    $("#speed-best").textContent = state.speed.best;
    $("#speed-score").textContent = state.speed.score;
    $("#speed-timer").textContent = Math.max(0, state.speed.time);
  }

  function showSpeedStart() {
    $("#speed-start").hidden = false;
    $("#speed-game").hidden = true;
    $("#speed-end").hidden = true;
  }

  function startSpeed() {
    if (speedPool().length < 2) {
      const copy = $("#speed-start-copy");
      if (copy) copy.textContent = t("speed.emptyGrade");
      return;
    }
    clearInterval(state.speed.timerId);
    clearTimeout(state.speed.transitionId);
    state.speed.running = true;
    state.speed.score = 0;
    state.speed.total = 0;
    state.speed.time = 60;
    state.speed.answered = false;
    state.speed.missed = [];
    state.speed.question = null;
    state.speed.finished = false;
    updateSpeedStats();
    $("#speed-start").hidden = true;
    $("#speed-end").hidden = true;
    $("#speed-game").hidden = false;
    nextSpeedQuestion();
    state.speed.timerId = setInterval(() => {
      state.speed.time -= 1;
      updateSpeedStats();
      if (state.speed.time <= 0) endSpeed();
    }, 1000);
  }

  function stopSpeedToStart() {
    state.speed.running = false;
    clearInterval(state.speed.timerId);
    clearTimeout(state.speed.transitionId);
    state.speed.timerId = null;
    state.speed.transitionId = null;
    state.speed.score = 0;
    state.speed.total = 0;
    state.speed.time = 60;
    state.speed.question = null;
    state.speed.answered = false;
    state.speed.missed = [];
    state.speed.finished = false;
    updateSpeedStats();
    showSpeedStart();
  }

  function renderSpeedDir() {
    const picture = state.speed.dir === "picture";
    const glossary = state.deck === "glossary";

    $$("#speed-deck button").forEach((button) => {
      const active = button.getAttribute("data-deck") === state.deck;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    /* One button that swaps, not a two-way control: the labels are long enough
       that a phone wraps them, and the round only has two directions anyway. */
    const swap = $("#speed-swap");
    if (swap) {
      const label = t(
        glossary
          ? (picture ? "speed.dirMeaning" : "speed.dirTerm")
          : (picture ? "speed.dirPicture" : "speed.dirName")
      );
      const swapLabel = $("#speed-swap-label");
      if (swapLabel) swapLabel.textContent = label;
      swap.setAttribute("title", `${label} — ${t("speed.swap")}`);
      swap.setAttribute("aria-label", `${label} — ${t("speed.swap")}`);
    }

    const copy = $("#speed-start-copy");
    if (copy) {
      copy.textContent = t(
        glossary
          ? (picture ? "speed.copyMeaning" : "speed.copyTerm")
          : (picture ? "speed.copyPicture" : "speed.copyName")
      );
    }
    const scopeNote = $("#speed-scope-note");
    if (scopeNote) {
      const fallback = speedUsesFallback() && state.grade !== "all";
      scopeNote.hidden = !fallback;
      scopeNote.textContent = fallback ? t("speed.fallbackNote") : "";
    }
  }

  function setSpeedDir(dir) {
    state.speed.dir = dir === "picture" ? "picture" : "name";
    writeRaw(STORAGE.speedDir, state.speed.dir);
    renderSpeedDir();
  }

  /* The round works on generic items, so the same loop can quiz a technique
     name against its frames or a Japanese word against its meaning. */
  function speedItemFromTech(tech) {
    return {
      id: tech.id,
      name: tech.japanese,
      sub: pick(tech, "translation"),
      meaning: pick(tech, "translation"),
      frame: heroFrame(tech) || null,
      speak: tech.japanese,
    };
  }

  function speedItemFromTerm(item) {
    return {
      id: item.term,
      name: item.term,
      sub: item.reading,
      meaning: pick(item, "meaning"),
      frame: null,
      speak: item.term,
    };
  }

  function speedPool() {
    if (state.deck === "glossary") {
      const scoped = glossaryDeck().map(speedItemFromTerm);
      return scoped.length >= 4 ? scoped : GLOSSARY.map(speedItemFromTerm);
    }
    const scoped = activeTech().filter((tech) => tech.frames && tech.frames.length > 0).map(speedItemFromTech);
    if (scoped.length >= 2) return scoped;
    // A belt with no frames yet would leave the round empty; fall back to the
    // whole atlas so the game still works. The start panel explains this.
    return TECH.filter((tech) => tech.frames && tech.frames.length > 0).map(speedItemFromTech);
  }

  function speedUsesFallback() {
    if (state.deck === "glossary") return false;
    return activeTech().filter((tech) => tech.frames && tech.frames.length > 0).length < 2;
  }

  function nextSpeedQuestion() {
    if (!state.speed.running) return;
    const all = speedPool();
    if (all.length < 2) {
      endSpeed();
      return;
    }
    const pool = all.filter((item) => !state.speed.question || item.id !== state.speed.question.id);
    const correct = pool[Math.floor(Math.random() * pool.length)] || all[0];
    const others = shuffle(all.filter((item) => item.id !== correct.id)).slice(0, 3);
    state.speed.question = correct;
    state.speed.options = shuffle([correct, ...others]);
    state.speed.answered = false;
    state.speed.picked = null;
    renderSpeedQuestion();
  }

  function renderSpeedQuestion() {
    const correct = state.speed.question;
    if (!correct) return;
    const glossary = state.deck === "glossary";
    const picture = state.speed.dir === "picture";

    const name = $("#speed-name");
    const words = $("#speed-words");
    const eyebrow = $("#speed-eyebrow");
    const imgWrap = $("#speed-question-img");
    const img = $("#speed-img");

    if (glossary) {
      if (name) {
        name.hidden = false;
        name.innerHTML = `${escapeHtml(picture ? correct.meaning : correct.name)}${speakButton(correct.speak, "inline-speak")}`;
      }
      if (words) {
        words.innerHTML = picture || !correct.sub
          ? ""
          : `<span class="speed-term">${escapeHtml(correct.sub)}</span>`;
      }
      if (eyebrow) eyebrow.textContent = picture ? t("speed.whichTerm") : t("speed.whichMeaning");
      if (imgWrap) imgWrap.hidden = true;
    } else if (picture) {
      if (name) name.hidden = true;
      if (words) words.innerHTML = "";
      if (eyebrow) eyebrow.textContent = t("speed.whichName");
      if (imgWrap) imgWrap.hidden = false;
      if (img && correct.frame) {
        img.src = correct.frame.src;
        img.alt = `${correct.name} — ${phaseLabel(correct.frame)}`;
      }
    } else {
      if (name) {
        name.hidden = false;
        name.innerHTML = `${escapeHtml(correct.name)}${speakButton(correct.name, "inline-speak")}`;
      }
      if (words) words.innerHTML = wordChips(TECH_BY_ID[correct.id], { className: "speed-word-chips" });
      if (eyebrow) eyebrow.textContent = t("speed.whichTechnique");
      if (imgWrap) imgWrap.hidden = true;
    }

    $("#speed-feedback").textContent = "";
    $("#speed-feedback").className = "speed-feedback";
    const answerWords = $("#speed-answer-words");
    if (answerWords) answerWords.innerHTML = "";

    const host = $("#speed-options");
    host.classList.remove("answered", "picture-options", "text-options");
    if (glossary) host.classList.add("text-options");
    host.innerHTML = state.speed.options
      .map((item, index) => {
        const letter = String.fromCharCode(65 + index);
        const label = t("speed.option", { letter });
        if (glossary) {
          const text = picture ? item.name : item.meaning;
          const sub = picture ? item.sub : "";
          return `
          <button class="speed-option name-option" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}">
            <span class="option-key">${letter}</span>
            <span class="option-name">${escapeHtml(text)}</span>
            ${sub ? `<span class="option-sub">${escapeHtml(sub)}</span>` : ""}
          </button>`;
        }
        if (picture) {
          return `
          <button class="speed-option name-option" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}: ${escapeHtml(item.name)}">
            <span class="option-key">${letter}</span>
            <span class="option-name">${escapeHtml(item.name)}</span>
            <span class="option-sub">${escapeHtml(item.sub)}</span>
          </button>`;
        }
        return `
          <button class="speed-option" data-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(label)}">
            <img src="${item.frame.src}" alt="${escapeHtml(label)}" loading="eager">
            <span class="option-key">${letter}</span>
            <span class="option-name">${escapeHtml(item.name)}</span>
          </button>`;
      })
      .join("");

    if (state.speed.answered) showSpeedAnswer(state.speed.picked);
  }

  function showSpeedAnswer(optionId) {
    const correct = state.speed.question;
    const glossary = state.deck === "glossary";
    const isCorrect = optionId === correct.id;
    const host = $("#speed-options");
    host.classList.add("answered");
    $$(".speed-option", host).forEach((btn) => {
      btn.disabled = true;
    });

    const answerWords = $("#speed-answer-words");
    if (answerWords) {
      const tech = !glossary && state.speed.dir === "picture" ? TECH_BY_ID[correct.id] : null;
      answerWords.innerHTML = tech ? wordChips(tech, { className: "speed-word-chips" }) : "";
    }

    const vars = { name: correct.name, translation: correct.meaning };
    const button = $(`.speed-option[data-id="${optionId}"]`, host);
    const feedback = $("#speed-feedback");
    if (isCorrect) {
      if (button) button.classList.add("correct");
      feedback.innerHTML = escapeHtml(t("speed.correctMsg", vars)) + speakButton(correct.speak, "inline-speak");
      feedback.className = "speed-feedback good";
    } else {
      if (button) button.classList.add("wrong");
      const correctButton = $(`.speed-option[data-id="${correct.id}"]`, host);
      if (correctButton) {
        correctButton.classList.add("correct");
        if (!correctButton.querySelector(".option-sub")) {
          const sub = document.createElement("span");
          sub.className = "option-sub";
          sub.textContent = correct.meaning;
          correctButton.appendChild(sub);
        }
      }
      feedback.innerHTML = escapeHtml(t("speed.wrongMsg", vars)) + speakButton(correct.speak, "inline-speak");
      feedback.className = "speed-feedback bad";
    }
  }

  function answerSpeed(optionId) {
    if (!state.speed.running || state.speed.answered) return;
    state.speed.answered = true;
    state.speed.picked = optionId;
    state.speed.total += 1;
    const correct = state.speed.question;
    const isCorrect = optionId === correct.id;
    if (isCorrect) state.speed.score += 1;
    else if (!state.speed.missed.some((item) => item.id === correct.id)) state.speed.missed.push(correct);
    showSpeedAnswer(optionId);
    updateSpeedStats();

    state.speed.transitionId = setTimeout(() => {
      if (state.speed.running) nextSpeedQuestion();
    }, isCorrect ? 520 : 900);
  }

  function endSpeed() {
    if (!state.speed.running && state.speed.time > 0) return;
    state.speed.running = false;
    clearInterval(state.speed.timerId);
    clearTimeout(state.speed.transitionId);
    state.speed.timerId = null;
    state.speed.transitionId = null;
    state.speed.time = Math.max(0, state.speed.time);
    const isNewBest = state.speed.score > state.speed.best;
    if (isNewBest) {
      state.speed.best = state.speed.score;
      writeRaw(STORAGE.best, String(state.speed.best));
    }
    state.speed.finished = true;
    state.speed.newBest = isNewBest;
    updateSpeedStats();
    $("#speed-game").hidden = true;
    $("#speed-end").hidden = false;
    renderSpeedEnd();
  }

  function renderSpeedEnd() {
    $("#speed-end-title").textContent = state.speed.newBest ? t("speed.newBest") : t("speed.timeUp");
    $("#speed-end-score").textContent = t(state.speed.score === 1 ? "speed.resultOne" : "speed.result", {
      score: state.speed.score,
      total: state.speed.total,
    });

    const missedHost = $("#speed-missed");
    if (!state.speed.total) {
      missedHost.innerHTML = `<p class="fineprint">${t("speed.noAnswers")}</p>`;
    } else if (!state.speed.missed.length) {
      missedHost.innerHTML = `<p class="fineprint">${t("speed.clean")}</p>`;
    } else {
      missedHost.innerHTML = state.speed.missed
        .map(
          (item) => `<span class="missed-item">${
            item.frame ? `<img src="${item.frame.src}" alt="">` : ""
          }<span class="missed-text">${escapeHtml(item.name)}<small>${escapeHtml(item.meaning)}</small></span></span>`
        )
        .join("");
    }
  }

  /* ---------------- glossary ---------------- */

  /* Opens the glossary on one term and flashes it, so a word chip on a card
     is a way into the vocabulary rather than a dead end. */
  function gotoGlossary(term) {
    const key = term.trim().toLowerCase();
    state.glossaryMode = "words";
    state.glossaryGroup = "all";
    state.glossarySearch = term;
    const input = $("#glossary-search");
    if (input) input.value = term;
    renderGlossaryChips();
    renderGlossaryMode();
    syncClearButtons();
    setView("glossary");
    const card = Array.from(document.querySelectorAll("#glossary-grid .glossary-card"))
      .find((el) => el.getAttribute("data-term") === key);
    if (!card) return;
    card.classList.add("is-target");
    card.scrollIntoView({ block: "center", behavior: "smooth" });
    setTimeout(() => card.classList.remove("is-target"), 2400);
  }

  /* The grammar behind the four examples: which words end a name, which open
     it, and what the particle and the numbers are doing. Counts are derived
     from the atlas, so the panel can never drift from the data. */
  /* What each kyu is. The description is the federation's programme; the
     counts and the category chips are derived, so they cannot go stale. */
  function renderKyuGuide() {
    const host = $("#kyu-guide-body");
    if (!host) return;
    host.innerHTML = GRADES.map((grade) => {
      const pool = TECH.filter((tech) => tech.grade_id === grade.id).sort(
        (a, b) => (a.order || 0) - (b.order || 0)
      );
      const known = pool.filter((tech) => isKnown(tech.id)).length;
      const pct = pool.length ? Math.round((known / pool.length) * 100) : 0;
      const checklist = DATA.categories
        .map((cat) => ({ cat, items: pool.filter((tech) => tech.category === cat.id) }))
        .filter((group) => group.items.length)
        .map(({ cat, items }) => `
          <div class="kyu-group">
            <p class="kyu-group-label" style="--cat-color:${cat.color}">${escapeHtml(cat.name)}<b>${items.length}</b></p>
            <div class="kyu-items">${items
              .map((tech) => {
                const on = isKnown(tech.id);
                const pending = !(tech.frames && tech.frames.length);
                return `<div class="kyu-item ${on ? "is-known" : ""}">
                  <button type="button" class="kyu-tick" data-exam-tick="${tech.id}" aria-pressed="${on}" aria-label="${escapeHtml(tech.japanese + " — " + t("modal.markKnown"))}">✓</button>
                  <button type="button" class="kyu-name" data-open-card="${tech.id}">${escapeHtml(tech.japanese)}</button>
                  ${pending ? `<span class="kyu-pending" title="${escapeHtml(t("kyu.pending"))}">◦</span>` : ""}
                </div>`;
              })
              .join("")}</div>
          </div>`)
        .join("");
      return `
        <article class="kyu-card" data-kyu="${grade.id}" style="--belt-color:${grade.color}">
          <div class="kyu-card-top">
            <span class="kyu-dot" aria-hidden="true"></span>
            <h4>${escapeHtml(t("grade." + grade.id))}</h4>
            <span class="kyu-count" data-kyu-count>${known} / ${pool.length}</span>
          </div>
          <p class="kyu-desc">${escapeHtml(t("kyu." + grade.id))}</p>
          <div class="kyu-bar"><i data-kyu-bar style="width:${pct}%"></i></div>
          <div class="kyu-checklist">${checklist}</div>
        </article>`;
    }).join("");
  }

  /* A tick updates only the counters, so the list never jumps under the thumb. */
  function refreshExamCounts() {
    $$("#kyu-guide-body .kyu-card").forEach((card) => {
      const id = card.getAttribute("data-kyu");
      const pool = TECH.filter((tech) => tech.grade_id === id);
      const known = pool.filter((tech) => isKnown(tech.id)).length;
      const pct = pool.length ? Math.round((known / pool.length) * 100) : 0;
      const count = $("[data-kyu-count]", card);
      if (count) count.textContent = `${known} / ${pool.length}`;
      const bar = $("[data-kyu-bar]", card);
      if (bar) bar.style.width = `${pct}%`;
    });
  }

  function renderNameGrammar() {
    const host = $("#grammar-rules");
    if (!host) return;
    const endings = new Map();
    const openings = new Map();
    const bump = (map, key) => {
      const entry = map.get(key) || { n: 0 };
      entry.n += 1;
      map.set(key, entry);
    };
    TECH.forEach((tech) => {
      const parts = wordParts(tech);
      if (!parts.length) return;
      bump(endings, parts[parts.length - 1].word.toLowerCase());
      if (parts.length > 1) bump(openings, parts[0].word.toLowerCase());
    });

    const words = (map, limit) =>
      Array.from(map.entries())
        .sort((a, b) => b[1].n - a[1].n)
        .slice(0, limit)
        .map(([word, info]) => {
          const term = glossaryForWord(word);
          return `<button type="button" class="grammar-word" data-gloss="${escapeHtml(term ? term.term : word)}">
            <b>${escapeHtml(word)}</b>${
              term && term.reading ? `<span class="word-kanji">${escapeHtml(term.reading)}</span>` : ""
            }${kanaFor(word) ? `<span class="kana">${escapeHtml(kanaFor(word))}</span>` : ""}
            <span class="grammar-meaning">${escapeHtml(term ? pick(term, "meaning") : "")}</span>
            <span class="grammar-count" title="${escapeHtml(t("grammar.count", { n: info.n }))}">${info.n}</span>
          </button>`;
        })
        .join("");

    const rule = (title, copy, list) => `
      <div class="grammar-rule">
        <h4>${title}</h4>
        <p>${copy}</p>
        ${list ? `<div class="grammar-words">${list}</div>` : ""}
      </div>`;

    host.innerHTML = [
      `<p class="grammar-lead">${escapeHtml(t("grammar.lead"))}</p>`,
      rule(t("grammar.familyTitle"), t("grammar.familyCopy"), words(endings, 10)),
      rule(t("grammar.leadTitle"), t("grammar.leadCopy"), words(openings, 8)),
      rule(t("grammar.particleTitle"), t("grammar.particleCopy")),
      rule(t("grammar.numbersTitle"), t("grammar.numbersCopy")),
    ].join("");
  }

  function renderGlossaryChips() {
    const host = $("#glossary-chips");
    if (!host) return;
    const groups = [
      { id: "all", label: t("glossary.all") },
      { id: "basics", label: t("glossary.basics") },
      { id: "categories", label: t("glossary.categories") },
      { id: "name-parts", label: t("glossary.nameParts") },
    ];
    const counts = GLOSSARY.reduce((acc, item) => {
      acc[item.group] = (acc[item.group] || 0) + 1;
      return acc;
    }, {});
    host.innerHTML = groups
      .map(
        (group) =>
          `<button class="chip ${state.glossaryGroup === group.id ? "active" : ""}" data-group="${group.id}">${group.label} <span class="chip-count">${
            group.id === "all" ? GLOSSARY.length : counts[group.id] || 0
          }</span></button>`
      )
      .join("");
  }

  /* Two jobs in one view, so they get two modes: looking a word up, and
     reading about how the names and the belts work. */
  function renderGlossaryMode() {
    const guide = state.glossaryMode === "guide";
    const words = $("#glossary-words");
    const guideHost = $("#glossary-guide");
    if (words) words.hidden = guide;
    if (guideHost) guideHost.hidden = !guide;
    const modeButton = $("#glossary-mode");
    if (modeButton) {
      modeButton.setAttribute("aria-pressed", String(guide));
      modeButton.setAttribute("title", t(guide ? "glossary.toWords" : "glossary.toGuide"));
    }
  }

  function setGlossaryMode(mode) {
    if (mode !== "words" && mode !== "guide") return;
    state.glossaryMode = mode;
    writeRaw(STORAGE.glossaryMode, mode);
    renderGlossaryMode();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function renderGlossary() {
    const host = $("#glossary-grid");
    const empty = $("#glossary-empty");
    const query = state.glossarySearch.trim().toLowerCase();
    const items = GLOSSARY.filter((item) => {
      if (state.glossaryGroup !== "all" && item.group !== state.glossaryGroup) return false;
      if (!query) return true;
      return [item.term, item.reading, item.meaning, item.meaning_es, item.note, item.note_es]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
    host.innerHTML = items
      .map((item) => {
        const ids = techniquesForTerm(item.term);
        const uses = ids.length
          ? `<div class="glossary-uses">
              <p class="glossary-uses-label">${escapeHtml(t("glossary.uses", { n: ids.length }))}</p>
              <div class="glossary-uses-list">${ids
                .map((id) => {
                  const tech = TECH_BY_ID[id];
                  return tech
                    ? `<button type="button" class="glossary-use" data-open-card="${id}">${escapeHtml(tech.japanese)}</button>`
                    : "";
                })
                .join("")}</div>
            </div>`
          : "";
        return `
        <article class="glossary-card" data-term="${escapeHtml(item.term.trim().toLowerCase())}">
          <div class="glossary-term">
            <h3>${item.term} ${speakButton(item.term)}</h3>
            <span class="glossary-reading">${item.reading}${kanaFor(item.term) ? `<span class="kana">${escapeHtml(kanaFor(item.term))}</span>` : ""}</span>
          </div>
          <p class="glossary-meaning">${escapeHtml(pick(item, "meaning"))}</p>
          <p class="glossary-note">${escapeHtml(pick(item, "note"))}</p>
          ${uses}
        </article>`;
      })
      .join("");
    empty.hidden = items.length > 0;
  }

  /* ---------------- events ---------------- */

  function bindEvents() {
    $$(".tab").forEach((tab) => {
      tab.addEventListener("click", () => setView(tab.getAttribute("data-view")));
    });

    // Browse (delegated, so the inline controls and the sheet stay in step)
    document.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-cat]");
      if (!chip) return;
      state.filterCategory = chip.getAttribute("data-cat");
      renderCategoryChips();
      renderBrowse();
    });

    document.addEventListener("input", (event) => {
      const el = event.target;
      if (el && el.matches && el.matches('input[type="search"]')) syncClearButtons();
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-clear]");
      if (!button) return;
      const input = document.getElementById(button.getAttribute("data-clear"));
      if (!input) return;
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.focus();
    });

    $("#search").addEventListener("input", (event) => {
      state.search = event.target.value;
      renderBrowse();
    });

    $$("#only-unknown, #only-unknown-sheet").forEach((box) => {
      box.addEventListener("change", (event) => setOnlyUnknown(event.target.checked));
    });

    document.addEventListener("click", (event) => {
      const chip = event.target.closest("[data-grade]");
      if (!chip) return;
      setGrade(chip.getAttribute("data-grade"));
      closeSheet();
    });

    // The exam checklist: tick a technique off its kyu, and every other view
    // that shows the same state updates with it.
    document.addEventListener("click", (event) => {
      const tick = event.target.closest("[data-exam-tick]");
      if (!tick) return;
      const id = tick.getAttribute("data-exam-tick");
      const next = !isKnown(id);
      setKnown(id, next);
      tick.setAttribute("aria-pressed", String(next));
      const item = tick.closest(".kyu-item");
      if (item) item.classList.toggle("is-known", next);
      refreshExamCounts();
      renderBrowse();
      renderToday();
      renderFlash();
    });

    document.addEventListener("click", (event) => {
      const button = event.target.closest("[data-lang]");
      if (button) setLang(button.getAttribute("data-lang"));
    });

    // Phone sheets
    [["scope-btn", "sheet-belt"], ["filters-btn", "sheet-filters"], ["settings-btn", "sheet-settings"]]
      .forEach(([buttonId, sheetId]) => {
        const button = document.getElementById(buttonId);
        if (button) button.addEventListener("click", () => openSheet(sheetId));
      });

    document.addEventListener("click", (event) => {
      if (event.target.closest("[data-sheet-close]")) closeSheet();
      if (event.target.closest("#clear-filters-sheet")) closeSheet();
    });

    $$("#theme-seg [data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => applyTheme(button.getAttribute("data-theme-choice"), true));
    });

    $("#flash-deck").addEventListener("click", (event) => {
      const button = event.target.closest("[data-deck]");
      if (button) setDeck(button.getAttribute("data-deck"));
    });

    // A word chip opens its glossary entry; a glossary entry opens the card.
    document.addEventListener(
      "click",
      (event) => {
        const gloss = event.target.closest("[data-gloss]");
        if (gloss) {
          event.stopPropagation();
          event.preventDefault();
          gotoGlossary(gloss.getAttribute("data-gloss"));
          return;
        }
        const opener = event.target.closest("[data-open-card]");
        if (opener) {
          event.stopPropagation();
          openModal(opener.getAttribute("data-open-card"));
        }
      },
      true
    );

    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        const gloss = event.target.closest ? event.target.closest("[data-gloss]") : null;
        if (!gloss) return;
        event.preventDefault();
        event.stopPropagation();
        gotoGlossary(gloss.getAttribute("data-gloss"));
      },
      true
    );

    // Pull a sheet or the card down to dismiss it.
    enableDragToClose($("#modal"), $(".modal-panel"), closeModal);
    $$(".sheet").forEach((sheet) => {
      enableDragToClose(sheet, sheet.querySelector(".sheet-panel"), closeSheet);
    });

    const themeToggle = $("#theme-toggle");
    if (themeToggle) {
      themeToggle.addEventListener("click", () => {
        const next = state.theme === "auto" ? "light" : state.theme === "light" ? "dark" : "auto";
        applyTheme(next, true);
      });
    }

    document.addEventListener(
      "click",
      (event) => {
        const button = event.target.closest("[data-speak]");
        if (!button) return;
        event.preventDefault();
        event.stopPropagation();
        const utterance = speak(button.getAttribute("data-speak"));
        if (utterance) {
          button.classList.add("is-speaking");
          const clear = () => button.classList.remove("is-speaking");
          utterance.onend = clear;
          utterance.onerror = clear;
          setTimeout(clear, 3000);
        }
      },
      true
    );

    $("#clear-filters").addEventListener("click", clearBrowseFilters);

    $("#browse-grid").addEventListener("click", (event) => {
      const card = event.target.closest(".tech-card");
      if (card) openModal(card.getAttribute("data-id"));
    });

    $("#browse-grid").addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const card = event.target.closest(".tech-card");
      if (!card) return;
      event.preventDefault();
      openModal(card.getAttribute("data-id"));
    });

    // Modal
    $("#modal").addEventListener("click", (event) => {
      if (event.target.closest("[data-close='modal']")) {
        closeModal();
        return;
      }
      const thumb = event.target.closest("[data-frame]");
      if (thumb) {
        selectModalFrame(Number(thumb.getAttribute("data-frame")));
        return;
      }
      const step = event.target.closest("[data-stage-step]");
      if (step) {
        stepModalFrame(Number(step.getAttribute("data-stage-step")));
        return;
      }
      const playButton = event.target.closest("[data-play-source]");
      if (playButton) {
        playStageSource(playButton);
        return;
      }
      const rateButton = event.target.closest("[data-rate]");
      if (rateButton) {
        state.videoRate = Number(rateButton.getAttribute("data-rate")) || 1;
        rateButton.parentElement.querySelectorAll("[data-rate]").forEach((b) => {
          const on = Number(b.getAttribute("data-rate")) === state.videoRate;
          b.classList.toggle("active", on);
          b.setAttribute("aria-pressed", String(on));
        });
        if (stagePlayer) {
          try { stagePlayer.setPlaybackRate(state.videoRate); } catch (_) { /* ignore */ }
        }
        return;
      }
      const knownButton = event.target.closest("[data-known-toggle]");
      if (knownButton) toggleKnownFromModal(knownButton);
    });

    // Flashcards
    let suppressFlip = false;
    $("#flashcard").addEventListener("click", (event) => {
      if (suppressFlip) return;
      if (event.target.closest("[data-open-card]")) {
        event.stopPropagation();
        openModal(event.target.closest("[data-open-card]").getAttribute("data-open-card"));
        return;
      }
      if (event.target.closest("[data-flash-mark]")) {
        event.stopPropagation();
        toggleKnownMark();
        return;
      }
      const dot = event.target.closest("[data-dot]");
      if (dot) {
        event.stopPropagation();
        const track = $("#flashcard .flash-track");
        if (track) {
          track.scrollTo({ left: Number(dot.getAttribute("data-dot")) * track.clientWidth, behavior: "smooth" });
        }
        return;
      }
      // Reading or swiping the frames must not flip the card.
      if (event.target.closest("[data-gallery]")) return;
      flipFlash();
    });

    // Keep the dots in step with the swiped frame.
    $("#flashcard").addEventListener(
      "scroll",
      (event) => {
        const track = event.target;
        if (track && track.classList && track.classList.contains("flash-track")) {
          syncGalleryDots(track);
        }
      },
      true
    );

    // Swiping is the phone's way of moving between cards; the chevrons stay
    // for desktop and for anyone using a keyboard.
    let swipeFrom = null;
    $("#flashcard").addEventListener(
      "touchstart",
      (event) => {
        swipeFrom = event.target.closest("[data-gallery]") ? null : event.changedTouches[0];
      },
      { passive: true }
    );
    $("#flashcard").addEventListener(
      "touchend",
      (event) => {
        if (!swipeFrom) return;
        const end = event.changedTouches[0];
        const dx = end.clientX - swipeFrom.clientX;
        const dy = end.clientY - swipeFrom.clientY;
        swipeFrom = null;
        if (Math.abs(dx) < 55 || Math.abs(dx) < Math.abs(dy) * 1.6) return;
        // A swipe must not also register as a tap-to-flip.
        suppressFlip = true;
        setTimeout(() => { suppressFlip = false; }, 400);
        moveFlash(dx < 0 ? 1 : -1);
      },
      { passive: true }
    );

    $("#flashcard").addEventListener("keydown", (event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        event.stopPropagation();
        flipFlash();
      }
    });

    $("#flash-prev").addEventListener("click", () => moveFlash(-1));
    $("#flash-next").addEventListener("click", () => moveFlash(1));
    $("#flash-flip").addEventListener("click", flipFlash);
    $("#flash-shuffle").addEventListener("click", shuffleFlash);
    $("#flash-shuffle-m").addEventListener("click", shuffleFlash);
    $("#flash-known").addEventListener("change", toggleFlashKnown);
    // Phone loop: one action that follows the card, plus a quiet mark toggle.
    $("#flash-primary-m").addEventListener("click", () => (state.flashFlipped ? moveFlash(1) : flipFlash()));

    $("#flash-swap").addEventListener("click", () => {
      setFlashMode(state.flashMode === "image" ? "name" : "image");
    });

    // Speed
    $("#speed-start-btn").addEventListener("click", startSpeed);
    $("#speed-again").addEventListener("click", startSpeed);

    $("#speed-deck").addEventListener("click", (event) => {
      const button = event.target.closest("[data-deck]");
      if (button) setDeck(button.getAttribute("data-deck"));
    });

    $("#speed-swap").addEventListener("click", () => {
      setSpeedDir(state.speed.dir === "picture" ? "name" : "picture");
      if (state.speed.running) {
        stopSpeedToStart();
      }
    });

    // Training rounds
    $("#speed-mode").addEventListener("click", (event) => {
      const button = event.target.closest("[data-smode]");
      if (button) setSpeedMode(button.getAttribute("data-smode"));
    });
    $("#speed-rounds").addEventListener("click", (event) => {
      const step = event.target.closest("[data-cfg]");
      if (step) {
        adjustRoundsCfg(step.getAttribute("data-cfg"), Number(step.getAttribute("data-delta")));
      }
    });
    $("#cfg-pairs").addEventListener("change", (event) => {
      state.rounds.pairs = event.target.checked;
      saveRoundsCfg();
    });
    $("#rounds-start-btn").addEventListener("click", startRounds);
    $("#rounds-test").addEventListener("click", () => {
      // play the whole count-in, exactly as a session opens
      playNum(4);
      [3, 2, 1].forEach((n, i) => setTimeout(() => playNum(n), (i + 1) * 1000));
      setTimeout(() => playWord("start"), 4000);
    });
    $("#rounds-again").addEventListener("click", stopRoundsToStart);
    $("#rounds-stop").addEventListener("click", stopRoundsToStart);
    $("#rounds-pick-btn").addEventListener("click", openRoundsSheet);
    $("#rounds-picks").addEventListener("change", (event) => {
      const input = event.target.closest("[data-pick]");
      if (input) toggleRoundsPick(input);
    });
    $("#rounds-pick-all").addEventListener("click", () => setRoundsPicks(null));
    $("#rounds-pick-none").addEventListener("click", () => setRoundsPicks([]));

    $("#speed-options").addEventListener("click", (event) => {
      const option = event.target.closest(".speed-option");
      if (!option) return;
      answerSpeed(option.getAttribute("data-id"));
    });

    // Glossary
    $("#glossary-mode").addEventListener("click", () => {
      setGlossaryMode(state.glossaryMode === "guide" ? "words" : "guide");
    });

    $("#glossary-back").addEventListener("click", () => setGlossaryMode("words"));

    $("#glossary-chips").addEventListener("click", (event) => {
      const chip = event.target.closest("[data-group]");
      if (!chip) return;
      state.glossaryGroup = chip.getAttribute("data-group");
      renderGlossaryChips();
      renderGlossary();
    });

    $("#glossary-search").addEventListener("input", (event) => {
      state.glossarySearch = event.target.value;
      renderGlossary();
    });

    // Global keyboard shortcuts
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && openSheetId) {
        closeSheet();
        return;
      }
      if (event.key === "Escape" && !$("#modal").hidden) {
        closeModal();
        return;
      }
      if (!$("#modal").hidden) {
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          stepModalFrame(-1);
          return;
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          stepModalFrame(1);
          return;
        }
      }
      const tag = (event.target.tagName || "").toLowerCase();
      const typing = tag === "input" || tag === "textarea" || tag === "select";
      if (typing) return;
      if (state.view !== "flashcards") return;
      if (event.key === " " && !event.target.closest("button")) {
        event.preventDefault();
        flipFlash();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        moveFlash(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        moveFlash(1);
      }
    });
  }

  /* ---------------- init ---------------- */

  function routeFromHash() {
    const raw = location.hash.replace(/^#/, "");
    const hash = raw ? decodeURIComponent(raw) : "";
    if (hash.startsWith("card/")) {
      const id = hash.slice(5);
      if (!TECH_BY_ID[id]) return;
      if (state.view !== "browse") setView("browse", { updateHash: false });
      openModal(id, { updateHash: false });
      return;
    }
    if (VIEWS.includes(hash)) {
      closeModal();
      setView(hash, { updateHash: false });
    }
  }

  function preloadHeroes() {
    TECH.forEach((tech) => {
      const hero = heroFrame(tech);
      if (!hero) return;
      const img = new Image();
      img.src = hero.src;
    });
  }

  /* Install the offline shell where the browser allows it. From file:// there
     is no service worker, and the app still works; it just is not installable. */
  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    if (location.protocol !== "http:" && location.protocol !== "https:") return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("./sw.js").catch(() => {});
    });
  }

  function init() {
    if (LANGS.includes(queryParam("lang"))) writeRaw(STORAGE.lang, state.lang);
    if (queryParam("grade")) writeRaw(STORAGE.grade, state.grade);
    applyTheme(state.theme, false);
    try {
      const scheme = window.matchMedia("(prefers-color-scheme: dark)");
      const onSchemeChange = () => {
        if (state.theme === "auto") applyTheme("auto", false);
      };
      if (scheme.addEventListener) scheme.addEventListener("change", onSchemeChange);
      else if (scheme.addListener) scheme.addListener(onSchemeChange);
    } catch (_) {
      /* matchMedia is unavailable in some very old browsers */
    }
    applyI18n();
    renderBeltBar();
    renderCategoryChips();
    renderBrowse();
    renderGlossaryChips();
    renderGlossary();
    renderGlossaryCategories();
    renderNameGrammar();
    renderKyuGuide();
    renderGlossaryMode();
    renderToday();
    rebuildFlashOrder();
    renderFlash();
    readRoundsCfg();
    preloadRoundAudio();
    renderSpeedDir();
    renderSpeedMode();
    updateSpeedStats();
    bindEvents();
    routeFromHash();
    window.addEventListener("hashchange", routeFromHash);
    syncClearButtons();
    initVoices();
    preloadHeroes();
    registerServiceWorker();
  }

  if (queryParam("debug") === "1") {
    window.ATLAS_DEBUG = {
      japaneseText,
      speak,
      japaneseVoice,
      refreshVoices,
      getPlayer: () => stagePlayer,
      setVoices: (list) => {
        voiceCache = Array.isArray(list) ? list : [];
      },
    };
  }

  init();
})();
