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
const BLACKJACK_DECKS = 2;
const BLACKJACK_SEATS = 5;
const BLACKJACK_MIN_BET = 25;
const BLACKJACK_MAX_BET = 500;
const BLACKJACK_CUT_CARD_REMAINING = 15;
const BLACKJACK_ACTION_MS = 10000;
const BLACKJACK_MAX_SPLITS = 4;
const BLACKJACK_MAX_HANDS_PER_SEAT = BLACKJACK_MAX_SPLITS + 1;

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

      if (url.pathname.includes("/api/blackjack/")) {
        const player = ensurePlayer(table, playerId, playerName, now);
        advanceBlackjackToNow(table, now);
        const response = this.handleBlackjack(url, table, player, body, now);
        await this.saveTable(table);
        return json(response);
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

  handleBlackjack(url, table, player, body, now) {
    const blackjack = ensureBlackjackTable(table);
    player.lastSeenAt = now;

    if (url.pathname.endsWith("/api/blackjack/state")) {
      return this.blackjackSnapshot(table, player.id);
    }

    if (url.pathname.endsWith("/api/blackjack/seat")) {
      sitBlackjackSeat(table, player, Number(body.seat), Number(body.bet || BLACKJACK_MIN_BET), body.mode === "add");
      return this.blackjackSnapshot(table, player.id);
    }

    if (url.pathname.endsWith("/api/blackjack/leave")) {
      leaveBlackjackSeat(blackjack, player.id);
      return this.blackjackSnapshot(table, player.id);
    }

    if (url.pathname.endsWith("/api/blackjack/start")) {
      startBlackjackRound(table);
      return this.blackjackSnapshot(table, player.id);
    }

    if (url.pathname.endsWith("/api/blackjack/action")) {
      actBlackjack(table, player, String(body.action || ""));
      return this.blackjackSnapshot(table, player.id);
    }

    if (url.pathname.endsWith("/api/blackjack/reload")) {
      if (blackjack.phase !== "waiting" && blackjack.phase !== "settled") {
        throw new Error("Reload is available between hands.");
      }
      player.bankroll = STARTING_BANKROLL;
      player.reloadCount += 1;
      blackjack.message = `${player.name} reloaded chips.`;
      return this.blackjackSnapshot(table, player.id);
    }

    throw new Error("Unknown blackjack action.");
  }

  blackjackSnapshot(table, playerId) {
    const blackjack = ensureBlackjackTable(table);
    const player = table.players[playerId];
    return {
      ok: true,
      mode: "blackjack",
      room: table.room,
      player: {
        id: player.id,
        name: player.name,
        bankroll: player.bankroll,
        reloadCount: player.reloadCount,
        handsPlayed: player.handsPlayed,
        totalWagered: player.totalWagered,
        lastHandNet: player.lastHandNet,
        bestHandNet: player.bestHandNet,
        bonusHits: player.bonusHits,
      },
      blackjack: sanitizeBlackjack(blackjack, playerId, player),
      leaderboard: buildLeaderboard(table, playerId),
    };
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
    resetBaccaratShoe(table);
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
    resetBaccaratShoe(table);
    table.message = "Cut card reached. New shoe is live.";
  }
}

