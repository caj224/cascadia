import React, { useState, useEffect, useMemo, useRef } from "react";
import { store } from "./store.js";

/* ------------------------------------------------------------------ */
/* Domain                                                              */
/* ------------------------------------------------------------------ */

const ANIMALS = [
  { key: "bear", label: "Bear", color: "#6B4B3A" },
  { key: "elk", label: "Elk", color: "#8A7A2E" },
  { key: "salmon", label: "Salmon", color: "#B4453A" },
  { key: "hawk", label: "Hawk", color: "#3F6B7A" },
  { key: "fox", label: "Fox", color: "#C77A2B" },
];

const HABITATS = [
  { key: "mountain", label: "Mountains", color: "#6E7C8A" },
  { key: "forest", label: "Peas", color: "#35604A" },
  { key: "prairie", label: "Prairie", color: "#C0A040" },
  { key: "wetland", label: "Moss", color: "#7C8A47" },
  { key: "river", label: "River", color: "#4E7FA8" },
];

const CARDS = ["A", "B", "C", "D", "E", "F", "G"];
const TOTAL_COMBOS = Math.pow(CARDS.length, ANIMALS.length); // 16807
const STORE_KEY = "cascadia:v1";

/* The two regulars. Everything head-to-head keys off these names,
   matched case-insensitively so "caleb" and "Caleb" are one person. */
const REGULARS = [
  { key: "caleb", label: "Caleb", color: "#35604A" },
  { key: "allison", label: "Allison", color: "#B4453A" },
];

const nameKey = (n) => String(n || "").trim().toLowerCase();
const regularFor = (n) => REGULARS.find((r) => r.key === nameKey(n)) || null;
/* A regular always shows under their canonical spelling, however it was typed. */
const displayName = (n) => (regularFor(n) ? regularFor(n).label : n);
const habitatLabel = (k) => {
  const h = HABITATS.find((x) => x.key === k);
  return h ? h.label.toLowerCase() : "";
};

/* Habitat majority bonus.
   Solo: 2 pts per habitat with a landscape of 7+.
   2p:   largest 2, tie 1 each, no second-place bonus.
   3-4p: largest 3, unique second 1. Two-way tie for largest 2 each,
         3+ way tie 1 each, ties for second score 0. */
function habitatBonus(sizes) {
  const n = sizes.length;
  if (n === 1) return [sizes[0] >= 7 ? 2 : 0];
  if (n === 2) {
    if (sizes[0] === sizes[1]) return [1, 1];
    return sizes[0] > sizes[1] ? [2, 0] : [0, 2];
  }
  const max = Math.max(...sizes);
  const leaders = sizes.filter((s) => s === max).length;
  if (leaders >= 3) return sizes.map((s) => (s === max ? 1 : 0));
  if (leaders === 2) return sizes.map((s) => (s === max ? 2 : 0));
  const rest = sizes.filter((s) => s !== max);
  const second = rest.length ? Math.max(...rest) : -1;
  const secondCount = sizes.filter((s) => s === second).length;
  return sizes.map((s) =>
    s === max ? 3 : s === second && secondCount === 1 ? 1 : 0
  );
}

function scoreGame(players) {
  const bonuses = {};
  HABITATS.forEach((h) => {
    // Blank on every sheet means the habitat hasn't been scored yet — that is
    // not a tie at zero, so nobody earns the tie bonus for it.
    const entered = players.some((p) => String(p.habitat[h.key]).trim() !== "");
    bonuses[h.key] = entered
      ? habitatBonus(players.map((p) => num(p.habitat[h.key])))
      : players.map(() => 0);
  });
  return players.map((p, i) => {
    const wildlife = ANIMALS.reduce((s, a) => s + num(p.wildlife[a.key]), 0);
    const landscape = HABITATS.reduce((s, h) => s + num(p.habitat[h.key]), 0);
    const bonus = HABITATS.reduce((s, h) => s + bonuses[h.key][i], 0);
    const nature = num(p.nature);
    return {
      wildlife,
      landscape,
      bonus,
      // Pinecones are stored under the original `nature` key so old logs load.
      nature,
      // The full landscape score: sizes plus the majority bonuses they earn.
      landscapeTotal: landscape + bonus,
      bonusByHabitat: HABITATS.reduce(
        (o, h) => ((o[h.key] = bonuses[h.key][i]), o),
        {}
      ),
      total: wildlife + landscape + bonus + nature,
    };
  });
}

/* Who is ahead. Highest total takes it; level totals are broken by pinecones,
   and level on both is a real tie. */
function compareScore(a, b) {
  if (a.total !== b.total) return a.total - b.total;
  return a.nature - b.nature;
}

/* Indexes of everyone sharing top spot — more than one means a tie. */
function winnersOf(scores) {
  if (!scores.length) return [];
  let top = [0];
  scores.forEach((s, i) => {
    if (i === 0) return;
    const c = compareScore(s, scores[top[0]]);
    if (c > 0) top = [i];
    else if (c === 0) top.push(i);
  });
  return top;
}

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

const comboKey = (cards) => ANIMALS.map((a) => cards[a.key]).join("");
const pairKey = (i, j, li, lj) => `${i}${j}${li}${lj}`;
const comboLabel = (cards) => comboKey(cards).split("").join("·");

function emptyPlayer(name, isYou) {
  return {
    name,
    isYou: !!isYou,
    wildlife: Object.fromEntries(ANIMALS.map((a) => [a.key, ""])),
    habitat: Object.fromEntries(HABITATS.map((h) => [h.key, ""])),
    nature: "",
  };
}

function defaultPlayers() {
  return [emptyPlayer("Caleb", true), emptyPlayer("Allison", false)];
}

function newDraft() {
  return {
    date: new Date().toISOString().slice(0, 10),
    cards: Object.fromEntries(ANIMALS.map((a) => [a.key, "A"])),
    players: defaultPlayers(),
    megaC: false,
  };
}

/* ------------------------------------------------------------------ */
/* Coverage math                                                       */
/* ------------------------------------------------------------------ */

function buildCoverage(games) {
  const played = new Set();
  const comboCount = new Map();
  const cardCount = Object.fromEntries(
    ANIMALS.map((a) => [a.key, Object.fromEntries(CARDS.map((c) => [c, 0]))])
  );
  // Card-pair counts are internal only: they let suggestCombo spread its
  // picks around instead of repeating the same two cards together.
  const pairs = new Map();

  games.forEach((g) => {
    const k = comboKey(g.cards);
    played.add(k);
    comboCount.set(k, (comboCount.get(k) || 0) + 1);
    ANIMALS.forEach((a) => {
      if (cardCount[a.key][g.cards[a.key]] !== undefined)
        cardCount[a.key][g.cards[a.key]]++;
    });
    for (let i = 0; i < ANIMALS.length; i++)
      for (let j = i + 1; j < ANIMALS.length; j++) {
        const pk = pairKey(i, j, g.cards[ANIMALS[i].key], g.cards[ANIMALS[j].key]);
        pairs.set(pk, (pairs.get(pk) || 0) + 1);
      }
  });

  return { played, comboCount, cardCount, pairs };
}

