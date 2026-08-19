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
  { key: "mountain", label: "Mountain", color: "#6E7C8A" },
  { key: "forest", label: "Forest", color: "#35604A" },
  { key: "prairie", label: "Prairie", color: "#C0A040" },
  { key: "wetland", label: "Wetland", color: "#7C8A47" },
  { key: "river", label: "River", color: "#4E7FA8" },
];

const CARDS = ["A", "B", "C", "D", "E", "F", "G"];
const TOTAL_COMBOS = Math.pow(CARDS.length, ANIMALS.length); // 16807
const TOTAL_PAIRS = 10 * CARDS.length * CARDS.length; // 490
const STORE_KEY = "cascadia:v1";

/* Habitat majority bonus.
   Solo: 2 pts per habitat with a corridor of 7+.
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
    bonuses[h.key] = habitatBonus(players.map((p) => num(p.habitat[h.key])));
  });
  return players.map((p, i) => {
    const wildlife = ANIMALS.reduce((s, a) => s + num(p.wildlife[a.key]), 0);
    const corridor = HABITATS.reduce((s, h) => s + num(p.habitat[h.key]), 0);
    const bonus = HABITATS.reduce((s, h) => s + bonuses[h.key][i], 0);
    const nature = num(p.nature);
    return {
      wildlife,
      corridor,
      bonus,
      nature,
      bonusByHabitat: HABITATS.reduce(
        (o, h) => ((o[h.key] = bonuses[h.key][i]), o),
        {}
      ),
      total: wildlife + corridor + bonus + nature,
    };
  });
}

const num = (v) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : 0;
};

const comboKey = (cards) => ANIMALS.map((a) => cards[a.key]).join("");
const pairKey = (i, j, li, lj) => `${i}${j}${li}${lj}`;

function emptyPlayer(name, isYou) {
  return {
    name,
    isYou: !!isYou,
    wildlife: Object.fromEntries(ANIMALS.map((a) => [a.key, ""])),
    habitat: Object.fromEntries(HABITATS.map((h) => [h.key, ""])),
    nature: "",
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
/* Hex primitives                                                      */
/* ------------------------------------------------------------------ */

const HEX_R = 8;
const HEX_W = Math.sqrt(3) * HEX_R;
const HEX_VSTEP = 1.5 * HEX_R;

function hexPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}

function tint(count) {
  if (!count) return 0;
  if (count === 1) return 0.32;
  if (count === 2) return 0.58;
  if (count < 5) return 0.78;
  return 1;
}

/* ------------------------------------------------------------------ */
/* App                                                                 */
/* ------------------------------------------------------------------ */