function resetBaccaratShoe(table) {
  table.shoe = shuffle(createShoe());
  table.shoeNumber += 1;
  table.history = [];
  table.lastOutcome = null;
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
    resetBaccaratShoe(table);
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

function ensureBlackjackTable(table) {
  if (!table.blackjack) {
    table.blackjack = createBlackjackTable();
  }
  if (!Array.isArray(table.blackjack.seats) || table.blackjack.seats.length !== BLACKJACK_SEATS) {
    table.blackjack.seats = createBlackjackSeats();
  }
  if (!Array.isArray(table.blackjack.shoe) || table.blackjack.shoe.length === 0) {
    table.blackjack.shoe = shuffle(createBlackjackShoe());
    table.blackjack.shoeNumber = (table.blackjack.shoeNumber || 0) + 1;
  }
  return table.blackjack;
}

function createBlackjackTable() {
  return {
    shoe: shuffle(createBlackjackShoe()),
    shoeNumber: 1,
    roundNumber: 0,
    phase: "waiting",
    dealer: { cards: [] },
    seats: createBlackjackSeats(),
    currentSeat: null,
    currentHandIndex: 0,
    actionDeadlineAt: null,
    lastCompletedAt: null,
    message: "Choose a seat to join the blackjack table.",
  };
}

function createBlackjackSeats() {
  return Array.from({ length: BLACKJACK_SEATS }, (_, index) => ({
    seat: index + 1,
    playerId: null,
    name: "",
    bet: BLACKJACK_MIN_BET,
    cards: [],
    hands: [],
    splitCount: 0,
    acesSplitUsed: false,
    active: false,
    resolved: false,
    doubled: false,
    autoStood: false,
    outcome: "",
    result: "",
    settledNet: 0,
  }));
}

function createBlackjackHand(bet, cards = [], options = {}) {
  return {
    cards,
    bet,
    resolved: Boolean(options.resolved),
    doubled: Boolean(options.doubled),
    autoStood: Boolean(options.autoStood),
    fromSplit: Boolean(options.fromSplit),
    splitAceHand: Boolean(options.splitAceHand),
    outcome: options.outcome || "",
    result: options.result || "",
    settledNet: Number(options.settledNet || 0),
  };
}

function getSeatHands(seat) {
  if (Array.isArray(seat.hands) && seat.hands.length) return seat.hands;
  if (Array.isArray(seat.cards) && seat.cards.length) {
    seat.hands = [
      createBlackjackHand(seat.bet, seat.cards, {
        resolved: seat.resolved,
        doubled: seat.doubled,
        autoStood: seat.autoStood,
        outcome: seat.outcome,
        result: seat.result,
        settledNet: seat.settledNet,
      }),
    ];
    return seat.hands;
  }
  seat.hands = [];
  return seat.hands;
}

function syncSeatLegacyFields(seat) {
  const hands = getSeatHands(seat);
  const activeHand = hands.find((hand) => !hand.resolved && !hand.outcome) || hands[0] || createBlackjackHand(seat.bet);
  seat.cards = activeHand.cards;
  seat.resolved = seat.active ? hands.every((hand) => hand.resolved || hand.outcome) : true;
  seat.doubled = hands.some((hand) => hand.doubled);
  seat.autoStood = hands.some((hand) => hand.autoStood);
  seat.settledNet = hands.reduce((sum, hand) => sum + (hand.settledNet || 0), 0);
  seat.result = hands.length > 1 ? `${hands.length} hands` : (activeHand.result || seat.result || "");
}

function createBlackjackShoe() {
  const cards = [];
  let id = 1;
  for (let deck = 1; deck <= BLACKJACK_DECKS; deck += 1) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        cards.push({
          id: `bj-${deck}-${id}`,
          rank,
          suit: suit.code,
          symbol: suit.symbol,
          red: suit.red,
          value: getBlackjackRankValue(rank),
          fresh: false,
        });
        id += 1;
      }
    }
  }
  return cards;
}