function suggestCombo(cov) {
  const { played, pairs } = cov;
  let best = null;
  let bestScore = -1;
  for (let t = 0; t < 600; t++) {
    const pick = [];
    for (let a = 0; a < ANIMALS.length; a++) {
      let bestLetters = [];
      let bestGain = -1;
      for (const L of CARDS) {
        let gain = 0;
        for (let b = 0; b < a; b++)
          if (!pairs.has(pairKey(b, a, pick[b], L))) gain++;
        if (gain > bestGain) {
          bestGain = gain;
          bestLetters = [L];
        } else if (gain === bestGain) bestLetters.push(L);
      }
      pick.push(bestLetters[Math.floor(Math.random() * bestLetters.length)]);
    }
    if (played.has(pick.join(""))) continue;
    let score = 0;
    for (let i = 0; i < ANIMALS.length; i++)
      for (let j = i + 1; j < ANIMALS.length; j++)
        if (!pairs.has(pairKey(i, j, pick[i], pick[j]))) score++;
    if (score > bestScore) {
      bestScore = score;
      best = pick;
    }
    if (score === 10) break;
  }
  if (!best) best = ANIMALS.map(() => CARDS[Math.floor(Math.random() * 7)]);
  return Object.fromEntries(ANIMALS.map((a, i) => [a.key, best[i]]));
}

