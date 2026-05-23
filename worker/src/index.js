const DECKS = 8;
const CARDS_PER_DECK = 52;
const STARTING_BANKROLL = 5000;
const CUT_CARD_REMAINING = 18;
const BETTING_MS = 20000;
const RESULT_MS = 6500;
const HISTORY_LIMIT = 120;
const LEADERBOARD_SIZE = 10;
const BET_KEYS = ["player", "panda", "tie", "dragon", "banker"];
const CHIP_VALUES = new Set([25, 50, 100, 200, 500]);

const SUITS = [
  { code: "H", symbol: "\u2665", red: true },
  { code: "D", symbol: "\u2666", red: true },
  { code: "C", symbol: "\u2663", red: false },
  { code: "S", symbol: "\u2660", red: false },
];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const VALUES = {
  A: 1,
  "2": 2,
  "3": 3,
  "4": 4,
  "5": 5,
  "6": 6,
  "7": 7,
  "8": 8,
  "9": 9,
  "10": 0,
  J: 0,
  Q: 0,
  K: 0,
};
const LABELS = {
  player: "Player",
  banker: "Banker",
  tie: "Tie",
  dragon: "Dragon 7",
  panda: "Panda 8",
};

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const room = sanitizeRoom(url.searchParams.get("room") || "mad-cow-580");
    const id = env.BACCARAT_TABLE.idFromName(room);
    const stub = env.BACCARAT_TABLE.get(id);
    return stub.fetch(request);
  },
};

export class BaccaratTable {
  constructor(ctx) {
    this.ctx = ctx;
    this.storage = ctx.storage;
  }

  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const body = request.method === "POST" ? await safeJson(request) : {};
    const playerId = sanitizePlayerId(body.playerId || url.searchParams.get("playerId"));
    const playerName = normalizeName(body.name || url.searchParams.get("name") || "Player");
    const now = Date.now();
    const table = await this.loadTable(now);

    await this.advanceToNow(table, now);