function sitBlackjackSeat(table, player, seatNumber, bet, addToSeat = false) {
  const blackjack = ensureBlackjackTable(table);
  assertBlackjackSeatSetupOpen(blackjack);
  const seat = getBlackjackSeat(blackjack, seatNumber);
  if (seat.playerId && seat.playerId !== player.id) {
    throw new Error(`Seat ${seatNumber} is already taken.`);
  }
  for (const otherSeat of blackjack.seats) {
    if (otherSeat.playerId === player.id && otherSeat.seat !== seat.seat) {
      clearBlackjackSeat(otherSeat);
    }
  }
  const chip = normalizeBlackjackChip(bet);
  const previousBet = seat.playerId === player.id ? seat.bet : 0;
  const nextBet = addToSeat && previousBet > 0 ? Math.min(BLACKJACK_MAX_BET, previousBet + chip) : chip;
  if (nextBet === previousBet) {
    throw new Error(`Seat ${seat.seat} is already at the ${formatMoney(BLACKJACK_MAX_BET)} max.`);
  }
  if (player.bankroll < nextBet) {
    throw new Error("Not enough bankroll for that seat bet.");
  }
  seat.playerId = player.id;
  seat.name = player.name;
  seat.bet = nextBet;
  seat.cards = [];
  seat.hands = [];
  seat.splitCount = 0;
  seat.acesSplitUsed = false;
  seat.active = false;
  seat.resolved = false;
  seat.doubled = false;
  seat.autoStood = false;
  seat.outcome = "";
  seat.result = "";
  seat.settledNet = 0;
  blackjack.currentSeat = null;
  blackjack.currentHandIndex = 0;
  blackjack.message = previousBet > 0 && addToSeat
    ? `${player.name} added ${formatMoney(nextBet - previousBet)} to Seat ${seat.seat}. Total ${formatMoney(seat.bet)}.`
    : `${player.name} joined Seat ${seat.seat} for ${formatMoney(seat.bet)}.`;
}

function leaveBlackjackSeat(blackjack, playerId) {
  assertBlackjackSeatSetupOpen(blackjack);
  for (const seat of blackjack.seats) {
    if (seat.playerId === playerId) {
      clearBlackjackSeat(seat);
    }
  }
  blackjack.currentSeat = null;
  blackjack.currentHandIndex = 0;
  blackjack.message = "Seat is open for the next player.";
}

function startBlackjackRound(table) {
  const blackjack = ensureBlackjackTable(table);
  assertBlackjackSeatSetupOpen(blackjack);
  const activeSeats = blackjack.seats.filter((seat) => seat.playerId);
  if (activeSeats.length === 0) {
    throw new Error("Choose at least one seat before dealing.");
  }

  if (blackjack.shoe.length <= BLACKJACK_CUT_CARD_REMAINING) {
    blackjack.shoe = shuffle(createBlackjackShoe());
    blackjack.shoeNumber += 1;
  }

  for (const seat of activeSeats) {
    const player = table.players[seat.playerId];
    if (!player) throw new Error(`Seat ${seat.seat} player is no longer available.`);
    if (player.bankroll < seat.bet) {
      throw new Error(`${player.name} does not have enough bankroll for Seat ${seat.seat}.`);
    }
  }

  blackjack.roundNumber += 1;
  blackjack.phase = "dealing";
  blackjack.dealer = { cards: [] };
  blackjack.currentSeat = null;
  blackjack.currentHandIndex = 0;
  blackjack.message = `Blackjack round ${blackjack.roundNumber} is dealing.`;

  for (const seat of blackjack.seats) {
    seat.cards = [];
    seat.hands = [];
    seat.splitCount = 0;
    seat.acesSplitUsed = false;
    seat.active = Boolean(seat.playerId);
    seat.resolved = !seat.active;
    seat.doubled = false;
    seat.autoStood = false;
    seat.outcome = "";
    seat.result = "";
    seat.settledNet = 0;
    if (seat.active) {
      const player = table.players[seat.playerId];
      seat.hands = [createBlackjackHand(seat.bet)];
      seat.cards = seat.hands[0].cards;
      player.bankroll -= seat.bet;
      player.totalWagered += seat.bet;
    }
  }

  for (const seat of activeSeats) getSeatHands(seat)[0].cards.push(drawBlackjackCard(blackjack));
  blackjack.dealer.cards.push(drawBlackjackCard(blackjack));
  for (const seat of activeSeats) getSeatHands(seat)[0].cards.push(drawBlackjackCard(blackjack));
  blackjack.dealer.cards.push({ ...drawBlackjackCard(blackjack), faceDown: true });
  for (const seat of activeSeats) syncSeatLegacyFields(seat);

  resolveOpeningBlackjacks(table, blackjack);
  advanceBlackjackTurn(table, blackjack);
}