function randomCombo(played) {
  for (let t = 0; t < 200; t++) {
    const c = Object.fromEntries(
      ANIMALS.map((a) => [a.key, CARDS[Math.floor(Math.random() * CARDS.length)]])
    );
    if (!played || !played.has(comboKey(c))) return c;
  }
  return Object.fromEntries(
    ANIMALS.map((a) => [a.key, CARDS[Math.floor(Math.random() * CARDS.length)]])
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

/* One row per player per game — the shape every stat below reads from.
   Games stay in storage order (newest first), so streaks read top-down. */
function buildRows(games) {
  const rows = [];
  games.forEach((g) => {
    if (!g.players || !g.players.length) return;
    const s = scoreGame(g.players);
    const totals = s.map((x) => x.total);
    const top = winnersOf(s);
    const shared = top.length > 1;
    g.players.forEach((p, i) => {
      rows.push({
        gameId: g.id,
        date: g.date,
        cards: g.cards,
        name: p.name,
        key: nameKey(p.name),
        megaC: !!g.megaC,
        players: g.players.length,
        won: top.includes(i) && !shared,
        tied: top.includes(i) && shared,
        margin: s[i].total - (totals.length > 1 ? Math.max(...sansOne(totals, i)) : 0),
        animals: Object.fromEntries(ANIMALS.map((a) => [a.key, num(p.wildlife[a.key])])),
        sizes: Object.fromEntries(HABITATS.map((h) => [h.key, num(p.habitat[h.key])])),
        biggest: biggestLandscape(p),
        ...s[i],
      });
    });
  });
  return rows;
}

const sansOne = (arr, i) => arr.filter((_, idx) => idx !== i);

/* The largest single run on a sheet, and which habitat it was. */
function biggestLandscape(p) {
  let best = { size: 0, key: HABITATS[0].key };
  HABITATS.forEach((h) => {
    const size = num(p.habitat[h.key]);
    if (size > best.size) best = { size, key: h.key };
  });
  return best;
}

/* Best row for a metric. Rows arrive newest-first, so a strict > keeps the
   most recent holder of a tied record. */
function recordFor(rows, get) {
  let best = null;
  rows.forEach((r) => {
    const v = get(r);
    if (best === null || v > best.value) best = { value: v, row: r };
  });
  return best;
}

function buildStats(games) {
  const rows = buildRows(games);
  /* Mega C games still count for wins and for combo coverage, but every
     score-based figure below reads `scored` instead of `rows`. */
  const scored = rows.filter((r) => !r.megaC);

  const records = {
    total: recordFor(scored, (r) => r.total),
    wildlife: recordFor(scored, (r) => r.wildlife),
    // "Total maps" is the five runs added up; landscapeTotal adds the bonuses.
    landscapeTotal: recordFor(scored, (r) => r.landscapeTotal),
    landscape: recordFor(scored, (r) => r.landscape),
    single: recordFor(scored, (r) => r.biggest.size),
    nature: recordFor(scored, (r) => r.nature),
    margin: recordFor(
      scored.filter((r) => r.players > 1 && r.won),
      (r) => r.margin
    ),
    animals: Object.fromEntries(
      ANIMALS.map((a) => [a.key, recordFor(scored, (r) => r.animals[a.key])])
    ),
    habitats: Object.fromEntries(
      HABITATS.map((h) => [h.key, recordFor(scored, (r) => r.sizes[h.key])])
    ),
  };

  /* Head to head: only games where both regulars sat down. */
  const h2h = {
    games: 0,
    scored: 0,
    wins: Object.fromEntries(REGULARS.map((r) => [r.key, 0])),
    ties: 0,
    points: Object.fromEntries(REGULARS.map((r) => [r.key, 0])),
    best: Object.fromEntries(REGULARS.map((r) => [r.key, 0])),
    streak: { key: null, n: 0 },
  };
  const byGame = new Map();
  rows.forEach((r) => {
    if (!byGame.has(r.gameId)) byGame.set(r.gameId, []);
    byGame.get(r.gameId).push(r);
  });
  const h2hGames = [];
  byGame.forEach((rs, id) => {
    const seats = REGULARS.map((reg) => rs.find((r) => r.key === reg.key));
    if (seats.some((s) => !s)) return;
    h2hGames.push({ id, seats, date: seats[0].date });
  });
  // byGame preserves rows order, which is games order: newest first.
  h2hGames.forEach(({ seats }) => {
    h2h.games++;
    const leaders = winnersOf(seats).map((i) => seats[i]);
    if (leaders.length > 1) h2h.ties++;
    else h2h.wins[leaders[0].key]++;
    if (!seats[0].megaC) {
      h2h.scored++;
      seats.forEach((s) => {
        h2h.points[s.key] += s.total;
        if (s.total > h2h.best[s.key]) h2h.best[s.key] = s.total;
      });
    }
  });
  for (const { seats } of h2hGames) {
    const leaders = winnersOf(seats).map((i) => seats[i]);
    if (leaders.length > 1) {
      // A tie at the top of the log is worth saying out loud.
      if (h2h.streak.key === null) h2h.lastTied = true;
      break;
    }
    if (h2h.streak.key === null) h2h.streak.key = leaders[0].key;
    else if (h2h.streak.key !== leaders[0].key) break;
    h2h.streak.n++;
  }
  h2h.avg = Object.fromEntries(
    REGULARS.map((r) => [r.key, h2h.scored ? h2h.points[r.key] / h2h.scored : 0])
  );

  /* Per-player season line, including guests. */
  const people = new Map();
  rows.forEach((r) => {
    if (!people.has(r.key))
      people.set(r.key, {
        key: r.key,
        name: r.name,
        games: 0,
        wins: 0,
        ties: 0,
        scored: 0,
        sum: 0,
        best: 0,
      });
    const p = people.get(r.key);
    p.games++;
    if (r.won) p.wins++;
    if (r.tied) p.ties++;
    if (r.megaC) return;
    p.scored++;
    p.sum += r.total;
    if (r.total > p.best) p.best = r.total;
  });

  return {
    rows,
    scored,
    megaCount: games.filter((g) => g.megaC).length,
    records,
    h2h,
    people: [...people.values()].sort((a, b) => b.games - a.games),
  };
}

/* Mean wildlife points scored on each scoring card, optionally for one
   player. `min` guards against a single lucky game defining "best". */
function cardMeans(rows, playerKey) {
  const acc = Object.fromEntries(
    ANIMALS.map((a) => [a.key, Object.fromEntries(CARDS.map((c) => [c, { n: 0, sum: 0 }]))])
  );
  rows.forEach((r) => {
    if (playerKey && r.key !== playerKey) return;
    ANIMALS.forEach((a) => {
      const cell = acc[a.key][r.cards[a.key]];
      if (!cell) return;
      cell.n++;
      cell.sum += r.animals[a.key];
    });
  });
  const bestCard = {};
  ANIMALS.forEach((a) => {
    let win = null;
    CARDS.forEach((c) => {
      const cell = acc[a.key][c];
      if (!cell.n) return;
      const mean = cell.sum / cell.n;
      if (!win || mean > win.mean) win = { card: c, mean, n: cell.n };
    });
    bestCard[a.key] = win;
  });
  return { acc, bestCard };
}

/* ------------------------------------------------------------------ */
/* Hex primitive — the header mark                                     */
/* ------------------------------------------------------------------ */

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

const TABS = [
  ["home", "Home"],
  ["add", "Add game"],
  ["stats", "Stats"],
  ["log", "Log"],
];

export default function CascadiaTracker() {
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [games, setGames] = useState([]);
  const [tab, setTab] = useState("home");
  // The scorecard in progress lives here, not in LogGame, so switching
  // tabs mid-game doesn't throw away what you have typed.
  const [draft, setDraft] = useState(newDraft);
  const fileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await store.get(STORE_KEY);
        if (r && r.value) {
          const parsed = JSON.parse(r.value);
          if (Array.isArray(parsed.games)) setGames(parsed.games);
        }
      } catch (e) {
        // No saved data yet, or storage unavailable.
        try {
          await store.set(STORE_KEY, JSON.stringify({ games: [] }));
        } catch (e2) {
          setStorageOk(false);
        }
      }
      setReady(true);
    })();
  }, []);

  const persist = async (next) => {
    setGames(next);
    try {
      await store.set(STORE_KEY, JSON.stringify({ games: next }));
    } catch (e) {
      setStorageOk(false);
    }
  };

  const cov = useMemo(() => buildCoverage(games), [games]);
  const stats = useMemo(() => buildStats(games), [games]);

  const playCombo = (cards) => {
    setDraft((d) => ({ ...d, cards: { ...cards } }));
    setTab("add");
  };

  const exportJson = () => {
    const blob = new Blob([JSON.stringify({ games }, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `cascadia-log-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const importJson = (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        if (Array.isArray(parsed.games)) persist(parsed.games);
      } catch (err) {
        alert("That file isn't a Cascadia log export.");
      }
    };
    reader.readAsText(f);
    e.target.value = "";
  };

  return (
    <div className="cs-root">
      <style>{CSS}</style>

      <header className="cs-head">
        <div className="cs-mark" aria-hidden="true">
          <svg viewBox="0 0 40 36" width="30" height="27">
            {[0, 1, 2].map((i) => (
              <polygon
                key={i}
                points={hexPoints(11 + i * 9, 18 - (i % 2) * 7 + 3.5, 8)}
                fill={["#35604A", "#C0A040", "#4E7FA8"][i]}
              />
            ))}
          </svg>
        </div>
        <div>
          <h1>Cascadia log</h1>
          <p className="cs-sub">
            {games.length} game{games.length === 1 ? "" : "s"} recorded ·{" "}
            {REGULARS.map((r) => r.label).join(" & ")}
          </p>
        </div>
      </header>

      <nav className="cs-tabs">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            className={"cs-tab" + (tab === k ? " on" : "")}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!storageOk && (
        <p className="cs-warn">
          Saved data is unavailable in this session. Export your log before closing so
          nothing is lost.
        </p>
      )}

      {!ready ? (
        <p className="cs-empty">Loading your log…</p>
      ) : tab === "home" ? (
        <Home games={games} cov={cov} stats={stats} onPlay={playCombo} onGo={setTab} />
      ) : tab === "add" ? (
        <LogGame
          cov={cov}
          draft={draft}
          setDraft={setDraft}
          onSave={(g) => persist([g, ...games])}
        />
      ) : tab === "stats" ? (
        <Stats games={games} cov={cov} stats={stats} />
      ) : (
        <GamesList
          games={games}
          cov={cov}
          onDelete={(id) => persist(games.filter((g) => g.id !== id))}
        />
      )}

      <footer className="cs-foot">
        <button className="cs-ghost" onClick={exportJson}>
          Export log
        </button>
        <button className="cs-ghost" onClick={() => fileRef.current.click()}>
          Import log
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json"
          onChange={importJson}
          style={{ display: "none" }}
        />
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Home                                                                */
/* ------------------------------------------------------------------ */

function Home({ games, cov, stats, onPlay, onGo }) {
  const [pick, setPick] = useState(() => suggestCombo(cov));
  // Re-roll whenever the log changes so the suggestion is never one you played.
  useEffect(() => setPick(suggestCombo(cov)), [cov]);

  const pct = (cov.played.size / TOTAL_COMBOS) * 100;
  const { h2h } = stats;
  const streaker = REGULARS.find((r) => r.key === h2h.streak.key);
  const means = useMemo(() => cardMeans(stats.scored, null), [stats.scored]);

  return (
    <div>
      <section className="cs-panel cs-hero">
        <p className="cs-hero-label">Combos played</p>
        <p className="cs-hero-value mono">
          {cov.played.size.toLocaleString()}
          <span>/{TOTAL_COMBOS.toLocaleString()}</span>
        </p>
        <div className="cs-progress">
          <div
            className="cs-progress-fill"
            style={{ width: `${Math.max(pct, cov.played.size ? 0.6 : 0)}%` }}
          />
        </div>
        <p className="cs-hero-sub mono">
          {pct.toFixed(3)}% of every wildlife scoring-card combination
        </p>
      </section>

      <section className="cs-panel">
        <div className="cs-panel-head">
          <h2>Try this next</h2>
          <div className="cs-actions">
            <button className="cs-ghost sm" onClick={() => setPick(suggestCombo(cov))}>
              Another
            </button>
            <button className="cs-ghost sm" onClick={() => setPick(randomCombo(cov.played))}>
              Surprise me
            </button>
          </div>
        </div>
        <div className="cs-suggest">
          <div className="cs-suggest-cards">
            {ANIMALS.map((a) => (
              <div className="cs-suggest-card" key={a.key}>
                <span className="cs-suggest-letter mono" style={{ background: a.color }}>
                  {pick[a.key]}
                </span>
                <span className="cs-suggest-animal" style={{ color: a.color }}>
                  {a.label}
                </span>
              </div>
            ))}
          </div>
          <div className="cs-suggest-side">
            <p className="cs-legend">
              A combination you have never played.
            </p>
            <button className="cs-save sm" onClick={() => onPlay(pick)}>
              Score this game
            </button>
          </div>
        </div>
      </section>

      <section className="cs-panel">
        <div className="cs-panel-head">
          <h2>Head to head</h2>
          <p className="cs-legend">
            {h2h.games
              ? `${h2h.games} game${h2h.games === 1 ? "" : "s"} with both of you at the table.` +
                (h2h.games > h2h.scored
                  ? ` Averages skip ${h2h.games - h2h.scored} Mega C.`
                  : "")
              : "No games yet with both of you at the table."}
          </p>
        </div>
        <div className="cs-h2h">
          {REGULARS.map((r, i) => (
            <React.Fragment key={r.key}>
              {i === 1 && (
                <div className="cs-h2h-mid">
                  <span className="mono cs-h2h-games">
                    {h2h.games} game{h2h.games === 1 ? "" : "s"}
                    {h2h.ties
                      ? ` · ${h2h.ties} tie${h2h.ties === 1 ? "" : "s"}`
                      : ""}
                  </span>
                  <span className="cs-h2h-note">{streakLine(h2h, streaker)}</span>
                </div>
              )}
              <div className="cs-h2h-side">
                <span className="cs-h2h-name" style={{ color: r.color }}>
                  {r.label}
                </span>
                <span className="mono cs-h2h-w">{h2h.wins[r.key]}</span>
                <span className="cs-h2h-wlabel">
                  win{h2h.wins[r.key] === 1 ? "" : "s"}
                </span>
                <span className="cs-h2h-meta mono">
                  avg {h2h.games ? h2h.avg[r.key].toFixed(1) : "–"} · best{" "}
                  {h2h.best[r.key] || "–"}
                </span>
              </div>
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="cs-panel">
        <div className="cs-panel-head">
          <h2>Records</h2>
          <button className="cs-ghost sm" onClick={() => onGo("stats")}>
            All stats
          </button>
        </div>
        <div className="cs-rec-grid">
          <Record label="Highest score" rec={stats.records.total} />
          <Record label="Highest wildlife" rec={stats.records.wildlife} />
          <Record
            label="Highest single landscape"
            rec={stats.records.single}
            tag={(r) => habitatLabel(r.biggest.key)}
          />
          <Record label="Highest total maps" rec={stats.records.landscape} />
          <Record label="Highest total maps + bonuses" rec={stats.records.landscapeTotal} />
          <Record label="Most pinecones" rec={stats.records.nature} />
          <Record label="Biggest blowout" rec={stats.records.margin} prefix="+" />
        </div>
      </section>

      <section className="cs-panel">
        <div className="cs-panel-head">
          <h2>Best card per animal</h2>
          <p className="cs-legend">
            Highest average wildlife score, all players, Mega C excluded.
          </p>
        </div>
        <div className="cs-bestcards">
          {ANIMALS.map((a) => {
            const b = means.bestCard[a.key];
            return (
              <div className="cs-bestcard" key={a.key}>
                <span className="cs-bestcard-letter mono" style={{ background: b ? a.color : "#C3CBC2" }}>
                  {b ? b.card : "–"}
                </span>
                <span className="cs-bestcard-animal" style={{ color: a.color }}>
                  {a.label}
                </span>
                <span className="cs-bestcard-mean mono">
                  {b ? `${b.mean.toFixed(1)} avg` : "no data"}
                  {b ? <em className="cs-n">{b.n}</em> : null}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {!games.length && (
        <p className="cs-empty">
          Nothing recorded yet — <strong>Add game</strong> fills all of this in.
        </p>
      )}
    </div>
  );
}

/* What the middle of the head-to-head panel says under the game count. */
function streakLine(h2h, streaker) {
  if (!h2h.games) return "no games yet";
  if (h2h.lastTied) return "last game tied";
  if (!streaker) return "";
  if (h2h.streak.n === 1) return `${streaker.label} won last`;
  return `${streaker.label} won last ${h2h.streak.n}`;
}

function Record({ label, rec, prefix = "", color, tag }) {
  const tagText = rec && tag ? tag(rec.row) : null;
  return (
    <div className="cs-rec">
      <span className="cs-stat-label" style={color ? { color } : undefined}>
        {label}
      </span>
      <span className="cs-rec-value mono">
        {rec ? `${prefix}${rec.value}` : "–"}
        {tagText ? <em className="cs-rec-tag">{tagText}</em> : null}
      </span>
      {rec ? (
        <span className="cs-rec-who">
          <strong style={regularFor(rec.row.name) ? { color: regularFor(rec.row.name).color } : undefined}>
            {displayName(rec.row.name)}
          </strong>
          <span className="mono"> · {rec.row.date} · {comboLabel(rec.row.cards)}</span>
        </span>
      ) : (
        <span className="cs-rec-who">no games yet</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add game                                                            */
/* ------------------------------------------------------------------ */

function LogGame({ cov, draft, setDraft, onSave }) {
  const { date, cards, players, megaC } = draft;
  const [saved, setSaved] = useState(false);

  const setDate = (v) => setDraft((d) => ({ ...d, date: v }));
  const setCards = (v) => setDraft((d) => ({ ...d, cards: v }));
  const setMegaC = (v) => setDraft((d) => ({ ...d, megaC: v }));
  const setPlayers = (fn) =>
    setDraft((d) => ({ ...d, players: typeof fn === "function" ? fn(d.players) : fn }));

  const key = comboKey(cards);
  const timesPlayed = cov.comboCount.get(key) || 0;
  const scores = scoreGame(players);
  const leaders = winnersOf(scores);


  const setCount = (n) => {
    setPlayers((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n) {
        const fallback = REGULARS[next.length] ? REGULARS[next.length].label : `Player ${next.length + 1}`;
        next.push(emptyPlayer(fallback, false));
      }
      if (!next.some((p) => p.isYou)) next[0] = { ...next[0], isYou: true };
      return next;
    });
  };

  const patch = (i, fn) =>
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? fn(p) : p)));

  const save = () => {
    onSave({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      megaC: !!megaC,
      cards: { ...cards },
      players: players.map((p) => ({
        ...p,
        wildlife: { ...p.wildlife },
        habitat: { ...p.habitat },
      })),
    });
    setPlayers((prev) => prev.map((p) => emptyPlayer(p.name, p.isYou)));
    setMegaC(false); // classify each game on its own, never by inheritance
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);
  };

  return (
    <section>
      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Scoring cards in play</h2>
          <div className="cs-actions">
            <button className="cs-ghost sm" onClick={() => setCards(randomCombo(null))}>
              Random
            </button>
            <button className="cs-ghost sm" onClick={() => setCards(suggestCombo(cov))}>
              Fresh combo
            </button>
          </div>
        </div>

        <div className="cs-picker">
          {ANIMALS.map((a) => (
            <div className="cs-picker-row" key={a.key}>
              <span className="cs-animal" style={{ color: a.color }}>
                {a.label}
              </span>
              <div className="cs-letters">
                {CARDS.map((L) => {
                  const on = cards[a.key] === L;
                  return (
                    <button
                      key={L}
                      className={"cs-letter" + (on ? " on" : "")}
                      style={on ? { background: a.color, borderColor: a.color } : undefined}
                      onClick={() => setCards({ ...cards, [a.key]: L })}
                      aria-pressed={on}
                    >
                      <span>{L}</span>
                      <em>{cov.cardCount[a.key][L] || 0}</em>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <p className={"cs-status" + (timesPlayed ? " repeat" : "")}>
          <strong className="mono">{comboLabel(cards)}</strong>
          {timesPlayed === 0
            ? " is new to you."
            : ` has come up ${timesPlayed} time${timesPlayed === 1 ? "" : "s"} before.`}
        </p>
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Scores</h2>
          <div className="cs-actions">
            <label className="cs-date">
              <span>Played</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
            <div className="cs-seg">
              {[1, 2, 3, 4].map((n) => (
                <button
                  key={n}
                  className={"cs-segbtn" + (players.length === n ? " on" : "")}
                  onClick={() => setCount(n)}
                >
                  {n}p
                </button>
              ))}
            </div>
            <label className="cs-mega">
              <input
                type="checkbox"
                checked={!!megaC}
                onChange={(e) => setMegaC(e.target.checked)}
              />
              <span>Mega C?</span>
            </label>
          </div>
        </div>

        {players.map((p, i) => (
          <div className="cs-player" key={i}>
            <div className="cs-player-head">
              <input
                className="cs-name"
                value={p.name}
                placeholder={`Player ${i + 1}`}
                onFocus={(e) => e.target.select()}
                onChange={(e) => patch(i, (q) => ({ ...q, name: e.target.value }))}
              />
              <button
                className={"cs-you" + (p.isYou ? " on" : "")}
                onClick={() =>
                  setPlayers((prev) => prev.map((q, idx) => ({ ...q, isYou: idx === i })))
                }
                title="Marks whose sheet this is — kept for older exports"
              >
                {p.isYou ? "Your sheet" : "Mark as yours"}
              </button>
              <span className={"cs-total" + (leaders.includes(i) ? " lead" : "")}>
                {scores[i].total}
              </span>
            </div>

            <div className="cs-grid">
              {ANIMALS.map((a) => (
                <Field
                  key={a.key}
                  label={a.label}
                  color={a.color}
                  value={p.wildlife[a.key]}
                  onChange={(v) =>
                    patch(i, (q) => ({ ...q, wildlife: { ...q.wildlife, [a.key]: v } }))
                  }
                />
              ))}
            </div>

            <div className="cs-grid">
              {HABITATS.map((h) => (
                <Field
                  key={h.key}
                  label={h.label}
                  color={h.color}
                  value={p.habitat[h.key]}
                  hint={
                    scores[i].bonusByHabitat[h.key]
                      ? `+${scores[i].bonusByHabitat[h.key]}`
                      : ""
                  }
                  onChange={(v) =>
                    patch(i, (q) => ({ ...q, habitat: { ...q.habitat, [h.key]: v } }))
                  }
                />
              ))}
            </div>

            <div className="cs-tail">
              <Field
                label="Pinecones"
                value={p.nature}
                onChange={(v) => patch(i, (q) => ({ ...q, nature: v }))}
              />
              <p className="cs-break mono">
                wildlife {scores[i].wildlife} · landscapes {scores[i].landscape} ·
                majorities {scores[i].bonus} · pinecones {scores[i].nature}
              </p>
            </div>
          </div>
        ))}

        <button className="cs-save" onClick={save}>
          {saved ? "Recorded" : "Record this game"}
        </button>
        {megaC && (
          <p className="cs-mega-note">
            Logged as Mega C: counts for the win-loss record and the combo, but is left
            out of every score record and average.
          </p>
        )}
      </div>
    </section>
  );
}

function Field({ label, value, onChange, color, hint }) {
  return (
    <label className="cs-field">
      <span style={color ? { color } : undefined}>
        {label}
        {hint ? <em className="cs-hint">{hint}</em> : null}
      </span>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        placeholder="0"
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

function GamesList({ games, cov, onDelete }) {
  const [open, setOpen] = useState(null);
  if (!games.length)
    return (
      <p className="cs-empty">
        Nothing recorded yet. Head to <strong>Add game</strong> and log your last
        session — every stat fills in from there.
      </p>
    );

  return (
    <div className="cs-panel">
      {games.map((g) => {
        const s = scoreGame(g.players);
        const top = winnersOf(s);
        const winner = g.players[top[0]];
        const best = s[top[0]].total;
        const first = cov.comboCount.get(comboKey(g.cards)) === 1;
        const reg = top.length > 1 ? null : regularFor(winner.name);
        return (
          <div className="cs-game" key={g.id}>
            <button className="cs-game-head" onClick={() => setOpen(open === g.id ? null : g.id)}>
              <span className="cs-date-tag mono">{g.date}</span>
              <span className="cs-chips">
                {ANIMALS.map((a) => (
                  <span key={a.key} className="cs-chip" style={{ background: a.color }}>
                    {g.cards[a.key]}
                  </span>
                ))}
              </span>
              {first && <span className="cs-first">first time</span>}
              {g.megaC && <span className="cs-megatag">mega C</span>}
              <span className="cs-winner" style={reg ? { color: reg.color } : undefined}>
                {top.length > 1
                  ? `tied ${best}`
                  : `${displayName(winner.name)} ${best}`}
              </span>
            </button>

            {open === g.id && (
              <div className="cs-detail">
                <table className="cs-table mono">
                  <thead>
                    <tr>
                      <th>Player</th>
                      {ANIMALS.map((a) => (
                        <th key={a.key} style={{ color: a.color }}>
                          {a.label.slice(0, 3)}
                        </th>
                      ))}
                      {HABITATS.map((h) => (
                        <th key={h.key} style={{ color: h.color }}>
                          {h.label.slice(0, 3)}
                        </th>
                      ))}
                      <th>Maj</th>
                      <th>Pine</th>
                      <th>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {g.players.map((p, i) => (
                      <tr key={i}>
                        <td className="cs-td-name">{p.name}</td>
                        {ANIMALS.map((a) => (
                          <td key={a.key}>{num(p.wildlife[a.key])}</td>
                        ))}
                        {HABITATS.map((h) => (
                          <td key={h.key}>{num(p.habitat[h.key])}</td>
                        ))}
                        <td>{s[i].bonus}</td>
                        <td>{s[i].nature}</td>
                        <td className="cs-td-total">{s[i].total}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="cs-ghost sm danger" onClick={() => onDelete(g.id)}>
                  Delete this game
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function Stats({ games, cov, stats }) {
  const [who, setWho] = useState("all"); // "all" | a regular's key
  const rows = stats.scored;
  const means = useMemo(
    () => cardMeans(rows, who === "all" ? null : who),
    [rows, who]
  );
  const pct = (cov.played.size / TOTAL_COMBOS) * 100;

  return (
    <div>
      <div className="cs-panel cs-stats">
        <Stat
          label="Combos played"
          value={cov.played.size.toLocaleString()}
          sub={`of ${TOTAL_COMBOS.toLocaleString()} · ${pct.toFixed(3)}%`}
        />
        <Stat
          label="Games recorded"
          value={`${games.length}`}
          sub={
            games.length
              ? stats.megaCount
                ? `${stats.megaCount} Mega C, not scored`
                : `${cov.played.size} were a first`
              : "—"
          }
        />
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Players</h2>
          <p className="cs-legend">
            Every seat that has been logged. Games and wins count Mega C; averages and
            bests do not.
          </p>
        </div>
        {stats.people.length ? (
          <table className="cs-table mono cs-people">
            <thead>
              <tr>
                <th className="cs-td-name">Player</th>
                <th>Games</th>
                <th>Wins</th>
                <th>Ties</th>
                <th>Win %</th>
                <th>Avg</th>
                <th>Best</th>
              </tr>
            </thead>
            <tbody>
              {stats.people.map((p) => {
                const reg = REGULARS.find((r) => r.key === p.key);
                return (
                  <tr key={p.key}>
                    <td className="cs-td-name" style={reg ? { color: reg.color } : undefined}>
                      {displayName(p.name)}
                    </td>
                    <td>{p.games}</td>
                    <td>{p.wins}</td>
                    <td>{p.ties}</td>
                    <td>{((p.wins / p.games) * 100).toFixed(0)}%</td>
                    <td>{p.scored ? (p.sum / p.scored).toFixed(1) : "–"}</td>
                    <td className="cs-td-total">{p.scored ? p.best : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <p className="cs-legend">No games recorded yet.</p>
        )}
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Records</h2>
          <p className="cs-legend">Single-game highs, and who set them. Mega C excluded.</p>
        </div>
        <div className="cs-rec-grid">
          <Record label="Highest score" rec={stats.records.total} />
          <Record label="Highest wildlife" rec={stats.records.wildlife} />
          <Record
            label="Highest single landscape"
            rec={stats.records.single}
            tag={(r) => habitatLabel(r.biggest.key)}
          />
          <Record label="Highest total maps" rec={stats.records.landscape} />
          <Record label="Highest total maps + bonuses" rec={stats.records.landscapeTotal} />
          <Record label="Most pinecones" rec={stats.records.nature} />
          <Record label="Biggest blowout" rec={stats.records.margin} prefix="+" />
        </div>

        <h3 className="cs-subhead">Best single animal</h3>
        <div className="cs-rec-grid tight">
          {ANIMALS.map((a) => (
            <Record key={a.key} label={a.label} rec={stats.records.animals[a.key]} color={a.color} />
          ))}
        </div>

        <h3 className="cs-subhead">Biggest run of each type</h3>
        <div className="cs-rec-grid tight">
          {HABITATS.map((h) => (
            <Record key={h.key} label={h.label} rec={stats.records.habitats[h.key]} color={h.color} />
          ))}
        </div>
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Average score per card</h2>
          <div className="cs-actions">
            <div className="cs-seg">
              {[["all", "Both"], ...REGULARS.map((r) => [r.key, r.label])].map(([k, label]) => (
                <button
                  key={k}
                  className={"cs-segbtn" + (who === k ? " on" : "")}
                  onClick={() => setWho(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <p className="cs-legend cs-legend-wide">
          Mean wildlife points scored while each card was in play. The green cell is the
          best card for that animal; the small number is how many games it is based on.
        </p>
        <div className="cs-meantable-wrap">
          <table className="cs-table mono cs-meantable">
            <thead>
              <tr>
                <th />
                {CARDS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
                <th>Best</th>
              </tr>
            </thead>
            <tbody>
              {ANIMALS.map((a) => {
                const best = means.bestCard[a.key];
                return (
                  <tr key={a.key}>
                    <td className="cs-td-name" style={{ color: a.color }}>
                      {a.label}
                    </td>
                    {CARDS.map((c) => {
                      const cell = means.acc[a.key][c];
                      const isBest = best && best.card === c && cell.n > 0;
                      return (
                        <td
                          key={c}
                          className={
                            (cell.n ? "" : "cs-td-none") + (isBest ? " cs-td-best" : "")
                          }
                        >
                          {cell.n ? (cell.sum / cell.n).toFixed(1) : "–"}
                          {cell.n > 0 && <em className="cs-n">{cell.n}</em>}
                        </td>
                      );
                    })}
                    <td className="cs-td-total" style={{ color: a.color }}>
                      {best ? best.card : "–"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Card usage</h2>
        </div>
        <div className="cs-usage">
          {ANIMALS.map((a) => {
            const counts = CARDS.map((c) => cov.cardCount[a.key][c]);
            const max = Math.max(1, ...counts);
            return (
              <div className="cs-usage-row" key={a.key}>
                <span className="cs-animal" style={{ color: a.color }}>
                  {a.label}
                </span>
                <div className="cs-bars">
                  {CARDS.map((c, i) => (
                    <div className="cs-bar-col" key={c}>
                      <div className="cs-bar-track">
                        <div
                          className="cs-bar"
                          style={{
                            height: `${(counts[i] / max) * 100}%`,
                            background: a.color,
                            opacity: counts[i] ? 1 : 0.12,
                          }}
                        />
                      </div>
                      <span className="mono cs-bar-label">{c}</span>
                      <span className="mono cs-bar-n">{counts[i]}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="cs-stat">
      <span className="cs-stat-label">{label}</span>
      <span className="cs-stat-value mono">{value}</span>
      <span className="cs-stat-sub mono">{sub}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=IBM+Plex+Mono:wght@400;500;600&family=Inter+Tight:wght@400;500;600&display=swap');

.cs-root {
  --ink: #16201C;
  --ink-2: #5A6660;
  --paper: #EEF1EA;
  --card: #FFFFFF;
  --line: #D5DBD2;
  font-family: 'Inter Tight', system-ui, sans-serif;
  background: var(--paper);
  color: var(--ink);
  padding: 22px 18px 40px;
  min-height: 100%;
  box-sizing: border-box;
}
.cs-root *, .cs-root *::before, .cs-root *::after { box-sizing: border-box; }
.cs-root .mono { font-family: 'IBM Plex Mono', ui-monospace, monospace; font-variant-numeric: tabular-nums; }

.cs-head { display: flex; gap: 12px; align-items: center; max-width: 940px; margin: 0 auto 18px; }
.cs-head h1 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 800; font-size: 26px; letter-spacing: -0.02em; margin: 0; }
.cs-sub { margin: 2px 0 0; font-size: 13px; color: var(--ink-2); }
.cs-mark { flex: none; }

.cs-tabs { display: flex; gap: 4px; max-width: 940px; margin: 0 auto 16px; border-bottom: 1px solid var(--line); }
.cs-tab { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 600; font-size: 14px; background: none; border: none; border-bottom: 2px solid transparent; padding: 8px 12px; color: var(--ink-2); cursor: pointer; margin-bottom: -1px; }
.cs-tab.on { color: var(--ink); border-bottom-color: var(--ink); }
.cs-tab:focus-visible, .cs-root button:focus-visible, .cs-root input:focus-visible { outline: 2px solid #35604A; outline-offset: 2px; }

.cs-panel { max-width: 940px; margin: 0 auto 14px; background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; }
.cs-panel-head { display: flex; flex-wrap: wrap; gap: 10px; align-items: baseline; justify-content: space-between; margin-bottom: 12px; }
.cs-panel-head h2 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 15px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
.cs-subhead { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: var(--ink-2); margin: 20px 0 10px; }
.cs-legend { font-size: 12px; color: var(--ink-2); margin: 0; max-width: 420px; }
.cs-legend-wide { max-width: none; margin: -4px 0 12px; }
.cs-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.cs-ghost { font-family: inherit; font-size: 13px; background: none; border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; color: var(--ink); cursor: pointer; }
.cs-ghost:hover { border-color: var(--ink); }
.cs-ghost.sm { font-size: 12px; padding: 4px 9px; }
.cs-ghost.danger { color: #B4453A; border-color: #E3C8C4; margin-top: 8px; }

/* Home ------------------------------------------------------------- */
.cs-hero { text-align: center; padding: 22px 16px 18px; }
.cs-hero-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.1em; color: var(--ink-2); font-weight: 600; margin: 0 0 6px; }
.cs-hero-value { font-size: 46px; font-weight: 600; letter-spacing: -0.03em; margin: 0; line-height: 1; }
.cs-hero-value span { font-size: 22px; color: var(--ink-2); letter-spacing: -0.01em; }
.cs-progress { height: 6px; background: #E1E6DE; border-radius: 4px; margin: 14px auto 8px; max-width: 520px; overflow: hidden; }
.cs-progress-fill { height: 100%; background: linear-gradient(90deg, #35604A, #7C8A47); border-radius: 4px; }
.cs-hero-sub { font-size: 11px; color: var(--ink-2); margin: 0; }

.cs-suggest { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
.cs-suggest-cards { display: flex; gap: 8px; flex-wrap: wrap; }
.cs-suggest-card { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.cs-suggest-letter { width: 46px; height: 56px; border-radius: 8px; color: #fff; font-size: 22px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.cs-suggest-animal { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 11px; font-weight: 700; }
.cs-suggest-side { flex: 1 1 220px; display: flex; flex-direction: column; gap: 10px; }
.cs-save.sm { width: auto; margin-top: 0; padding: 9px 16px; align-self: flex-start; font-size: 13px; }

.cs-h2h { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.cs-h2h-side { flex: 1 1 130px; display: flex; flex-direction: column; gap: 2px; }
.cs-h2h-side:last-child { text-align: right; align-items: flex-end; }
.cs-h2h-name { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 800; font-size: 17px; }
.cs-h2h-w { font-size: 34px; font-weight: 600; letter-spacing: -0.02em; line-height: 1; }
.cs-h2h-meta { font-size: 11px; color: var(--ink-2); }
.cs-h2h-mid { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 0 6px; }
.cs-h2h-games { font-size: 15px; font-weight: 600; color: var(--ink-2); }
.cs-h2h-wlabel { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-2); font-weight: 600; }
.cs-h2h-note { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-2); }

.cs-rec-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 14px; }
.cs-rec-grid.tight { grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.cs-rec { display: flex; flex-direction: column; gap: 2px; border-left: 2px solid var(--line); padding-left: 10px; }
.cs-rec-value { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; line-height: 1.1; }
.cs-rec-tag { font-style: normal; font-family: 'Inter Tight', system-ui, sans-serif; font-size: 12px; font-weight: 600; color: var(--ink-2); margin-left: 6px; letter-spacing: 0; }
.cs-rec-who { font-size: 11px; color: var(--ink-2); }
.cs-rec-who strong { font-weight: 600; color: var(--ink); }

.cs-bestcards { display: flex; gap: 14px; flex-wrap: wrap; }
.cs-bestcard { display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 74px; }
.cs-bestcard-letter { width: 38px; height: 46px; border-radius: 7px; color: #fff; font-size: 19px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.cs-bestcard-animal { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 11px; font-weight: 700; }
.cs-bestcard-mean { font-size: 10px; color: var(--ink-2); }

/* Add game ---------------------------------------------------------- */
.cs-picker-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.cs-animal { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 13px; width: 62px; flex: none; }
.cs-letters { display: flex; gap: 5px; flex-wrap: wrap; }
.cs-letter { position: relative; width: 40px; height: 34px; border: 1px solid var(--line); background: #fff; border-radius: 6px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; font-size: 13px; font-weight: 600; color: var(--ink); display: flex; align-items: center; justify-content: center; }
.cs-letter em { position: absolute; right: 3px; bottom: 1px; font-style: normal; font-size: 8px; color: var(--ink-2); }
.cs-letter.on { color: #fff; }
.cs-letter.on em { color: rgba(255,255,255,0.75); }

.cs-status { font-size: 13px; color: var(--ink-2); margin: 12px 0 0; padding-top: 12px; border-top: 1px dashed var(--line); }
.cs-status strong { color: #35604A; margin-right: 6px; font-size: 14px; }
.cs-status.repeat strong { color: var(--ink-2); }

.cs-date { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); }
.cs-date input { font-family: inherit; font-size: 13px; border: 1px solid var(--line); border-radius: 6px; padding: 4px 7px; color: var(--ink); background: #fff; }
.cs-seg { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
.cs-segbtn { font-family: 'IBM Plex Mono', monospace; font-size: 12px; border: none; background: #fff; padding: 5px 9px; cursor: pointer; color: var(--ink-2); }
.cs-segbtn.on { background: var(--ink); color: #fff; }

.cs-mega { display: flex; align-items: center; gap: 6px; font-size: 12px; color: var(--ink-2); cursor: pointer; user-select: none; }
.cs-mega input { width: 15px; height: 15px; accent-color: #35604A; cursor: pointer; margin: 0; }
.cs-mega-note { font-size: 11px; color: var(--ink-2); margin: 8px 0 0; text-align: center; }
.cs-megatag { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #8A5A2B; border: 1px solid #E0C9A8; background: #FBF3E8; border-radius: 20px; padding: 2px 7px; }

.cs-player { border-top: 1px solid var(--line); padding: 14px 0 4px; }
.cs-player-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.cs-name { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 15px; border: none; border-bottom: 1px solid var(--line); background: none; padding: 2px 0; width: 130px; color: var(--ink); }
.cs-you { font-size: 11px; border: 1px solid var(--line); background: none; border-radius: 20px; padding: 3px 10px; color: var(--ink-2); cursor: pointer; font-family: inherit; }
.cs-you.on { background: #35604A; border-color: #35604A; color: #fff; }
.cs-total { margin-left: auto; font-family: 'IBM Plex Mono', monospace; font-size: 24px; font-weight: 600; color: var(--ink-2); }
.cs-total.lead { color: #35604A; }

.cs-grid { display: grid; grid-template-columns: repeat(5, minmax(0,1fr)); gap: 6px; margin-bottom: 6px; }
.cs-field { display: flex; flex-direction: column; gap: 3px; }
.cs-field span { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-2); font-weight: 600; }
.cs-hint { font-style: normal; float: right; color: #35604A; }
.cs-field input { font-family: 'IBM Plex Mono', monospace; font-size: 15px; border: 1px solid var(--line); border-radius: 6px; padding: 6px 8px; width: 100%; background: #fff; color: var(--ink); }

.cs-tail { display: flex; gap: 14px; align-items: flex-end; flex-wrap: wrap; margin-top: 6px; }
.cs-tail .cs-field { width: 120px; }
.cs-break { font-size: 11px; color: var(--ink-2); margin: 0 0 6px; }

.cs-save { width: 100%; margin-top: 14px; font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 14px; background: var(--ink); color: #fff; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.cs-save:hover { background: #35604A; }

/* Log --------------------------------------------------------------- */
.cs-game { border-bottom: 1px solid var(--line); }
.cs-game:last-child { border-bottom: none; }
.cs-game-head { width: 100%; display: flex; align-items: center; gap: 10px; background: none; border: none; padding: 10px 2px; cursor: pointer; text-align: left; font-family: inherit; color: var(--ink); flex-wrap: wrap; }
.cs-date-tag { font-size: 12px; color: var(--ink-2); }
.cs-chips { display: flex; gap: 3px; }
.cs-chip { width: 20px; height: 20px; border-radius: 4px; color: #fff; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.cs-first { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #35604A; border: 1px solid #A9C4B4; border-radius: 20px; padding: 2px 7px; }
.cs-winner { margin-left: auto; font-size: 13px; font-weight: 600; }

.cs-detail { padding: 4px 0 14px; overflow-x: auto; }
.cs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cs-table th { text-align: right; font-weight: 500; color: var(--ink-2); padding: 4px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.cs-table td { text-align: right; padding: 4px 6px; border-top: 1px solid var(--line); }
.cs-td-name { text-align: left !important; font-weight: 600; }
.cs-td-total { font-weight: 600; font-size: 14px; }
.cs-td-none { color: #C3CBC2; }
.cs-td-best { background: #E7F0E7; color: #24503A; font-weight: 600; border-radius: 4px; }
.cs-n { font-style: normal; font-size: 8px; color: var(--ink-2); margin-left: 3px; vertical-align: super; }
.cs-people { max-width: 520px; }

/* Stats ------------------------------------------------------------- */
.cs-stats { display: flex; gap: 26px; flex-wrap: wrap; }
.cs-stat { display: flex; flex-direction: column; gap: 2px; }
.cs-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-2); font-weight: 600; }
.cs-stat-value { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
.cs-stat-sub { font-size: 11px; color: var(--ink-2); }

.cs-usage-row { display: flex; align-items: flex-end; gap: 12px; padding: 6px 0; }
.cs-bars { display: flex; gap: 6px; align-items: flex-end; }
.cs-bar-col { display: flex; flex-direction: column; align-items: center; gap: 2px; width: 30px; }
.cs-bar-track { width: 100%; height: 44px; display: flex; align-items: flex-end; }
.cs-bar { width: 100%; border-radius: 2px 2px 0 0; min-height: 2px; }
.cs-bar-label { font-size: 10px; color: var(--ink-2); }
.cs-bar-n { font-size: 10px; font-weight: 600; }

.cs-meantable-wrap { overflow-x: auto; }
.cs-meantable td, .cs-meantable th { min-width: 46px; }

.cs-empty { max-width: 940px; margin: 40px auto; text-align: center; color: var(--ink-2); font-size: 14px; }
.cs-warn { max-width: 940px; margin: 0 auto 14px; font-size: 12px; color: #B4453A; background: #FBEEEC; border: 1px solid #E3C8C4; border-radius: 8px; padding: 8px 12px; }

.cs-foot { max-width: 940px; margin: 20px auto 0; display: flex; gap: 8px; justify-content: center; }

@media (max-width: 620px) {
  .cs-picker-row { flex-direction: column; align-items: flex-start; gap: 4px; }
  .cs-animal { width: auto; }
  .cs-grid { grid-template-columns: repeat(3, minmax(0,1fr)); }
  .cs-usage-row { flex-direction: column; align-items: flex-start; }
  .cs-hero-value { font-size: 38px; }
  .cs-h2h-side { flex-basis: 100px; }
  .cs-suggest-letter { width: 40px; height: 50px; font-size: 19px; }
}
@media (prefers-reduced-motion: reduce) { .cs-root * { transition: none !important; animation: none !important; } }
`;
