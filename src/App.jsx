import React, { useState, useEffect, useMemo, useRef } from "react";
import { store } from "./store.js";
import { audioBlocked, drumroll, fanfare, hushFanfare, isMuted, setMuted, unlock } from "./sound.js";

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
   3p+:  largest 3, unique second 1. Two-way tie for largest 2 each,
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

function emptyPlayer(name) {
  return {
    name,
    wildlife: Object.fromEntries(ANIMALS.map((a) => [a.key, ""])),
    habitat: Object.fromEntries(HABITATS.map((h) => [h.key, ""])),
    nature: "",
  };
}

/* Seat order on a fresh scorepad. Separate from REGULARS, which is the
   identity list everything head-to-head keys off — this is only who lands in
   which slot when the pad opens. */
const SEAT_DEFAULTS = ["Allison", "Caleb"];

function defaultPlayers() {
  return SEAT_DEFAULTS.map(emptyPlayer);
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

  // games arrive newest-first, so games[0] is the last one played.
  return { played, comboCount, cardCount, pairs, last: games.length ? games[0].cards : null };
}

function suggestCombo(cov) {
  const { played, pairs, last } = cov;
  /* None of the last game's cards come back out, so every suggestion is a
     table you have not just seen. Six letters an animal still leaves 7,776
     combinations to draw from. */
  const lettersFor = (a) => (last ? CARDS.filter((L) => L !== last[ANIMALS[a].key]) : CARDS);
  let best = null;
  let bestScore = -1;
  for (let t = 0; t < 600; t++) {
    const pick = [];
    for (let a = 0; a < ANIMALS.length; a++) {
      let bestLetters = [];
      let bestGain = -1;
      for (const L of lettersFor(a)) {
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
  if (!best)
    best = ANIMALS.map((_, a) => {
      const letters = lettersFor(a);
      return letters[Math.floor(Math.random() * letters.length)];
    });
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
        seat: i,
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

/* Longest run of consecutive wins per person, over the games that person
   actually sat in. Only outright wins extend a run — a tie ends one, which is
   how ties are treated everywhere else in the win-loss record. Mega C games
   count, same as they do for wins.

   Rows arrive newest-first, so walk a reversed copy to read runs forwards. */
function longestStreaks(rows) {
  const people = new Map();
  [...rows].reverse().forEach((r) => {
    if (!people.has(r.key))
      people.set(r.key, {
        key: r.key,
        name: r.name,
        n: 0,
        from: null,
        to: null,
        run: 0,
        runFrom: null,
        live: false,
      });
    const p = people.get(r.key);
    p.name = r.name; // keep the most recent spelling
    if (r.won) {
      if (!p.run) p.runFrom = r.date;
      p.run++;
      // >= so a fresh run that matches an old one becomes the live holder.
      if (p.run >= p.n) {
        p.n = p.run;
        p.from = p.runFrom;
        p.to = r.date;
      }
    } else {
      p.run = 0;
    }
    p.live = p.run > 0 && p.run === p.n;
  });
  return [...people.values()]
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n || String(b.to).localeCompare(String(a.to)));
}

/* Rows arrive newest-first, grouped by game. Records read them the other way
   round, because a record is only taken by beating it: whoever got there
   first keeps it, and a later score that only matches it is second best. */
function chronological(rows) {
  const byGame = [];
  const at = new Map();
  rows.forEach((r) => {
    if (!at.has(r.gameId)) {
      at.set(r.gameId, byGame.length);
      byGame.push([]);
    }
    byGame[at.get(r.gameId)].push(r);
  });
  return byGame.reverse().flat();
}

/* Best row for a metric, oldest first so a strict > leaves a tied record with
   the player who set it. */
function recordFor(rows, get) {
  let best = null;
  chronological(rows).forEach((r) => {
    const v = get(r);
    if (best === null || v > best.value) best = { value: v, row: r };
  });
  return best;
}

/* Every record the Records panels show, in the order they show it. `get`
   reads the value off a row, `eligible` narrows which rows can hold it, and
   grouped ones say where they land inside stats.records. The panels,
   buildStats and the record detail all read this list, so they cannot drift. */
const METRICS = [
  { key: "total", label: "Highest score", get: (r) => r.total },
  { key: "wildlife", label: "Highest wildlife", get: (r) => r.wildlife },
  {
    key: "single",
    label: "Highest single landscape",
    get: (r) => r.biggest.size,
    tag: (r) => habitatLabel(r.biggest.key),
  },
  // "Total maps" is the five runs added up; landscapeTotal adds the bonuses.
  { key: "landscape", label: "Highest total maps", get: (r) => r.landscape },
  {
    key: "landscapeTotal",
    label: "Highest total maps + bonuses",
    get: (r) => r.landscapeTotal,
  },
  { key: "nature", label: "Most pinecones", get: (r) => r.nature },
  {
    key: "margin",
    label: "Biggest blowout",
    prefix: "+",
    get: (r) => r.margin,
    // Only a game somebody won, against somebody, has a margin to speak of.
    eligible: (r) => r.players > 1 && r.won,
  },
  ...ANIMALS.map((a) => ({
    key: `animal:${a.key}`,
    group: "animals",
    sub: a.key,
    label: a.label,
    color: a.color,
    get: (r) => r.animals[a.key],
  })),
  ...HABITATS.map((h) => ({
    key: `habitat:${h.key}`,
    group: "habitats",
    sub: h.key,
    label: h.label,
    color: h.color,
    get: (r) => r.sizes[h.key],
  })),
];
const MAIN_METRICS = METRICS.filter((m) => !m.group);
const METRIC = Object.fromEntries(METRICS.map((m) => [m.key, m]));
const ANIMAL_METRICS = METRICS.filter((m) => m.group === "animals");
const HABITAT_METRICS = METRICS.filter((m) => m.group === "habitats");
const metricRows = (rows, m) => (m.eligible ? rows.filter(m.eligible) : rows);
/* Where a metric's record sits inside stats.records. */
const recOf = (records, m) => (m.group ? records[m.group][m.sub] : records[m.key]);

/* The all-time records the reveal can announce, in the order it lists them,
   under the shorter labels that fit on the reveal card. Reading them off
   METRICS is what keeps the reveal and the Records panels in step. */
const RECORD_FIELDS = [
  ["total"],
  ["wildlife"],
  ["landscape"],
  ["landscapeTotal", "Highest maps + bonuses"],
  ["single", "Biggest single landscape"],
  ["nature"],
].map(([key, label]) => ({ ...METRIC[key], label: label || METRIC[key].label }));

/* Everything the reveal can call out: the record fields, plus the blowout
   that only a contested game has. */
const REVEAL_FIELDS = [...RECORD_FIELDS, METRIC.margin];

/* A player-game, which is what holds a record. */
const rowId = (r) => `${r.gameId}:${r.seat}`;

/* How long each holder of one record kept it, measured in games played.
   Games are walked oldest-first and a row has to beat the standing record to
   take it, which is the tie-break recordFor makes. Mega C games put no row up
   for the record but still count as games elapsed, because the record stood
   through them. */
function recordReigns(games, rows, m) {
  const byGame = new Map();
  metricRows(rows, m).forEach((r) => {
    if (!byGame.has(r.gameId)) byGame.set(r.gameId, []);
    byGame.get(r.gameId).push(r);
  });
  const reigns = new Map();
  const order = games.map((g) => g.id).reverse();
  let best = null;
  let holder = null;
  let since = 0;
  order.forEach((id, i) => {
    let top = null;
    (byGame.get(id) || []).forEach((r) => {
      if (top === null || m.get(r) > m.get(top)) top = r;
    });
    if (top === null || (best !== null && m.get(top) <= best)) return;
    if (holder) Object.assign(reigns.get(holder), { games: i - since, live: false });
    best = m.get(top);
    holder = rowId(top);
    since = i;
    reigns.set(holder, { games: 0, live: true });
  });
  if (holder) reigns.get(holder).games = order.length - since;
  return reigns;
}

const TOP_N = 5;
/* Below this many past scores a top five means nothing, so it goes unsaid. */
const TOP_POOL = 10;

/* Where a just-finished game landed on the all-time top five, for the records
   it did not take outright — those are announced on their own. Matching a
   score ranks below it, the same way a record is only taken by being beaten.
   `scored` is the log as it stood before this game. */
function topFives(rows, scored, broken) {
  if (!rows.length || rows[0].megaC) return [];
  const took = new Set(broken.map((b) => b.label));
  const out = [];
  REVEAL_FIELDS.forEach((m) => {
    if (took.has(m.label)) return;
    const past = metricRows(scored, m).map(m.get);
    if (past.length < TOP_POOL) return;
    const fresh = metricRows(rows, m);
    fresh.forEach((r, i) => {
      const v = m.get(r);
      if (v <= 0) return;
      const ahead =
        past.filter((p) => p >= v).length +
        fresh.filter((o, j) => m.get(o) > v || (m.get(o) === v && j < i)).length;
      if (ahead < TOP_N)
        out.push({ label: m.label, prefix: m.prefix, name: r.name, value: v, rank: ahead + 1 });
    });
  });
  return out.sort((a, b) => a.rank - b.rank);
}

/* Which records a just-finished game took. `records` is the pre-save picture,
   which is what save() still holds when it calls this. A Mega C game is left
   out of every score record, so it can never break one. */
function recordsBroken(rows, records) {
  if (!rows.length || rows[0].megaC) return [];
  const out = [];

  RECORD_FIELDS.forEach((f) => {
    let row = null;
    rows.forEach((r) => {
      if (row === null || f.get(r) > f.get(row)) row = r;
    });
    const value = f.get(row);
    const prev = records[f.key] ? records[f.key].value : null;
    if (value > 0 && (prev === null || value > prev))
      out.push({ label: f.label, value, prev, name: row.name });
  });

  // The blowout record only exists for a game somebody actually won.
  const won = rows.find((r) => r.won && r.players > 1);
  if (won) {
    const prev = records.margin ? records.margin.value : null;
    if (won.margin > 0 && (prev === null || won.margin > prev))
      out.push({ label: "Biggest blowout", value: won.margin, prev, name: won.name, prefix: "+" });
  }
  return out;
}

function buildStats(games) {
  const rows = buildRows(games);
  /* Mega C games still count for wins and for combo coverage, but every
     score-based figure below reads `scored` instead of `rows`. */
  const scored = rows.filter((r) => !r.megaC);

  const records = { animals: {}, habitats: {} };
  METRICS.forEach((m) => {
    const rec = recordFor(metricRows(scored, m), m.get);
    if (m.group) records[m.group][m.sub] = rec;
    else records[m.key] = rec;
  });

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
  /* Longest run inside the head-to-head series alone. */
  h2h.longest = Object.fromEntries(REGULARS.map((r) => [r.key, 0]));
  let run = { key: null, n: 0 };
  [...h2hGames].reverse().forEach(({ seats }) => {
    const leaders = winnersOf(seats).map((i) => seats[i]);
    const winner = leaders.length > 1 ? null : leaders[0].key;
    if (winner && winner === run.key) run.n++;
    else run = { key: winner, n: winner ? 1 : 0 };
    if (winner && run.n > h2h.longest[winner]) h2h.longest[winner] = run.n;
  });
  h2h.longestLive = run.key && run.n === h2h.longest[run.key] ? run.key : null;

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
    streaks: longestStreaks(rows),
    h2h,
    people: [...people.values()].sort((a, b) => b.games - a.games),
  };
}

/* What an average game looks like for each regular: mean points per animal
   whatever card was out, and the mean of each block of the sheet. Mega C rows
   are already out of `rows`, so nothing here has to filter them. */
function playerMeans(rows) {
  return REGULARS.map((reg) => {
    const mine = rows.filter((r) => r.key === reg.key);
    const mean = (get) =>
      mine.length ? mine.reduce((sum, r) => sum + get(r), 0) / mine.length : null;
    return {
      ...reg,
      n: mine.length,
      animals: Object.fromEntries(
        ANIMALS.map((a) => [a.key, mean((r) => r.animals[a.key])])
      ),
      wildlife: mean((r) => r.wildlife),
      landscape: mean((r) => r.landscape),
      bonus: mean((r) => r.bonus),
      nature: mean((r) => r.nature),
      total: mean((r) => r.total),
    };
  });
}

const mean1 = (v) => (v === null ? "–" : v.toFixed(1));

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

  const [quiet, setQuiet] = useState(isMuted);

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
          stats={stats}
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
        <button
          className={"cs-ghost cs-sound" + (quiet ? " off" : "")}
          aria-pressed={!quiet}
          onClick={() => {
            const next = !quiet;
            setQuiet(next);
            setMuted(next);
            if (!next) unlock();
          }}
        >
          <SpeakerIcon on={!quiet} />
          {quiet ? "Sound off" : "Sound on"}
        </button>
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
  const [openRecord, recordDetail] = useRecordDetail(games, stats.scored);
  // Re-roll whenever the log changes so the suggestion is never one you played.
  useEffect(() => setPick(suggestCombo(cov)), [cov]);

  const pct = (cov.played.size / TOTAL_COMBOS) * 100;
  const { h2h } = stats;
  const streaker = REGULARS.find((r) => r.key === h2h.streak.key);
  const best = stats.streaks[0] || null;
  const bestColour = best && regularFor(best.name) ? regularFor(best.name).color : null;
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
              A combination you have never played, with none of the cards from your
              last game.
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
          <h2>Longest win streaks</h2>
          <p className="cs-legend">Wins back to back. A tie ends a run.</p>
        </div>
        <div className="cs-streaks">
          <div className="cs-streak-main">
            <span className="cs-streak-label">Overall</span>
            {best ? (
              <>
                <span
                  className="cs-streak-n mono"
                  style={bestColour ? { color: bestColour } : undefined}
                >
                  {best.n}
                </span>
                <span className="cs-streak-who">
                  <strong style={bestColour ? { color: bestColour } : undefined}>
                    {displayName(best.name)}
                  </strong>
                  <span className="mono">
                    {" · "}
                    {best.from === best.to ? best.from : `${best.from} → ${best.to}`}
                  </span>
                  {best.live && <em className="cs-streak-live">still going</em>}
                </span>
              </>
            ) : (
              <span className="cs-streak-who">no wins recorded yet</span>
            )}
          </div>

          <div className="cs-streak-h2h">
            <span className="cs-streak-label">Head to head</span>
            {REGULARS.map((r) => (
              <div className="cs-streak-row" key={r.key}>
                <span className="cs-streak-rname" style={{ color: r.color }}>
                  {r.label}
                </span>
                <span className="mono cs-streak-rn">{h2h.longest[r.key] || "–"}</span>
                {h2h.longestLive === r.key && h2h.longest[r.key] > 1 && (
                  <em className="cs-streak-live">live</em>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="cs-panel">
        <div className="cs-panel-head">
          <h2>Records</h2>
          <button className="cs-ghost sm" onClick={() => onGo("stats")}>
            All stats
          </button>
        </div>
        <p className="cs-legend cs-legend-wide">Tap a record for the top 5 and how long it has stood.</p>
        <RecordGrid list={MAIN_METRICS} records={stats.records} onOpen={openRecord} />
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

      {recordDetail}
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

/* Speaker with waves when sound is on, struck through when it is off. The
   shape carries the state, not just the colour. */
function SpeakerIcon({ on }) {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true" focusable="false">
      <path d="M3.5 7.6h3L10.5 4.2v11.6L6.5 12.4h-3z" fill="currentColor" />
      {on ? (
        <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M13.2 7.4a3.6 3.6 0 0 1 0 5.2" />
          <path d="M15.6 5.4a6.8 6.8 0 0 1 0 9.2" />
        </g>
      ) : (
        /* The slash sits where the waves would be rather than across the whole
           icon: at 15px a full-width slash eats the speaker and the result
           reads as a stray mark instead of a muted speaker. */
        <path
          d="M12.4 14.6L18.4 5.4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}

function Record({ m, rec, onOpen }) {
  const tagText = rec && m.tag ? m.tag(rec.row) : null;
  return (
    <button className="cs-rec" onClick={() => onOpen(m)} disabled={!rec}>
      <span className="cs-stat-label" style={m.color ? { color: m.color } : undefined}>
        {m.label}
      </span>
      <span className="cs-rec-value mono">
        {rec ? `${m.prefix || ""}${rec.value}` : "–"}
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
    </button>
  );
}

function RecordGrid({ list, records, onOpen, tight }) {
  return (
    <div className={"cs-rec-grid" + (tight ? " tight" : "")}>
      {list.map((m) => (
        <Record key={m.key} m={m} rec={recOf(records, m)} onOpen={onOpen} />
      ))}
    </div>
  );
}

/* Both Records panels keep their own open-record state; this is the piece
   they share. Returns [openRecord, detailNode]. */
function useRecordDetail(games, rows) {
  const [m, setM] = useState(null);
  const node = m ? (
    <RecordDetail m={m} games={games} rows={rows} onClose={() => setM(null)} />
  ) : null;
  return [setM, node];
}

/* How long a score stood as the record. Scores that never held it say
   nothing at all. */
const heldText = (reign) =>
  reign ? `${reign.games} game${reign.games === 1 ? "" : "s"} held` : "";

/* One record up close: who holds it and for how long, then the five best
   scores ever posted for it. The other four are listed whether or not they
   ever held the record themselves. */
function RecordDetail({ m, games, rows, onClose }) {
  const top = useMemo(() => {
    const pool = metricRows(rows, m);
    const reigns = recordReigns(games, pool, m);
    // The sort is stable over a chronological pool, so tied scores rank oldest
    // first — same as the records themselves, and #1 is the holder the panel
    // names.
    return chronological(pool)
      .sort((a, b) => m.get(b) - m.get(a))
      .slice(0, 5)
      .map((r) => ({ row: r, value: m.get(r), reign: reigns.get(rowId(r)) || null }));
  }, [m, games, rows]);

  const best = top[0];
  return (
    <Modal title={m.label} onClose={onClose}>
      {!best ? (
        <p className="cs-legend">No scored games to draw on yet.</p>
      ) : (
        <>
          <h3 className="cs-subhead cs-rd-subhead">Top {top.length} all time</h3>
          <ol className="cs-rd-list">
            {top.map((e, i) => (
              <li key={rowId(e.row)} className={i === 0 ? "lead" : undefined}>
                <span className="cs-rd-rank mono">{i + 1}</span>
                <span className="cs-rd-value mono">
                  {m.prefix || ""}
                  {e.value}
                  {i === 0 && m.tag ? <em className="cs-rec-tag">{m.tag(e.row)}</em> : null}
                </span>
                <span className="cs-rd-who">
                  <strong
                    style={
                      regularFor(e.row.name)
                        ? { color: regularFor(e.row.name).color }
                        : undefined
                    }
                  >
                    {displayName(e.row.name)}
                  </strong>
                  <span className="mono"> · {e.row.date}</span>
                </span>
                {e.reign && (
                  <span className={"cs-rd-held" + (e.reign.live ? " live" : "")}>
                    {heldText(e.reign)}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="cs-modal" onClick={onClose} role="dialog" aria-modal="true" aria-label={title}>
      <div className="cs-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="cs-modal-head">
          <h2>{title}</h2>
          <button className="cs-modal-x" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add game                                                            */
/* ------------------------------------------------------------------ */

function LogGame({ cov, stats, draft, setDraft, onSave }) {
  const { date, cards, players, megaC } = draft;
  const [saved, setSaved] = useState(false);
  const [reveal, setReveal] = useState(null);

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
        const fallback = SEAT_DEFAULTS[next.length] || `Player ${next.length + 1}`;
        next.push(emptyPlayer(fallback));
      }
      return next;
    });
  };

  const patch = (i, fn) =>
    setPlayers((prev) => prev.map((p, idx) => (idx === i ? fn(p) : p)));

  const save = () => {
    unlock(); // iOS wants the audio context started inside the tap itself

    const game = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      date,
      megaC: !!megaC,
      cards: { ...cards },
      players: players.map((p) => ({
        ...p,
        wildlife: { ...p.wildlife },
        habitat: { ...p.habitat },
      })),
    };

    /* Scored the same way the log and the stats page score it, so the reveal
       can never disagree with what the game looks like once it is saved. */
    const rows = buildRows([game]);
    const board = rows
      .map((r, i) => ({
        name: r.name,
        total: r.total,
        nature: r.nature,
        won: r.won,
        tied: r.tied,
        seat: i,
      }))
      .sort((a, b) => b.total - a.total || b.nature - a.nature);
    const broken = recordsBroken(rows, stats.records);
    const topFive = topFives(rows, stats.scored, broken);
    const beaten = board.find((r) => !r.won && !r.tied);

    onSave(game);
    setPlayers((prev) => prev.map((p) => emptyPlayer(p.name)));
    setMegaC(false); // classify each game on its own, never by inheritance
    setSaved(true);
    setTimeout(() => setSaved(false), 2200);

    // Solo games have nothing to announce, so they just get the button state.
    if (board.length > 1)
      setReveal({
        board,
        winners: board.filter((r) => r.won || r.tied),
        tie: board.filter((r) => r.tied).length > 1,
        margin: beaten ? board[0].total - beaten.total : 0,
        winnerKey: nameKey(board[0].name),
        megaC: !!megaC,
        broken,
        topFive,
      });
  };

  return (
    <section>
      {reveal && <WinnerReveal result={reveal} onClose={() => setReveal(null)} />}

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
              {[1, 2, 3, 4, 5].map((n) => (
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
/* Winner reveal                                                       */
/* ------------------------------------------------------------------ */

/*
 * Drumroll, then the result. The game is already saved by the time this
 * mounts — the overlay is pure theatre and can be tapped away at any point.
 */
function WinnerReveal({ result, onClose }) {
  const [phase, setPhase] = useState("roll");
  const stopRoll = useRef(null);

  useEffect(() => {
    // A custom drumroll file sets its own length, so the reveal waits on the
    // roll rather than on a fixed number.
    const roll = drumroll();
    stopRoll.current = roll.stop;
    const t = setTimeout(() => {
      fanfare(result.tie, result.winnerKey);
      setPhase("show");
    }, roll.seconds * 1000);
    return () => {
      clearTimeout(t);
      if (stopRoll.current) stopRoll.current();
      hushFanfare(); // closing the reveal takes the win sound with it
    };
  }, [result]);

  const skip = () => {
    if (phase === "show") return onClose();
    if (stopRoll.current) stopRoll.current();
    fanfare(result.tie, result.winnerKey);
    setPhase("show");
  };

  const { board, winners, tie, margin, megaC, broken, topFive } = result;
  const names = winners.map((w) => displayName(w.name) || "Someone");
  const colour = !tie && regularFor(winners[0].name) ? regularFor(winners[0].name).color : null;

  return (
    <div
      className="cs-reveal"
      role="dialog"
      aria-live="polite"
      aria-label="Result"
      onClick={skip}
    >
      <div
        className={"cs-reveal-card" + (phase === "show" ? " show" : "")}
        onClick={(e) => (phase === "show" ? e.stopPropagation() : skip())}
      >
        {phase === "roll" ? (
          <>
            <p className="cs-reveal-kicker">Counting it up</p>
            <div className="cs-roll" aria-hidden="true">
              {[0, 1, 2].map((i) => (
                <span key={i} style={{ animationDelay: `${i * 0.12}s` }} />
              ))}
            </div>
            <p className="cs-reveal-skip">tap to skip</p>
          </>
        ) : (
          <>
            <div className="cs-burst" aria-hidden="true">
              {Array.from({ length: 12 }, (_, i) => (
                <span
                  key={i}
                  style={{
                    background: ["#35604A", "#C0A040", "#4E7FA8", "#B4453A"][i % 4],
                    "--a": `${i * 30}deg`,
                    animationDelay: `${(i % 4) * 0.04}s`,
                  }}
                />
              ))}
            </div>

            <p className="cs-reveal-kicker">{tie ? "Dead heat" : "Winner"}</p>
            <h2 className="cs-reveal-name" style={colour ? { color: colour } : undefined}>
              {tie ? names.join(" & ") : names[0]}
            </h2>
            <p className="cs-reveal-note">
              {tie
                ? `level on ${winners[0].total}, pinecones split too`
                : margin === 0
                ? "won on the pinecone tiebreak"
                : `by ${margin} point${margin === 1 ? "" : "s"}`}
              {megaC ? " · Mega C" : ""}
            </p>

            {/* Everyone, best first, so the reveal doubles as the final table. */}
            <ol className="cs-reveal-board">
              {board.map((r, i) => (
                <li
                  key={r.seat}
                  className={"cs-rb" + (r.won || r.tied ? " win" : "")}
                >
                  <span className="cs-rb-pos mono">{r.won || r.tied ? "★" : i + 1}</span>
                  <span className="cs-rb-name">{displayName(r.name) || `Player ${r.seat + 1}`}</span>
                  <span className="cs-rb-total mono">{r.total}</span>
                </li>
              ))}
            </ol>

            {broken.length > 0 && (
              <div className="cs-reveal-recs">
                <p className="cs-reveal-kicker">
                  {broken.length === 1 ? "Record broken" : `${broken.length} records broken`}
                </p>
                {broken.map((b) => (
                  <div className="cs-rr" key={b.label}>
                    <span className="cs-rr-label">{b.label}</span>
                    <span className="cs-rr-value mono">
                      {b.prefix || ""}
                      {b.value}
                    </span>
                    <span className="cs-rr-meta">
                      {displayName(b.name)}
                      {b.prev !== null ? ` · past ${b.prefix || ""}${b.prev}` : " · first on the board"}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {!!topFive.length && (
              <div className="cs-reveal-recs">
                <p className="cs-reveal-kicker">On the top five</p>
                {topFive.map((t) => (
                  <div className="cs-rr" key={t.label + t.name}>
                    <span className="cs-rr-label">{t.label}</span>
                    <span className="cs-rr-value mono alt">#{t.rank}</span>
                    <span className="cs-rr-meta">
                      {displayName(t.name)} · {t.prefix || ""}
                      {t.value}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {audioBlocked() && (
              <p className="cs-reveal-quiet">
                Sound is blocked by the browser. On iPhone, check the silent switch.
              </p>
            )}

            <button className="cs-reveal-done" onClick={onClose}>
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Log                                                                 */
/* ------------------------------------------------------------------ */

function GamesList({ games, cov, onDelete }) {
  const [open, setOpen] = useState(null);
  // Deleting a game rewrites every stat and cannot be undone, so it asks first.
  const [pendingId, setPendingId] = useState(null);
  const pending = games.find((g) => g.id === pendingId) || null;
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
        const tied = top.length > 1;
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
              <span className={"cs-winner" + (tied ? " tied" : "")}>
                {tied ? `tied ${best}` : `${displayName(winner.name)} ${best}`}
              </span>
            </button>

            {open === g.id && (
              <div className="cs-detail">
                <div className="cs-detail-totals">
                  {g.players.map((p, i) => (
                    <div
                      className={"cs-dt" + (top.includes(i) ? " win" : "")}
                      key={i}
                    >
                      <span className="cs-dt-name">{displayName(p.name)}</span>
                      <span className="cs-dt-total mono">{s[i].total}</span>
                      <span className="cs-dt-break mono">
                        {s[i].wildlife} wildlife · {s[i].landscape} maps ·{" "}
                        {s[i].bonus} maj · {s[i].nature} pine
                      </span>
                    </div>
                  ))}
                </div>

                <div className="cs-table-wrap">
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
                </div>
                <button className="cs-ghost sm danger" onClick={() => setPendingId(g.id)}>
                  Delete this game
                </button>
              </div>
            )}
          </div>
        );
      })}

      {pending && (
        <Modal title="Delete this game?" onClose={() => setPendingId(null)}>
          <p className="cs-modal-body">
            The game on <strong>{pending.date}</strong> ({comboLabel(pending.cards)},{" "}
            {pending.players.map((p) => displayName(p.name)).join(" · ")}) goes for good,
            and every stat and record recounts without it. There is no undo.
          </p>
          <div className="cs-modal-actions">
            <button className="cs-ghost sm" onClick={() => setPendingId(null)}>
              Keep it
            </button>
            <button
              className="cs-danger"
              onClick={() => {
                onDelete(pending.id);
                setPendingId(null);
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Stats                                                               */
/* ------------------------------------------------------------------ */

function Stats({ games, cov, stats }) {
  const [who, setWho] = useState("all"); // "all" | a regular's key
  const rows = stats.scored;
  const [openRecord, recordDetail] = useRecordDetail(games, rows);
  const means = useMemo(
    () => cardMeans(rows, who === "all" ? null : who),
    [rows, who]
  );
  const avg = useMemo(() => playerMeans(rows), [rows]);
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
          <h2>Average sheet</h2>
          <p className="cs-legend">
            What a typical game looks like for each of them, whatever cards were out.
            Mega C excluded; the small number is games played.
          </p>
        </div>
        <div className="cs-table-wrap">
          <table className="cs-table mono">
            <thead>
              <tr>
                <th>Player</th>
                {ANIMALS.map((a) => (
                  <th key={a.key} style={{ color: a.color }}>
                    {a.label.slice(0, 3)}
                  </th>
                ))}
                <th>Wild</th>
                <th>Maps</th>
                <th>Maj</th>
                <th>Pine</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {avg.map((p) => (
                <tr key={p.key}>
                  <td className="cs-td-name" style={{ color: p.color }}>
                    {p.label}
                    <em className="cs-n">{p.n}</em>
                  </td>
                  {ANIMALS.map((a) => (
                    <td key={a.key}>{mean1(p.animals[a.key])}</td>
                  ))}
                  <td>{mean1(p.wildlife)}</td>
                  <td>{mean1(p.landscape)}</td>
                  <td>{mean1(p.bonus)}</td>
                  <td>{mean1(p.nature)}</td>
                  <td className="cs-td-total">{mean1(p.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Records</h2>
          <p className="cs-legend">
            Single-game highs, and who set them. Mega C excluded. Tap one for the
            top 5 and how long it has stood.
          </p>
        </div>
        <RecordGrid list={MAIN_METRICS} records={stats.records} onOpen={openRecord} />

        <h3 className="cs-subhead">Best single animal</h3>
        <RecordGrid list={ANIMAL_METRICS} records={stats.records} onOpen={openRecord} tight />

        <h3 className="cs-subhead">Biggest run of each type</h3>
        <RecordGrid list={HABITAT_METRICS} records={stats.records} onOpen={openRecord} tight />
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

      {recordDetail}
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
/* A record card is a button: tapping one opens its top 5. */
.cs-rec { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; text-align: left; font: inherit; color: inherit; background: none; border: none; border-left: 2px solid var(--line); border-radius: 0 4px 4px 0; padding: 2px 4px 2px 10px; cursor: pointer; transition: border-color 120ms, background 120ms; }
.cs-rec:hover:not(:disabled) { border-left-color: #35604A; background: #F4F7F2; }
.cs-rec:disabled { cursor: default; }
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

/* Longest win streaks */
.cs-streaks { display: grid; grid-template-columns: 1.4fr 1fr; gap: 14px; align-items: stretch; }
.cs-streak-main { display: flex; flex-direction: column; gap: 2px; background: var(--paper); border-radius: 10px; padding: 14px 16px; }
.cs-streak-label { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 600; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-2); }
.cs-streak-n { font-size: 40px; font-weight: 600; line-height: 1.05; }
.cs-streak-who { font-size: 13px; color: var(--ink-2); }
.cs-streak-who strong { font-size: 14px; color: var(--ink); }
.cs-streak-live { font-style: normal; font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 10px; letter-spacing: 0.08em; text-transform: uppercase; background: #35604A; color: #fff; border-radius: 4px; padding: 2px 5px; margin-left: 6px; }
.cs-streak-h2h { display: flex; flex-direction: column; gap: 4px; background: var(--paper); border-radius: 10px; padding: 14px 16px; }
.cs-streak-row { display: flex; align-items: baseline; gap: 8px; }
.cs-streak-rname { font-weight: 600; font-size: 14px; flex: 1; }
.cs-streak-rn { font-size: 20px; font-weight: 600; }

.cs-sound { display: inline-flex; align-items: center; gap: 7px; color: #35604A; }
.cs-sound.off { color: var(--ink-2); }
.cs-sound.off svg { opacity: 0.75; }

@media (max-width: 620px) {
  .cs-streaks { grid-template-columns: 1fr; }
}

/* Winner reveal */
.cs-reveal { position: fixed; inset: 0; z-index: 50; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgba(12, 18, 15, 0.72); backdrop-filter: blur(3px); animation: cs-fade 180ms ease-out; cursor: pointer; }
.cs-reveal-card { position: relative; width: 100%; max-width: 380px; max-height: 100%; overflow-y: auto; text-align: center; background: var(--card); border-radius: 14px; padding: 30px 24px 24px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32); cursor: default; }
.cs-reveal-card.show { animation: cs-pop 420ms cubic-bezier(0.2, 1.5, 0.4, 1); }
.cs-reveal-kicker { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 600; font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--ink-2); margin: 0; }
.cs-reveal-name { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 800; font-size: 40px; letter-spacing: -0.03em; line-height: 1.05; margin: 8px 0 2px; overflow-wrap: anywhere; }
.cs-reveal-score { font-size: 30px; font-weight: 600; margin: 0; }
.cs-reveal-note { font-size: 13px; color: var(--ink-2); margin: 6px 0 0; }
.cs-reveal-skip { font-size: 12px; color: var(--ink-2); margin: 18px 0 0; }

/* Final table, best first */
.cs-reveal-board { list-style: none; margin: 16px 0 0; padding: 0; text-align: left; }
.cs-rb { display: flex; align-items: baseline; gap: 10px; padding: 6px 8px; border-radius: 7px; }
.cs-rb.win { background: var(--paper); }
.cs-rb-pos { flex: none; width: 16px; font-size: 11px; color: var(--ink-2); }
.cs-rb.win .cs-rb-pos { color: #35604A; }
.cs-rb-name { flex: 1; font-size: 14px; overflow-wrap: anywhere; }
.cs-rb.win .cs-rb-name { font-weight: 600; }
.cs-rb-total { font-size: 17px; font-weight: 600; }

/* Records this game took */
.cs-reveal-recs { margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); text-align: left; }
.cs-reveal-recs .cs-reveal-kicker { text-align: left; margin-bottom: 6px; }
.cs-rr { display: grid; grid-template-columns: 1fr auto; gap: 0 10px; padding: 5px 0; }
.cs-rr-label { font-size: 13px; font-weight: 600; }
.cs-rr-value { grid-row: span 2; align-self: center; font-size: 20px; font-weight: 600; color: #C0A040; }
.cs-rr-value.alt { font-size: 17px; color: #5A6660; }
.cs-rr-meta { font-size: 11px; color: var(--ink-2); }
.cs-reveal-quiet { font-size: 11px; color: var(--ink-2); margin: 14px 0 0; }
.cs-reveal-done { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 13px; margin-top: 18px; background: var(--ink); color: #fff; border: none; border-radius: 8px; padding: 10px 22px; cursor: pointer; }

.cs-roll { display: flex; gap: 8px; justify-content: center; margin: 22px 0 4px; }
.cs-roll span { width: 11px; height: 11px; border-radius: 50%; background: var(--ink); animation: cs-roll 620ms ease-in-out infinite; }

/* Bursts from behind the winner's name, not the middle of a card that now
   runs long enough to hold the scores and the records. */
.cs-burst { position: absolute; inset: 0 0 auto 0; height: 210px; overflow: hidden; border-radius: 14px 14px 0 0; pointer-events: none; z-index: 0; }
.cs-reveal-card > *:not(.cs-burst) { position: relative; z-index: 1; }
.cs-burst span { position: absolute; top: 50%; left: 50%; width: 9px; height: 10px; margin: -5px 0 0 -4px; clip-path: polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%); animation: cs-burst 900ms ease-out forwards; }

@keyframes cs-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes cs-pop { 0% { transform: scale(0.86); opacity: 0; } 100% { transform: scale(1); opacity: 1; } }
@keyframes cs-roll { 0%, 100% { transform: translateY(0); opacity: 0.35; } 50% { transform: translateY(-9px); opacity: 1; } }
@keyframes cs-burst { 0% { transform: rotate(var(--a, 0deg)) translateY(0) scale(1); opacity: 1; } 100% { transform: rotate(var(--a, 0deg)) translateY(-160px) scale(0.5); opacity: 0; } }

@media (prefers-reduced-motion: reduce) {
  .cs-reveal, .cs-reveal-card.show, .cs-roll span, .cs-burst span { animation-duration: 1ms; animation-iteration-count: 1; }
  .cs-burst { display: none; }
}

.cs-save { width: 100%; margin-top: 14px; font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-weight: 700; font-size: 14px; background: var(--ink); color: #fff; border: none; border-radius: 8px; padding: 12px; cursor: pointer; }
.cs-save:hover { background: #35604A; }

/* Modal ------------------------------------------------------------- */
.cs-modal { position: fixed; inset: 0; z-index: 60; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(12, 18, 15, 0.62); backdrop-filter: blur(3px); animation: cs-fade 140ms ease-out; }
.cs-modal-card { width: 100%; max-width: 440px; max-height: 100%; overflow-y: auto; background: var(--card); border-radius: 12px; padding: 16px 18px 18px; box-shadow: 0 18px 50px rgba(0, 0, 0, 0.32); }
.cs-modal-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.cs-modal-head h2 { font-family: 'Bricolage Grotesque', system-ui, sans-serif; font-size: 16px; font-weight: 700; letter-spacing: -0.01em; margin: 0; }
.cs-modal-x { flex: none; background: none; border: none; font-size: 22px; line-height: 1; color: var(--ink-2); cursor: pointer; padding: 0 2px; }
.cs-modal-body { font-size: 13px; line-height: 1.5; margin: 0; }
.cs-modal-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 18px; }
.cs-modal-actions .cs-ghost { margin-top: 0; }
.cs-danger { font-family: inherit; font-size: 12px; font-weight: 600; background: #B4453A; color: #fff; border: none; border-radius: 6px; padding: 5px 14px; cursor: pointer; }
.cs-danger:hover { background: #9A3830; }

/* One record up close ----------------------------------------------- */
.cs-rd-subhead { margin-top: 0; }
.cs-rd-list { list-style: none; margin: 0; padding: 0; }
.cs-rd-list li { display: grid; grid-template-columns: 16px 58px 1fr; gap: 3px 8px; align-items: baseline; padding: 8px 0; border-top: 1px solid var(--line); }
/* The record leads the list, so it is the one that reads big. */
.cs-rd-list li.lead { border-top: none; padding-top: 0; }
.cs-rd-list li.lead .cs-rd-value { font-size: 24px; color: #24503A; }
.cs-rd-list li.lead .cs-rd-who { font-size: 13px; }
.cs-rd-rank { font-size: 11px; color: var(--ink-2); }
.cs-rd-value { font-size: 18px; font-weight: 600; }
.cs-rd-who { font-size: 12px; }
.cs-rd-who strong { font-weight: 600; }
.cs-rd-who .mono { color: var(--ink-2); font-size: 11px; }
.cs-rd-held { grid-column: 2 / -1; font-size: 11px; color: var(--ink-2); }
.cs-rd-held.live { color: #35604A; font-weight: 600; }

/* Log --------------------------------------------------------------- */
.cs-game { border-bottom: 1px solid var(--line); }
.cs-game:last-child { border-bottom: none; }
.cs-game-head { width: 100%; display: flex; align-items: center; gap: 10px; background: none; border: none; padding: 10px 2px; cursor: pointer; text-align: left; font-family: inherit; color: var(--ink); flex-wrap: wrap; }
.cs-date-tag { font-size: 12px; color: var(--ink-2); }
.cs-chips { display: flex; gap: 3px; }
.cs-chip { width: 20px; height: 20px; border-radius: 4px; color: #fff; font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.cs-first { font-size: 10px; text-transform: uppercase; letter-spacing: 0.08em; color: #35604A; border: 1px solid #A9C4B4; border-radius: 20px; padding: 2px 7px; }
.cs-winner { margin-left: auto; font-size: 13px; font-weight: 600; color: #35604A; }
.cs-winner.tied { color: var(--ink-2); }

.cs-detail { padding: 4px 0 14px; }
/* The per-player table is 14 columns wide, so it gets its own scroller and the
   totals sit above it where they read without scrolling anything. */
.cs-detail-totals { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
.cs-dt { flex: 1 1 160px; background: var(--paper); border-radius: 8px; padding: 8px 10px; border-left: 3px solid transparent; }
.cs-dt.win { border-left-color: #35604A; }
.cs-dt-name { display: block; font-size: 12px; font-weight: 600; color: var(--ink-2); }
.cs-dt.win .cs-dt-name { color: #35604A; }
.cs-dt-total { display: block; font-size: 24px; font-weight: 600; line-height: 1.15; }
.cs-dt-break { display: block; font-size: 10px; color: var(--ink-2); }
.cs-table-wrap { overflow-x: auto; }
.cs-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cs-table th { text-align: right; font-weight: 500; color: var(--ink-2); padding: 4px 6px; font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; }
.cs-table td { text-align: right; padding: 4px 6px; border-top: 1px solid var(--line); }
.cs-td-name { text-align: left !important; font-weight: 600; position: sticky; left: 0; background: var(--card); }
.cs-table th:first-child { position: sticky; left: 0; background: var(--card); text-align: left; }
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