function actBlackjack(table, player, action) {
  const blackjack = ensureBlackjackTable(table);
  if (blackjack.phase !== "player-turn") {
    throw new Error("No player action is open right now.");
  }
  const seat = getBlackjackSeat(blackjack, blackjack.currentSeat);
  if (seat.playerId !== player.id) {
    throw new Error(`It is Seat ${seat.seat}'s turn.`);
  }
  const hand = getCurrentBlackjackHand(blackjack, seat);
  if (!hand || hand.resolved) {
    advanceBlackjackTurn(table, blackjack);
    return;
  }

  if (action === "hit") {
    if (hand.splitAceHand) {
      throw new Error("Split aces receive one card only.");
    }
    hand.cards.push(drawBlackjackCard(blackjack));
    const value = getBlackjackHandValue(hand.cards).total;
    if (value > 21) {
      hand.resolved = true;
      hand.outcome = "lose";
      hand.result = "Bust";
      blackjack.message = `${player.name} busted Seat ${seat.seat} Hand ${blackjack.currentHandIndex + 1}.`;
    } else if (value === 21) {
      hand.resolved = true;
      hand.result = "21";
      blackjack.message = `${player.name} made 21 on Seat ${seat.seat} Hand ${blackjack.currentHandIndex + 1}.`;
    } else {
      blackjack.message = `${player.name} hit Seat ${seat.seat} Hand ${blackjack.currentHandIndex + 1}.`;
    }
    syncSeatLegacyFields(seat);
    advanceBlackjackTurn(table, blackjack);
    return;
  }

  if (action === "stand") {
    hand.resolved = true;
    hand.result = "Stand";
    syncSeatLegacyFields(seat);
    blackjack.message = `${player.name} stood on Seat ${seat.seat} Hand ${blackjack.currentHandIndex + 1}.`;
    advanceBlackjackTurn(table, blackjack);
    return;
  }

  if (action === "double") {
    if (!canBlackjackDouble(hand, player)) {
      throw new Error("Double is only available on 9, 10, or 11 with two cards.");
    }
    player.bankroll -= hand.bet;
    player.totalWagered += hand.bet;
    hand.bet *= 2;
    hand.doubled = true;
    hand.cards.push(drawBlackjackCard(blackjack));
    const value = getBlackjackHandValue(hand.cards).total;
    hand.resolved = true;
    hand.result = value > 21 ? "Double bust" : "Double";
    hand.outcome = value > 21 ? "lose" : "";
    syncSeatLegacyFields(seat);
    blackjack.message = `${player.name} doubled Seat ${seat.seat} Hand ${blackjack.currentHandIndex + 1}.`;
    advanceBlackjackTurn(table, blackjack);
    return;
  }

  if (action === "split") {
    splitBlackjackHand(table, blackjack, player, seat, hand);
    syncSeatLegacyFields(seat);
    advanceBlackjackTurn(table, blackjack);
    return;
  }

  throw new Error("Unknown blackjack action.");
}

function getCurrentBlackjackHand(blackjack, seat = null) {
  const activeSeat = seat || blackjack.seats.find((item) => item.seat === blackjack.currentSeat);
  if (!activeSeat) return null;
  return getSeatHands(activeSeat)[blackjack.currentHandIndex || 0] || null;
}