    try {
      if (url.pathname.endsWith("/api/state")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      if (url.pathname.endsWith("/api/player")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        player.name = playerName;
        player.lastSeenAt = now;
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      if (url.pathname.endsWith("/api/bet")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        this.placeBet(table, player, body.key, Number(body.amount || 0));
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      if (url.pathname.endsWith("/api/clear")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        assertBettingOpen(table);
        table.bets[player.id] = createEmptyBets();
        table.message = `${player.name} cleared bets.`;
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      if (url.pathname.endsWith("/api/repeat")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        assertBettingOpen(table);
        const repeatTotal = getBetsTotal(player.lastBets || createEmptyBets());
        if (repeatTotal <= 0) throw new Error("No previous bet to repeat.");
        if (repeatTotal > player.bankroll) throw new Error("Not enough bankroll to repeat previous bet.");
        table.bets[player.id] = cloneBets(player.lastBets);
        table.message = `${player.name} repeated ${formatMoney(repeatTotal)}.`;
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      if (url.pathname.endsWith("/api/reload")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        assertBettingOpen(table);
        player.bankroll = STARTING_BANKROLL;
        player.reloadCount += 1;
        table.bets[player.id] = createEmptyBets();
        table.message = `${player.name} reloaded chips.`;
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      if (url.pathname.endsWith("/api/free")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        assertBettingOpen(table);
        const count = clampFreeCount(body.count);
        if (getTableBetTotal(table) > 0) {
          throw new Error("Free hands are only available before anyone bets.");
        }
        for (let index = 0; index < count; index += 1) {
          if (index > 0) startNextBettingRound(table, now);
          settleTableRound(table, now);
        }
        table.message = `${player.name} jumped ${count} free hand${count === 1 ? "" : "s"}. ${buildOutcomeMessage(table.lastOutcome)}`;
        await this.saveTable(table);
        return json(this.snapshot(table, player.id, now));
      }

      return json({ ok: true, name: "Mad Cow Baccarat Table" });
    } catch (error) {
      await this.saveTable(table);
      return json({ ok: false, error: error.message }, 400);
    }
  }

  async alarm() {
    const now = Date.now();
    const table = await this.loadTable(now);
    await this.advanceToNow(table, now);
    await this.saveTable(table);
  }

  async loadTable(now) {
    const table = await this.storage.get("table");
    if (table) return table;
    const shoe = shuffle(createShoe());
    return {
      room: "mad-cow-580",
      shoe,
      shoeNumber: 1,
      roundNumber: 1,
      phase: "betting",
      phaseEndsAt: now + BETTING_MS,
      playerCards: [],
      bankerCards: [],
      lastOutcome: null,
      history: [],
      players: {},
      bets: {},
      message: "Betting is open. Buy in before the countdown ends.",
    };
  }

  async saveTable(table) {
    await this.storage.put("table", table);
    await this.storage.setAlarm(table.phaseEndsAt);
  }

  async advanceToNow(table, now) {
    let guard = 0;
    while (table.phaseEndsAt <= now && guard < 120) {
      if (table.phase === "betting") {
        settleTableRound(table, table.phaseEndsAt);
      } else {
        startNextBettingRound(table, table.phaseEndsAt);
      }
      guard += 1;
    }

    if (guard >= 120 && table.phaseEndsAt <= now) {
      table.phase = "betting";
      table.phaseEndsAt = now + BETTING_MS;
      table.message = "Table caught up and opened a fresh betting window.";
    }
  }

  placeBet(table, player, key, amount) {
    assertBettingOpen(table);
    if (!BET_KEYS.includes(key)) throw new Error("Unknown bet target.");
    if (!CHIP_VALUES.has(amount)) throw new Error("Invalid chip amount.");
    const bets = table.bets[player.id] || createEmptyBets();
    if (getBetsTotal(bets) + amount > player.bankroll) {
      throw new Error("Not enough bankroll for this bet.");
    }
    bets[key] += amount;
    table.bets[player.id] = bets;
    player.lastSeenAt = Date.now();
    table.message = `${player.name} bet ${formatMoney(amount)} on ${LABELS[key]}.`;
  }

  snapshot(table, playerId, now) {
    const player = table.players[playerId];
    const playerBets = table.bets[playerId] || createEmptyBets();
    const lastOutcome = player?.lastOutcome || table.lastOutcome || null;
    const secondsRemaining = Math.max(0, Math.ceil((table.phaseEndsAt - now) / 1000));
    return {
      ok: true,
      mode: "online",
      room: table.room,
      roundNumber: table.roundNumber,
      shoeNumber: table.shoeNumber,
      cardsRemaining: table.shoe.length,
      phase: table.phase,
      phaseEndsAt: table.phaseEndsAt,
      secondsRemaining,
      bettingOpen: table.phase === "betting",
      playerCards: table.playerCards,
      bankerCards: table.bankerCards,
      playerTotal: table.playerCards.length ? handTotal(table.playerCards) : null,
      bankerTotal: table.bankerCards.length ? handTotal(table.bankerCards) : null,
      message: buildTableMessage(table, secondsRemaining),
      lastOutcome,
      history: table.history,
      player: {
        id: player.id,
        name: player.name,
        bankroll: player.bankroll,
        reloadCount: player.reloadCount,
        handsPlayed: player.handsPlayed,
        bonusHits: player.bonusHits,
        lastHandNet: player.lastHandNet,
        totalWagered: player.totalWagered,
        bestHandNet: player.bestHandNet,
        bets: playerBets,
        lastBets: player.lastBets || createEmptyBets(),
      },
      leaderboard: buildLeaderboard(table, playerId),
    };
  }
}

function settleTableRound(table, now) {
  if (table.shoe.length <= CUT_CARD_REMAINING) {
    table.shoe = shuffle(createShoe());
    table.shoeNumber += 1;
  }

  const playerCards = [drawCard(table), drawCard(table)];
  const bankerCards = [drawCard(table), drawCard(table)];
  playDrawRules(table, playerCards, bankerCards);

  const outcome = buildGlobalOutcome(playerCards, bankerCards);
  outcome.roundNumber = table.roundNumber;
  for (const player of Object.values(table.players)) {
    const bets = table.bets[player.id] || createEmptyBets();
    const totalBet = getBetsTotal(bets);
    if (totalBet <= 0) continue;
    const playerOutcome = settlePlayerBets(outcome, bets);
    player.bankroll += playerOutcome.net;
    player.handsPlayed += 1;
    player.totalWagered += totalBet;
    player.lastHandNet = playerOutcome.net;
    player.bestHandNet = Math.max(player.bestHandNet || 0, playerOutcome.net);
    player.lastBets = cloneBets(bets);
    player.lastOutcome = { ...outcome, ...playerOutcome, bets: cloneBets(bets) };
    if (outcome.dragon || outcome.panda) player.bonusHits += 1;
  }

  table.playerCards = playerCards;
  table.bankerCards = bankerCards;
  table.lastOutcome = { ...outcome, settlements: [], payout: 0, net: 0, bets: createEmptyBets() };
  table.history.unshift(table.lastOutcome);
  table.history = table.history.slice(0, HISTORY_LIMIT);
  table.phase = "settled";
  table.phaseEndsAt = now + RESULT_MS;
  table.message = buildOutcomeMessage(outcome);
}

function startNextBettingRound(table, now) {
  table.roundNumber += 1;
  table.phase = "betting";
  table.phaseEndsAt = now + BETTING_MS;
  table.playerCards = [];
  table.bankerCards = [];
  table.bets = {};
  table.message = "Betting is open. Buy in before the countdown ends.";

  if (table.shoe.length <= CUT_CARD_REMAINING) {
    table.shoe = shuffle(createShoe());
    table.shoeNumber += 1;
    table.message = "Cut card reached. New shoe is live.";
  }
}

function buildGlobalOutcome(playerCards, bankerCards) {
  const playerTotal = handTotal(playerCards);
  const bankerTotal = handTotal(bankerCards);
  const winner = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  const dragon = winner === "banker" && bankerCards.length === 3 && bankerTotal === 7;
  const panda = winner === "player" && playerCards.length === 3 && playerTotal === 8;
  const natural = playerCards.length === 2 && bankerCards.length === 2 && (playerTotal >= 8 || bankerTotal >= 8);
  const naturalTotal = natural ? (winner === "banker" ? bankerTotal : playerTotal) : null;
  return {
    roundNumber: null,
    winner,
    playerTotal,
    bankerTotal,
    natural,
    naturalTotal,
    dragon,
    panda,
    bankerPushOnDragon: dragon,
    playerCards,
    bankerCards,
  };
}

function settlePlayerBets(outcome, bets) {
  const settlements = [];
  let payout = 0;
  if (outcome.winner === "player") {
    payout += addPaySettlement(settlements, bets, "player", 1);
  } else if (outcome.winner === "banker") {
    if (outcome.dragon) {
      payout += addPushSettlement(settlements, bets, "banker", "Dragon 7 Push");
    } else {
      payout += addPaySettlement(settlements, bets, "banker", 1);
    }
  } else {
    payout += addPushSettlement(settlements, bets, "player", "Tie Push");
    payout += addPushSettlement(settlements, bets, "banker", "Tie Push");
    payout += addPaySettlement(settlements, bets, "tie", 8);
  }

  if (outcome.dragon) payout += addPaySettlement(settlements, bets, "dragon", 40);
  if (outcome.panda) payout += addPaySettlement(settlements, bets, "panda", 25);

  const wagered = getBetsTotal(bets);
  return {
    payout,
    net: payout - wagered,
    settlements,
    bankerPushOnDragon: outcome.dragon && bets.banker > 0,
  };
}

function addPaySettlement(settlements, bets, key, odds) {
  const stake = bets[key] || 0;
  if (stake <= 0) return 0;
  const profit = stake * odds;
  const amount = stake + profit;
  settlements.push({ key, label: LABELS[key], type: "win", odds, stake, profit, amount });
  return amount;
}

function addPushSettlement(settlements, bets, key, reason) {
  const stake = bets[key] || 0;
  if (stake <= 0) return 0;
  settlements.push({ key, label: LABELS[key], type: "push", reason, stake, profit: 0, amount: stake });
  return stake;
}

function playDrawRules(table, playerCards, bankerCards) {
  const playerStart = handTotal(playerCards);
  const bankerStart = handTotal(bankerCards);
  if (playerStart >= 8 || bankerStart >= 8) return;

  let playerThirdValue = null;
  if (playerStart <= 5) {
    const card = drawCard(table);
    playerCards.push(card);
    playerThirdValue = card.value;
  }

  if (bankerShouldDraw(handTotal(bankerCards), playerThirdValue)) {
    bankerCards.push(drawCard(table));
  }
}

function bankerShouldDraw(total, playerThirdValue) {
  if (playerThirdValue === null) return total <= 5;
  if (total <= 2) return true;
  if (total === 3) return playerThirdValue !== 8;
  if (total === 4) return playerThirdValue >= 2 && playerThirdValue <= 7;
  if (total === 5) return playerThirdValue >= 4 && playerThirdValue <= 7;
  if (total === 6) return playerThirdValue === 6 || playerThirdValue === 7;
  return false;
}

function drawCard(table) {
  if (table.shoe.length === 0) {
    table.shoe = shuffle(createShoe());
    table.shoeNumber += 1;
  }
  return table.shoe.pop();
}

function createShoe() {
  const cards = [];
  let id = 1;
  for (let deck = 1; deck <= DECKS; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `${deck}-${id}`,
          rank,
          suit: suit.code,
          symbol: suit.symbol,
          red: suit.red,
          value: VALUES[rank],
          fresh: false,
          slow: false,
        });
        id += 1;
      }
    }
  }
  return cards;
}

function shuffle(cards) {
  const clone = [...cards];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
}

function ensurePlayer(table, id, name, now) {
  const playerId = id || crypto.randomUUID();
  if (!table.players[playerId]) {
    table.players[playerId] = {
      id: playerId,
      name,
      bankroll: STARTING_BANKROLL,
      reloadCount: 0,
      handsPlayed: 0,
      bonusHits: 0,
      totalWagered: 0,
      lastHandNet: 0,
      bestHandNet: 0,
      lastBets: createEmptyBets(),
      lastOutcome: null,
      joinedAt: now,
      lastSeenAt: now,
    };
  } else {
    table.players[playerId].name = name || table.players[playerId].name;
    table.players[playerId].lastSeenAt = now;
  }
  return table.players[playerId];
}

function buildLeaderboard(table, currentPlayerId) {
  return Object.values(table.players)
    .map((player) => ({
      rank: 0,
      id: player.id,
      name: player.name,
      score: player.bankroll - STARTING_BANKROLL * (player.reloadCount + 1),
      bankroll: player.bankroll,
      reloads: player.reloadCount,
      hands: player.handsPlayed,
      bonus: player.bonusHits,
      self: player.id === currentPlayerId,
      waiting: false,
    }))
    .sort((a, b) => b.score - a.score || b.bankroll - a.bankroll || a.name.localeCompare(b.name))
    .slice(0, LEADERBOARD_SIZE)
    .map((row, index) => ({ ...row, rank: index + 1 }));
}

function buildTableMessage(table, secondsRemaining) {
  if (table.phase === "betting") {
    return `Betting open: ${secondsRemaining}s until buy-in closes.`;
  }
  return `${buildOutcomeMessage(table.lastOutcome)} Next round in ${secondsRemaining}s.`;
}

function buildOutcomeMessage(outcome) {
  if (!outcome) return "Waiting for the first result.";
  const winner = outcome.winner === "banker" ? "Banker" : outcome.winner === "player" ? "Player" : "Tie";
  const bonus = [
    outcome.dragon ? "Dragon 7" : "",
    outcome.panda ? "Panda 8" : "",
    outcome.natural ? `Natural ${outcome.naturalTotal}` : "",
  ].filter(Boolean).join(" / ");
  return `${winner} ${outcome.playerTotal}-${outcome.bankerTotal}${bonus ? ` (${bonus})` : ""}.`;
}

function handTotal(cards) {
  return cards.reduce((sum, card) => sum + card.value, 0) % 10;
}

function createEmptyBets() {
  return BET_KEYS.reduce((bets, key) => {
    bets[key] = 0;
    return bets;
  }, {});
}

function getBetsTotal(bets) {
  return BET_KEYS.reduce((sum, key) => sum + (bets[key] || 0), 0);
}

function getTableBetTotal(table) {
  return Object.values(table.bets || {}).reduce((sum, bets) => sum + getBetsTotal(bets), 0);
}

function cloneBets(bets) {
  return BET_KEYS.reduce((clone, key) => {
    clone[key] = bets?.[key] || 0;
    return clone;
  }, {});
}

function assertBettingOpen(table) {
  if (table.phase !== "betting") throw new Error("Betting is closed. Buy-in is locked.");
}

function clampFreeCount(count) {
  const parsed = Number(count) || 1;
  return Math.max(1, Math.min(5, Math.floor(parsed)));
}

function sanitizeRoom(room) {
  return String(room || "mad-cow-580").toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 48) || "mad-cow-580";
}

function sanitizePlayerId(id) {
  if (!id) return "";
  return String(id).replace(/[^a-zA-Z0-9-]/g, "").slice(0, 80);
}

function normalizeName(name) {
  const clean = String(name || "Player").trim().slice(0, 16);
  return clean || "Player";
}

function formatMoney(amount) {
  return `$${Math.round(amount).toLocaleString("en-US")}`;
}

async function safeJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