export default function CascadiaTracker() {
  const [ready, setReady] = useState(false);
  const [storageOk, setStorageOk] = useState(true);
  const [games, setGames] = useState([]);
  const [tab, setTab] = useState("log");
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
            {cov.played.size.toLocaleString()} of {TOTAL_COMBOS.toLocaleString()} card
            combinations seen · {games.length} game{games.length === 1 ? "" : "s"} recorded
          </p>
        </div>
      </header>

      <nav className="cs-tabs">
        {[
          ["log", "Record a game"],
          ["games", "Games"],
          ["coverage", "Coverage"],
        ].map(([k, label]) => (
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
      ) : tab === "log" ? (
        <LogGame cov={cov} onSave={(g) => persist([g, ...games])} />
      ) : tab === "games" ? (
        <GamesList
          games={games}
          cov={cov}
          onDelete={(id) => persist(games.filter((g) => g.id !== id))}
        />
      ) : (
        <Coverage games={games} cov={cov} />
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
/* Record a game                                                       */
/* ------------------------------------------------------------------ */

function LogGame({ cov, onSave }) {
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [cards, setCards] = useState(() =>
    Object.fromEntries(ANIMALS.map((a) => [a.key, "A"]))
  );
  const [players, setPlayers] = useState(() => [
    emptyPlayer("You", true),
    emptyPlayer("Player 2", false),
  ]);
  const [saved, setSaved] = useState(false);

  const key = comboKey(cards);
  const timesPlayed = cov.comboCount.get(key) || 0;
  const freshPairs = useMemo(() => {
    let n = 0;
    for (let i = 0; i < ANIMALS.length; i++)
      for (let j = i + 1; j < ANIMALS.length; j++)
        if (
          !cov.pairs.has(
            pairKey(i, j, cards[ANIMALS[i].key], cards[ANIMALS[j].key])
          )
        )
          n++;
    return n;
  }, [cards, cov]);

  const scores = scoreGame(players);
  const leader = Math.max(...scores.map((s) => s.total));

  const setCount = (n) => {
    setPlayers((prev) => {
      const next = prev.slice(0, n);
      while (next.length < n)
        next.push(emptyPlayer(`Player ${next.length + 1}`, false));
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
      cards: { ...cards },
      players: players.map((p) => ({
        ...p,
        wildlife: { ...p.wildlife },
        habitat: { ...p.habitat },
      })),
    });
    setPlayers(players.map((p) => emptyPlayer(p.name, p.isYou)));
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
          <strong className="mono">{key.split("").join("·")}</strong>
          {timesPlayed === 0
            ? " is new to you."
            : ` has come up ${timesPlayed} time${timesPlayed === 1 ? "" : "s"} before.`}{" "}
          {freshPairs > 0
            ? `${freshPairs} of its 10 card pairings are still unseen.`
            : "Every pairing in it has already appeared."}
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
          </div>
        </div>

        {players.map((p, i) => (
          <div className="cs-player" key={i}>
            <div className="cs-player-head">
              <input
                className="cs-name"
                value={p.name}
                onChange={(e) => patch(i, (q) => ({ ...q, name: e.target.value }))}
              />
              <button
                className={"cs-you" + (p.isYou ? " on" : "")}
                onClick={() =>
                  setPlayers((prev) => prev.map((q, idx) => ({ ...q, isYou: idx === i })))
                }
                title="Mark which sheet is yours — coverage stats use it"
              >
                {p.isYou ? "Your sheet" : "Mark as yours"}
              </button>
              <span className={"cs-total" + (scores[i].total === leader ? " lead" : "")}>
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
                label="Nature tokens"
                value={p.nature}
                onChange={(v) => patch(i, (q) => ({ ...q, nature: v }))}
              />
              <p className="cs-break mono">
                wildlife {scores[i].wildlife} · corridors {scores[i].corridor} · majorities{" "}
                {scores[i].bonus} · tokens {scores[i].nature}
              </p>
            </div>
          </div>
        ))}

        <button className="cs-save" onClick={save}>
          {saved ? "Recorded" : "Record this game"}
        </button>
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
/* Games list                                                          */
/* ------------------------------------------------------------------ */

function GamesList({ games, cov, onDelete }) {
  const [open, setOpen] = useState(null);
  if (!games.length)
    return (
      <p className="cs-empty">
        Nothing recorded yet. Head to <strong>Record a game</strong> and log your last
        session — the coverage map fills in from there.
      </p>
    );

  return (
    <div className="cs-panel">
      {games.map((g) => {
        const s = scoreGame(g.players);
        const best = Math.max(...s.map((x) => x.total));
        const winner = g.players[s.findIndex((x) => x.total === best)];
        const first = cov.comboCount.get(comboKey(g.cards)) === 1;
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
              <span className="cs-winner">
                {winner.name} {best}
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
                      <th>Tok</th>
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
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

function Coverage({ games, cov }) {
  const seenPairs = cov.pairs.size;
  const pct = (cov.played.size / TOTAL_COMBOS) * 100;

  const yourMeans = useMemo(() => {
    const acc = Object.fromEntries(
      ANIMALS.map((a) => [
        a.key,
        Object.fromEntries(CARDS.map((c) => [c, { n: 0, sum: 0 }])),
      ])
    );
    games.forEach((g) => {
      const you = g.players.find((p) => p.isYou);
      if (!you) return;
      ANIMALS.forEach((a) => {
        const cell = acc[a.key][g.cards[a.key]];
        if (!cell) return;
        cell.n++;
        cell.sum += num(you.wildlife[a.key]);
      });
    });
    return acc;
  }, [games]);

  return (
    <div>
      <div className="cs-panel cs-stats">
        <Stat label="Combinations seen" value={cov.played.size.toLocaleString()} sub={`of ${TOTAL_COMBOS.toLocaleString()} · ${pct.toFixed(3)}%`} />
        <Stat label="Card pairings seen" value={`${seenPairs}`} sub={`of ${TOTAL_PAIRS}`} />
        <Stat label="Games recorded" value={`${games.length}`} sub={games.length ? `${(cov.played.size / games.length * 100).toFixed(0)}% were new` : "—"} />
      </div>

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Pairings</h2>
          <p className="cs-legend">
            Each hex is one pair of scoring cards. Filled means you have played them
            together.
          </p>
        </div>
        <div className="cs-lattice-scroll">
          <PairLattice pairs={cov.pairs} />
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

      <div className="cs-panel">
        <div className="cs-panel-head">
          <h2>Your average by card</h2>
          <p className="cs-legend">
            Mean wildlife points you scored on each card, across the games you marked as
            yours.
          </p>
        </div>
        <div className="cs-meantable-wrap">
          <table className="cs-table mono cs-meantable">
            <thead>
              <tr>
                <th />
                {CARDS.map((c) => (
                  <th key={c}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {ANIMALS.map((a) => (
                <tr key={a.key}>
                  <td className="cs-td-name" style={{ color: a.color }}>
                    {a.label}
                  </td>
                  {CARDS.map((c) => {
                    const cell = yourMeans[a.key][c];
                    return (
                      <td key={c} className={cell.n ? "" : "cs-td-none"}>
                        {cell.n ? (cell.sum / cell.n).toFixed(1) : "–"}
                        {cell.n > 0 && <em className="cs-n">{cell.n}</em>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
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

function PairLattice({ pairs }) {
  const rows = ANIMALS.slice(1); // elk..fox
  const cols = ANIMALS.slice(0, 4); // bear..hawk
  const gw = 7 * HEX_W + HEX_W / 2;
  const gh = 6 * HEX_VSTEP + 2 * HEX_R;
  const padL = 42;
  const padT = 20;
  const cellW = gw + 16;
  const cellH = gh + 22;
  const width = padL + cols.length * cellW;
  const height = padT + rows.length * cellH;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} className="cs-lattice">
      {cols.map((c, ci) => (
        <text key={c.key} x={padL + ci * cellW + gw / 2} y={12} className="cs-lat-label" textAnchor="middle" fill={c.color}>
          {c.label}
        </text>
      ))}
      {rows.map((r, ri) => (
        <text key={r.key} x={padL - 8} y={padT + ri * cellH + gh / 2} className="cs-lat-label" textAnchor="end" fill={r.color}>
          {r.label}
        </text>
      ))}
      {rows.map((r, ri) =>
        cols.map((c, ci) => {
          const i = ANIMALS.findIndex((a) => a.key === c.key);
          const j = ANIMALS.findIndex((a) => a.key === r.key);
          if (i >= j) return null;
          const ox = padL + ci * cellW;
          const oy = padT + ri * cellH;
          return (
            <g key={`${r.key}-${c.key}`}>
              {CARDS.map((lj, row) =>
                CARDS.map((li, col) => {
                  const n = pairs.get(pairKey(i, j, li, lj)) || 0;
                  const cx = ox + HEX_W / 2 + col * HEX_W + (row % 2) * (HEX_W / 2);
                  const cy = oy + HEX_R + row * HEX_VSTEP;
                  return (
                    <polygon
                      key={`${li}${lj}`}
                      points={hexPoints(cx, cy, HEX_R - 0.7)}
                      fill={r.color}
                      fillOpacity={tint(n)}
                      stroke={n ? "none" : "#B9C2B8"}
                      strokeWidth="0.6"
                    >
                      <title>{`${c.label} ${li} + ${r.label} ${lj}: ${n} game${n === 1 ? "" : "s"}`}</title>
                    </polygon>
                  );
                })
              )}
            </g>
          );
        })
      )}
    </svg>
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
.cs-legend { font-size: 12px; color: var(--ink-2); margin: 0; max-width: 420px; }
.cs-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }

.cs-ghost { font-family: inherit; font-size: 13px; background: none; border: 1px solid var(--line); border-radius: 6px; padding: 6px 12px; color: var(--ink); cursor: pointer; }
.cs-ghost:hover { border-color: var(--ink); }
.cs-ghost.sm { font-size: 12px; padding: 4px 9px; }
.cs-ghost.danger { color: #B4453A; border-color: #E3C8C4; margin-top: 8px; }

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
.cs-n { font-style: normal; font-size: 8px; color: var(--ink-2); margin-left: 3px; vertical-align: super; }

.cs-stats { display: flex; gap: 26px; flex-wrap: wrap; }
.cs-stat { display: flex; flex-direction: column; gap: 2px; }
.cs-stat-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--ink-2); font-weight: 600; }
.cs-stat-value { font-size: 30px; font-weight: 600; letter-spacing: -0.02em; }
.cs-stat-sub { font-size: 11px; color: var(--ink-2); }

.cs-lattice-scroll { overflow-x: auto; }
.cs-lattice { display: block; max-width: 100%; height: auto; }
.cs-lat-label { font-family: 'IBM Plex Mono', monospace; font-size: 8.5px; font-weight: 600; }

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
}
@media (prefers-reduced-motion: reduce) { .cs-root * { transition: none !important; animation: none !important; } }
`;