function splitBlackjackHand(table, blackjack, player, seat, hand) {
  if (!canBlackjackSplit(seat, hand, player)) {
    throw new Error("Split is only available on pairs. Aces split once; other pairs can split up to 4 times.");
  }
  const hands = getSeatHands(seat);
  const handIndex = Math.max(0, blackjack.currentHandIndex || 0);
  const [firstCard, secondCard] = hand.cards;
  const splitAces = firstCard.rank === "A" && secondCard.rank === "A";

  player.bankroll -= hand.bet;
  player.totalWagered += hand.bet;
  seat.splitCount = (seat.splitCount || 0) + 1;
  if (splitAces) seat.acesSplitUsed = true;

  const firstHand = createBlackjackHand(hand.bet, [firstCard], {
    fromSplit: true,
    splitAceHand: splitAces,
  });
  const secondHand = createBlackjackHand(hand.bet, [secondCard], {
    fromSplit: true,
    splitAceHand: splitAces,
  });

  firstHand.cards.push(drawBlackjackCard(blackjack));
  secondHand.cards.push(drawBlackjackCard(blackjack));

  for (const splitHand of [firstHand, secondHand]) {
    const total = getBlackjackHandValue(splitHand.cards).total;
    if (splitAces) {
      splitHand.resolved = true;
      splitHand.result = `Split aces ${total}`;
    } else if (total === 21) {
      splitHand.resolved = true;
      splitHand.result = "21";
    }
  }

  hands.splice(handIndex, 1, firstHand, secondHand);
  blackjack.currentHandIndex = handIndex;
  blackjack.message = splitAces
    ? `${player.name} split aces on Seat ${seat.seat}. One card was dealt to each ace.`
    : `${player.name} split Seat ${seat.seat} into ${hands.length} hands.`;
}

function resolveOpeningBlackjacks(table, blackjack) {
  const dealerBlackjack = hasBlackjackNatural(blackjack.dealer.cards);
  for (const seat of blackjack.seats.filter((item) => item.active)) {
    for (const hand of getSeatHands(seat)) {
      if (hasBlackjackNatural(hand.cards)) {
        hand.resolved = true;
        hand.result = "Blackjack 3:2";
      }
    }
    syncSeatLegacyFields(seat);
  }
  if (dealerBlackjack) {
    revealDealerHoleCard(blackjack);
    settleBlackjackRound(table, blackjack, "Dealer has blackjack.");
  }
}

function advanceBlackjackTurn(table, blackjack) {
  if (blackjack.phase === "settled") return;
  for (const nextSeat of blackjack.seats) {
    if (!nextSeat.active) continue;
    const hands = getSeatHands(nextSeat);
    const nextHandIndex = hands.findIndex((hand) => !hand.resolved && !hand.outcome);
    if (nextHandIndex < 0) {
      syncSeatLegacyFields(nextSeat);
      continue;
    }
    blackjack.phase = "player-turn";
    blackjack.currentSeat = nextSeat.seat;
    blackjack.currentHandIndex = nextHandIndex;
    blackjack.actionDeadlineAt = Date.now() + BLACKJACK_ACTION_MS;
    blackjack.message = `${nextSeat.name}'s turn on Seat ${nextSeat.seat} Hand ${nextHandIndex + 1}.`;
    return;
  }
  playBlackjackDealer(table, blackjack);
}

function advanceBlackjackToNow(table, now) {
  const blackjack = table.blackjack;
  if (!blackjack || blackjack.phase !== "player-turn" || !blackjack.actionDeadlineAt || blackjack.actionDeadlineAt > now) {
    return;
  }
  const seat = blackjack.seats.find((item) => item.seat === blackjack.currentSeat);
  const hand = seat ? getSeatHands(seat)[blackjack.currentHandIndex || 0] : null;
  if (!seat || !hand || hand.resolved) {
    advanceBlackjackTurn(table, blackjack);
    return;
  }
  hand.resolved = true;
  hand.autoStood = true;
  hand.result = "Auto stand";
  syncSeatLegacyFields(seat);
  blackjack.message = `${seat.name} timed out and stood on Seat ${seat.seat} Hand ${(blackjack.currentHandIndex || 0) + 1}.`;
  advanceBlackjackTurn(table, blackjack);
}

function playBlackjackDealer(table, blackjack) {
  blackjack.phase = "dealer-turn";
  blackjack.currentSeat = null;
  blackjack.currentHandIndex = 0;
  blackjack.actionDeadlineAt = null;
  revealDealerHoleCard(blackjack);
  const needsDealer = blackjack.seats.some((seat) => seat.active && getSeatHands(seat).some((hand) => {
    const value = getBlackjackHandValue(hand.cards).total;
    const natural = hasBlackjackNatural(hand.cards) && !hand.fromSplit;
    return hand.outcome !== "lose" && value <= 21 && !natural;
  }));
  if (needsDealer) {
    while (dealerBlackjackShouldHit(blackjack.dealer.cards)) {
      blackjack.dealer.cards.push(drawBlackjackCard(blackjack));
    }
  }
  settleBlackjackRound(table, blackjack, "Dealer finished.");
}

function settleBlackjackRound(table, blackjack, message) {
  revealDealerHoleCard(blackjack);
  const dealerValue = getBlackjackHandValue(blackjack.dealer.cards);
  const dealerBlackjack = hasBlackjackNatural(blackjack.dealer.cards);
  const dealerBust = dealerValue.total > 21;
  const dealerLabel = dealerBust ? "Dealer bust" : `Dealer ${dealerValue.total}`;
  const netByPlayer = {};

  for (const seat of blackjack.seats.filter((item) => item.active)) {
    const player = table.players[seat.playerId];
    if (!player) continue;
    for (const hand of getSeatHands(seat)) {
      const handValue = getBlackjackHandValue(hand.cards);
      const playerBlackjack = hasBlackjackNatural(hand.cards) && !hand.doubled && !hand.fromSplit;
      let returnAmount = 0;
      let result = hand.result || "";

      if (handValue.total > 21 || hand.outcome === "lose") {
        result = result || "Bust";
        hand.outcome = "lose";
        returnAmount = 0;
      } else if (dealerBlackjack) {
        if (playerBlackjack) {
          result = "Push";
          hand.outcome = "push";
          returnAmount = hand.bet;
        } else {
          result = "Dealer blackjack";
          hand.outcome = "lose";
          returnAmount = 0;
        }
      } else if (playerBlackjack) {
        result = "Blackjack pays 3:2";
        hand.outcome = "blackjack";
        returnAmount = hand.bet * 2.5;
      } else if (dealerBust || handValue.total > dealerValue.total) {
        result = `Win vs ${dealerLabel}`;
        hand.outcome = "win";
        returnAmount = hand.bet * 2;
      } else if (handValue.total === dealerValue.total) {
        result = "Push";
        hand.outcome = "push";
        returnAmount = hand.bet;
      } else {
        result = `Lose vs ${dealerLabel}`;
        hand.outcome = "lose";
        returnAmount = 0;
      }

      hand.resolved = true;
      hand.result = hand.autoStood ? `Auto stand · ${result}` : result;
      hand.settledNet = returnAmount - hand.bet;
      player.bankroll += returnAmount;
      player.handsPlayed += 1;
      netByPlayer[player.id] = (netByPlayer[player.id] || 0) + hand.settledNet;
      player.bestHandNet = Math.max(player.bestHandNet || 0, hand.settledNet);
    }
    syncSeatLegacyFields(seat);
  }

  for (const [playerId, net] of Object.entries(netByPlayer)) {
    if (table.players[playerId]) table.players[playerId].lastHandNet = net;
  }

  blackjack.phase = "settled";
  blackjack.currentSeat = null;
  blackjack.currentHandIndex = 0;
  blackjack.actionDeadlineAt = null;
  blackjack.lastCompletedAt = Date.now();
  blackjack.message = `${message} ${dealerLabel}.`;
}

function sanitizeBlackjack(blackjack, playerId, player) {
  const mySeat = blackjack.seats.find((seat) => seat.playerId === playerId)?.seat || null;
  const currentSeat = blackjack.seats.find((seat) => seat.seat === blackjack.currentSeat) || null;
  const currentHand = currentSeat ? getSeatHands(currentSeat)[blackjack.currentHandIndex || 0] : null;
  return {
    shoeNumber: blackjack.shoeNumber,
    roundNumber: blackjack.roundNumber,
    phase: blackjack.phase,
    cardsRemaining: blackjack.shoe.length,
    currentSeat: blackjack.currentSeat,
    currentHandIndex: blackjack.currentHandIndex || 0,
    actionDeadlineAt: blackjack.actionDeadlineAt,
    secondsRemaining: blackjack.phase === "player-turn" && blackjack.actionDeadlineAt
      ? Math.max(0, Math.ceil((blackjack.actionDeadlineAt - Date.now()) / 1000))
      : null,
    mySeat,
    canStart: (blackjack.phase === "waiting" || blackjack.phase === "settled") && blackjack.seats.some((seat) => seat.playerId),
    canAct: blackjack.phase === "player-turn" && blackjack.seats.find((seat) => seat.seat === blackjack.currentSeat)?.playerId === playerId,
    canDouble: blackjack.phase === "player-turn" && currentSeat?.playerId === playerId && canBlackjackDouble(currentHand, player),
    canSplit: blackjack.phase === "player-turn" && currentSeat?.playerId === playerId && canBlackjackSplit(currentSeat, currentHand, player),
    message: blackjack.message,
    dealer: {
      cards: blackjack.dealer.cards.map((card) => ({ ...card })),
      total: blackjack.dealer.cards.some((card) => card.faceDown) ? null : getBlackjackHandValue(blackjack.dealer.cards).total,
    },
    seats: blackjack.seats.map((seat) => {
      const hands = getSeatHands(seat);
      const currentDisplayHand = hands[blackjack.currentSeat === seat.seat ? blackjack.currentHandIndex || 0 : 0] || hands[0] || null;
      const total = currentDisplayHand?.cards?.length ? getBlackjackHandValue(currentDisplayHand.cards).total : null;
      return {
        seat: seat.seat,
        playerId: seat.playerId,
        name: seat.name,
        bet: seat.bet,
        totalBet: hands.reduce((sum, hand) => sum + (hand.bet || 0), 0) || seat.bet,
        cards: (currentDisplayHand?.cards || seat.cards || []).map((card) => ({ ...card })),
        hands: hands.map((hand, handIndex) => ({
          handIndex,
          bet: hand.bet,
          cards: hand.cards.map((card) => ({ ...card })),
          total: hand.cards.length ? getBlackjackHandValue(hand.cards).total : null,
          resolved: hand.resolved,
          doubled: hand.doubled,
          autoStood: hand.autoStood,
          fromSplit: hand.fromSplit,
          splitAceHand: hand.splitAceHand,
          outcome: hand.outcome,
          result: hand.result,
          settledNet: hand.settledNet,
          turn: blackjack.currentSeat === seat.seat && (blackjack.currentHandIndex || 0) === handIndex,
          canDouble: blackjack.phase === "player-turn" && seat.playerId === playerId && blackjack.currentSeat === seat.seat && (blackjack.currentHandIndex || 0) === handIndex && canBlackjackDouble(hand, player),
          canSplit: blackjack.phase === "player-turn" && seat.playerId === playerId && blackjack.currentSeat === seat.seat && (blackjack.currentHandIndex || 0) === handIndex && canBlackjackSplit(seat, hand, player),
        })),
        total,
        active: seat.active,
        resolved: seat.active ? hands.every((hand) => hand.resolved || hand.outcome) : seat.resolved,
        doubled: hands.some((hand) => hand.doubled),
        autoStood: hands.some((hand) => hand.autoStood),
        splitCount: seat.splitCount || 0,
        acesSplitUsed: Boolean(seat.acesSplitUsed),
        outcome: seat.outcome,
        result: hands.length > 1 ? `${hands.length} hands` : (hands[0]?.result || seat.result),
        settledNet: hands.reduce((sum, hand) => sum + (hand.settledNet || 0), 0),
        self: seat.playerId === playerId,
        turn: blackjack.currentSeat === seat.seat,
      };
    }),
  };
}

function assertBlackjackSeatSetupOpen(blackjack) {
  if (blackjack.phase !== "waiting" && blackjack.phase !== "settled") {
    throw new Error("Blackjack seats are locked until this hand finishes.");
  }
  if (blackjack.phase === "settled") {
    blackjack.phase = "waiting";
    blackjack.currentSeat = null;
    blackjack.currentHandIndex = 0;
    blackjack.message = "Seats are open for the next blackjack hand.";
  }
}

function clearBlackjackSeat(seat) {
  seat.playerId = null;
  seat.name = "";
  seat.cards = [];
  seat.hands = [];
  seat.splitCount = 0;
  seat.acesSplitUsed = false;
  seat.active = false;
  seat.resolved = false;
  seat.doubled = false;
  seat.autoStood = false;
  seat.outcome = "";
  seat.result = "";
  seat.settledNet = 0;
}

function getBlackjackSeat(blackjack, seatNumber) {
  const parsed = Number(seatNumber);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > BLACKJACK_SEATS) {
    throw new Error("Choose a blackjack seat from 1 to 5.");
  }
  return blackjack.seats[parsed - 1];
}

function normalizeBlackjackBet(bet) {
  const parsed = Number(bet) || BLACKJACK_MIN_BET;
  const rounded = Math.round(parsed / 25) * 25;
  return Math.max(BLACKJACK_MIN_BET, Math.min(BLACKJACK_MAX_BET, rounded));
}

function normalizeBlackjackChip(chip) {
  const parsed = Number(chip);
  if (!CHIP_VALUES.has(parsed)) {
    throw new Error("Choose a chip: $25, $50, $100, $200, or $500.");
  }
  return parsed;
}

function drawBlackjackCard(blackjack) {
  if (blackjack.shoe.length <= 0) {
    blackjack.shoe = shuffle(createBlackjackShoe());
    blackjack.shoeNumber += 1;
  }
  return blackjack.shoe.pop();
}

function revealDealerHoleCard(blackjack) {
  blackjack.dealer.cards = blackjack.dealer.cards.map((card) => ({ ...card, faceDown: false }));
}

function getBlackjackRankValue(rank) {
  if (rank === "A") return 11;
  if (["J", "Q", "K"].includes(rank)) return 10;
  return Number(rank);
}

function getBlackjackHandValue(cards) {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    if (card.faceDown) continue;
    total += getBlackjackRankValue(card.rank);
    if (card.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}

function hasBlackjackNatural(cards) {
  if (cards.length !== 2) return false;
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += getBlackjackRankValue(card.rank);
    if (card.rank === "A") aces += 1;
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return total === 21;
}

function dealerBlackjackShouldHit(cards) {
  const value = getBlackjackHandValue(cards);
  return value.total < 17 || (value.total === 17 && value.soft);
}

function canBlackjackDouble(hand, player) {
  if (!hand || hand.cards.length !== 2 || hand.doubled || hand.resolved || hand.splitAceHand) return false;
  if (!player || player.bankroll < hand.bet) return false;
  const total = getBlackjackHandValue(hand.cards).total;
  return total === 9 || total === 10 || total === 11;
}

function canBlackjackSplit(seat, hand, player) {
  if (!seat || !hand || !player) return false;
  if (hand.cards.length !== 2 || hand.resolved || hand.doubled) return false;
  if (player.bankroll < hand.bet) return false;
  const [first, second] = hand.cards;
  if (!first || !second) return false;
  const samePairValue = getBlackjackRankValue(first.rank) === getBlackjackRankValue(second.rank);
  if (!samePairValue) return false;
  const isAces = first.rank === "A" && second.rank === "A";
  if (isAces) return !seat.acesSplitUsed && (seat.splitCount || 0) === 0;
  return (seat.splitCount || 0) < BLACKJACK_MAX_SPLITS && getSeatHands(seat).length < BLACKJACK_MAX_HANDS_PER_SEAT;
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
