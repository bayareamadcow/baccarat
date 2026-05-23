const DECKS = 8;
const CARDS_PER_DECK = 52;
const STARTING_BANKROLL = 5000;
const CUT_CARD_REMAINING = 18;
const DEAL_MS = 300;
const THIRD_CARD_PAUSE_MS = 720;
const RESULT_SPLASH_MS = 1280;
const PAYOUT_ANIMATION_MS = 1050;
const ROAD_ROWS = 6;
const BIG_ROAD_MIN_COLUMNS = 18;
const DERIVED_ROAD_MIN_COLUMNS = 12;
const BET_KEYS = ["player", "panda", "tie", "dragon", "banker"];
const CHIPS = [25, 50, 100, 200, 500];
const LEADERBOARD_SIZE = 10;

const SUITS = [
  { code: "H", symbol: "♥", red: true },
  { code: "D", symbol: "♦", red: true },
  { code: "C", symbol: "♣", red: false },
  { code: "S", symbol: "♠", red: false },
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
  player: "闲",
  banker: "庄",
  tie: "和",
  dragon: "Dragon 7",
  panda: "Panda 8",
};

const SUIT_NAMES = {
  H: "红桃",
  D: "方片",
  C: "草花",
  S: "黑桃",
};

const dom = {
  bankroll: document.querySelector("#bankroll"),
  roundNumber: document.querySelector("#round-number"),
  shoeNumber: document.querySelector("#shoe-number"),
  reloadCount: document.querySelector("#reload-count"),
  shoeCount: document.querySelector("#shoe-count"),
  playerCards: document.querySelector("#player-cards"),
  bankerCards: document.querySelector("#banker-cards"),
  playerTotal: document.querySelector("#player-total"),
  bankerTotal: document.querySelector("#banker-total"),
  status: document.querySelector("#status"),
  dealButton: document.querySelector("#deal-btn"),
  clearButton: document.querySelector("#clear-btn"),
  repeatButton: document.querySelector("#repeat-btn"),
  reloadButton: document.querySelector("#reload-btn"),
  newShoeButton: document.querySelector("#new-shoe-btn"),
  chipRack: document.querySelector("#chip-rack"),
  bigRoad: document.querySelector("#big-road"),
  bigEyeRoad: document.querySelector("#big-eye-road"),
  smallRoad: document.querySelector("#small-road"),
  cockroachRoad: document.querySelector("#cockroach-road"),
  beadRoad: document.querySelector("#bead-road"),
  forecastGrid: document.querySelector("#forecast-grid"),
  statsList: document.querySelector("#stats-list"),
  lastResult: document.querySelector("#last-result"),
  resultCard: document.querySelector("#result-card"),
  payoutLayer: document.querySelector("#payout-layer"),
  playerNameInput: document.querySelector("#player-name"),
  tournamentStatus: document.querySelector("#tournament-status"),
  tournamentScore: document.querySelector("#tournament-score"),
  tournamentHands: document.querySelector("#tournament-hands"),
  tournamentBonus: document.querySelector("#tournament-bonus"),
  leaderboard: document.querySelector("#leaderboard"),
  topLeaderboard: document.querySelector("#top-leaderboard"),
  tableCode: document.querySelector("#table-code"),
  betBoxes: [...document.querySelectorAll("[data-bet-target]")],
  betAmounts: {
    player: document.querySelector("#bet-player"),
    banker: document.querySelector("#bet-banker"),
    tie: document.querySelector("#bet-tie"),
    dragon: document.querySelector("#bet-dragon"),
    panda: document.querySelector("#bet-panda"),
  },
};

const state = {
  bankroll: STARTING_BANKROLL,
  playerName: getSavedPlayerName(),
  handsPlayed: 0,
  totalWagered: 0,
  bonusHits: 0,
  bestHandNet: 0,
  lastHandNet: 0,
  reloadCount: 0,
  roundNumber: 0,
  shoeNumber: 0,
  selectedChip: 25,
  shoe: [],
  phase: "betting",
  bets: createEmptyBets(),
  lastBets: null,
  player: [],
  banker: [],
  history: [],
  message: "选择下注后发牌。",
  lastOutcome: null,
};

function init() {
  bindEvents();
  newShoe("新 shoe 已洗好。");
  render();
}

function bindEvents() {
  dom.chipRack.addEventListener("click", (event) => {
    const chip = event.target.closest("[data-chip]");
    if (!chip) return;
    state.selectedChip = Number(chip.dataset.chip);
    render();
  });

  dom.betBoxes.forEach((box) => {
    box.addEventListener("click", () => addBet(box.dataset.betTarget));
  });

  dom.playerNameInput.addEventListener("input", () => {
    state.playerName = normalizePlayerName(dom.playerNameInput.value);
    savePlayerName(state.playerName);
    renderTournament();
  });

  dom.clearButton.addEventListener("click", clearBets);
  dom.repeatButton.addEventListener("click", repeatLastBet);
  dom.reloadButton.addEventListener("click", reloadChips);
  dom.dealButton.addEventListener("click", dealRound);
  dom.newShoeButton.addEventListener("click", () => {
    newShoe("手动换了一个新 shoe。");
    render();
  });
}

function createEmptyBets() {
  return BET_KEYS.reduce((bets, key) => {
    bets[key] = 0;
    return bets;
  }, {});
}

function newShoe(message, clearBets = true) {
  state.shoe = shuffle(createShoe());
  state.shoeNumber += 1;
  state.phase = "betting";
  state.player = [];
  state.banker = [];
  if (clearBets) {
    state.bets = createEmptyBets();
  }
  state.lastOutcome = null;
  state.message = message;
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

function addBet(target) {
  if (state.phase !== "betting") return;
  if (getTotalBet() + state.selectedChip > state.bankroll) {
    state.message = "余额不够覆盖下注。";
    render();
    return;
  }
  state.bets[target] += state.selectedChip;
  state.message = `${LABELS[target]} 加注 ${formatMoney(state.selectedChip)}。`;
  render();
}

function clearBets() {
  if (state.phase !== "betting") return;
  state.bets = createEmptyBets();
  state.message = "下注已清空。";
  render();
}

function repeatLastBet() {
  if (state.phase !== "betting") return;
  if (!state.lastBets || getBetsTotal(state.lastBets) <= 0) {
    state.message = "还没有上一局下注可以重复。";
    render();
    return;
  }

  const repeatTotal = getBetsTotal(state.lastBets);
  if (repeatTotal > state.bankroll) {
    state.message = `余额不够重复上一局 ${formatMoney(repeatTotal)}。`;
    render();
    return;
  }

  state.bets = cloneBets(state.lastBets);
  state.message = `已重复上一局下注：${formatMoney(repeatTotal)}。`;
  render();
}

function reloadChips() {
  if (state.phase !== "betting") return;
  state.bankroll = STARTING_BANKROLL;
  state.reloadCount += 1;
  state.bets = createEmptyBets();
  state.message = `Reload 筹码第 ${state.reloadCount} 次，余额回到 ${formatMoney(STARTING_BANKROLL)}。`;
  render();
}

async function dealRound() {
  if (state.phase !== "betting") return;
  const totalBet = getTotalBet();
  if (totalBet <= 0) {
    state.message = "至少下一口注再发牌。";
    render();
    return;
  }

  if (state.shoe.length <= CUT_CARD_REMAINING) {
    newShoe("切牌位到了，自动换新 shoe。", false);
  }

  state.phase = "dealing";
  state.lastBets = cloneBets(state.bets);
  state.bankroll -= totalBet;
  state.roundNumber += 1;
  state.player = [];
  state.banker = [];
  state.lastOutcome = null;
  state.message = "开局发牌中。";
  render();

  await dealTo("player", "闲第一张。");
  await dealTo("banker", "庄第一张。");
  await dealTo("player", "闲第二张。");
  await dealTo("banker", "庄第二张。");

  await playDrawRules();
  const outcome = settleRound();
  state.phase = "settled";
  render();
  await animateResultSplash(outcome);
  await animatePayout(outcome);
  state.phase = "betting";
  state.bets = createEmptyBets();
  render();
}

async function dealTo(side, message, slow = false) {
  const card = drawCard();
  card.fresh = true;
  card.slow = slow;
  state[side].push(card);
  state.message = message;
  render();
  await wait(slow ? THIRD_CARD_PAUSE_MS : DEAL_MS);
  card.fresh = false;
  card.slow = false;
}

function drawCard() {
  if (state.shoe.length === 0) {
    state.shoe = shuffle(createShoe());
  }
  return { ...state.shoe.pop() };
}

async function playDrawRules() {
  const playerStart = handTotal(state.player);
  const bankerStart = handTotal(state.banker);
  if (playerStart >= 8 || bankerStart >= 8) {
    state.message = `Natural ${playerStart} / ${bankerStart}，不补牌。`;
    render();
    await wait(DEAL_MS);
    return;
  }

  let playerThirdValue = null;
  if (playerStart <= 5) {
    state.message = "闲需要补牌，先补闲。";
    render();
    await wait(THIRD_CARD_PAUSE_MS);
    await dealTo("player", "闲补牌完成。", true);
    playerThirdValue = state.player[2].value;
  }

  const bankerStartAfterPlayer = handTotal(state.banker);
  if (bankerShouldDraw(bankerStartAfterPlayer, playerThirdValue)) {
    state.message = "庄需要补牌，稍等后补庄。";
    render();
    await wait(THIRD_CARD_PAUSE_MS);
    await dealTo("banker", "庄补牌完成。", true);
  } else {
    state.message = "庄不补牌。";
    render();
    await wait(DEAL_MS);
  }
}

function bankerShouldDraw(total, playerThirdValue) {
  if (playerThirdValue === null) {
    return total <= 5;
  }
  if (total <= 2) return true;
  if (total === 3) return playerThirdValue !== 8;
  if (total === 4) return playerThirdValue >= 2 && playerThirdValue <= 7;
  if (total === 5) return playerThirdValue >= 4 && playerThirdValue <= 7;
  if (total === 6) return playerThirdValue === 6 || playerThirdValue === 7;
  return false;
}

function settleRound() {
  const playerTotal = handTotal(state.player);
  const bankerTotal = handTotal(state.banker);
  const winner = playerTotal > bankerTotal ? "player" : bankerTotal > playerTotal ? "banker" : "tie";
  const dragon = winner === "banker" && state.banker.length === 3 && bankerTotal === 7;
  const panda = winner === "player" && state.player.length === 3 && playerTotal === 8;
  const natural = isNaturalResult(playerTotal, bankerTotal);
  const naturalTotal = natural ? (winner === "banker" ? bankerTotal : playerTotal) : null;

  const settlements = [];
  let payout = 0;
  if (winner === "player") {
    payout += addPaySettlement(settlements, "player", 1);
  } else if (winner === "banker") {
    if (dragon) {
      payout += addPushSettlement(settlements, "banker", "Dragon 7 Push");
    } else {
      payout += addPaySettlement(settlements, "banker", 1);
    }
  } else {
    payout += addPushSettlement(settlements, "player", "Tie Push");
    payout += addPushSettlement(settlements, "banker", "Tie Push");
    payout += addPaySettlement(settlements, "tie", 8);
  }

  if (dragon) payout += addPaySettlement(settlements, "dragon", 40);
  if (panda) payout += addPaySettlement(settlements, "panda", 25);
  state.bankroll += payout;

  const outcome = {
    winner,
    playerTotal,
    bankerTotal,
    natural,
    naturalTotal,
    dragon,
    panda,
    payout,
    net: payout - getTotalBet(),
    settlements,
    bankerPushOnDragon: dragon && state.bets.banker > 0,
    bets: { ...state.bets },
    playerCards: [...state.player],
    bankerCards: [...state.banker],
  };
  updateTournamentStats(outcome, getTotalBet());
  state.history.unshift(outcome);
  state.history = state.history.slice(0, 72);
  state.lastOutcome = outcome;
  state.message = buildOutcomeMessage(outcome);
  return outcome;
}

function pay(key, odds) {
  const stake = state.bets[key] || 0;
  return stake > 0 ? stake * (odds + 1) : 0;
}

function push(key) {
  return state.bets[key] || 0;
}

function isNaturalResult(playerTotal, bankerTotal) {
  return state.player.length === 2 && state.banker.length === 2 && (playerTotal >= 8 || bankerTotal >= 8);
}

function addPaySettlement(settlements, key, odds) {
  const stake = state.bets[key] || 0;
  if (stake <= 0) return 0;
  const profit = stake * odds;
  const amount = stake + profit;
  settlements.push({
    key,
    label: LABELS[key],
    type: "win",
    odds,
    stake,
    profit,
    amount,
  });
  return amount;
}

function addPushSettlement(settlements, key, reason) {
  const stake = state.bets[key] || 0;
  if (stake <= 0) return 0;
  settlements.push({
    key,
    label: LABELS[key],
    type: "push",
    reason,
    stake,
    profit: 0,
    amount: stake,
  });
  return stake;
}

function buildOutcomeMessage(outcome) {
  const winnerLabel = outcome.winner === "tie" ? "和" : LABELS[outcome.winner];
  const bonuses = [
    outcome.natural ? `Natural ${outcome.naturalTotal}` : "",
    outcome.dragon ? "Dragon 7 命中 40:1，庄主注 Push 不赔" : "",
    outcome.panda ? "Panda 8 命中 25:1" : "",
  ].filter(Boolean).join("，");
  return `${winnerLabel}赢，闲 ${outcome.playerTotal} / 庄 ${outcome.bankerTotal}${bonuses ? `，${bonuses}` : ""}。`;
}

function handTotal(cards) {
  return cards.reduce((sum, card) => sum + card.value, 0) % 10;
}

function getTotalBet() {
  return getBetsTotal(state.bets);
}

function getBetsTotal(bets) {
  return BET_KEYS.reduce((sum, key) => sum + (bets[key] || 0), 0);
}

function cloneBets(bets) {
  return BET_KEYS.reduce((clone, key) => {
    clone[key] = bets[key] || 0;
    return clone;
  }, {});
}

function updateTournamentStats(outcome, wagered) {
  state.handsPlayed += 1;
  state.totalWagered += wagered;
  state.lastHandNet = outcome.net;
  state.bestHandNet = Math.max(state.bestHandNet, outcome.net);
  if (outcome.dragon || outcome.panda) {
    state.bonusHits += 1;
  }
}

function render() {
  dom.bankroll.textContent = formatMoney(state.bankroll);
  dom.roundNumber.textContent = String(state.roundNumber);
  dom.shoeNumber.textContent = String(state.shoeNumber);
  dom.reloadCount.textContent = String(state.reloadCount);
  dom.shoeCount.textContent = `${state.shoe.length} cards`;
  dom.playerTotal.textContent = state.player.length ? handTotal(state.player) : "--";
  dom.bankerTotal.textContent = state.banker.length ? handTotal(state.banker) : "--";
  dom.status.textContent = state.message;
  dom.dealButton.disabled = state.phase !== "betting";
  dom.clearButton.disabled = state.phase !== "betting";
  dom.repeatButton.disabled = state.phase !== "betting"
    || !state.lastBets
    || getBetsTotal(state.lastBets) <= 0
    || getBetsTotal(state.lastBets) > state.bankroll;
  dom.reloadButton.disabled = state.phase !== "betting";
  dom.newShoeButton.disabled = state.phase !== "betting";
  renderCards(dom.playerCards, state.player);
  renderCards(dom.bankerCards, state.banker);
  renderBets();
  renderRoads();
  renderLastResult();
  renderTournament();
}

function renderCards(host, cards) {
  host.replaceChildren();
  cards.forEach((card) => host.appendChild(buildCard(card)));
}

function buildCard(card) {
  const element = document.createElement("div");
  element.className = `card suit-${card.suit.toLowerCase()}${card.red ? " red" : ""}${card.fresh ? " new" : ""}${card.slow ? " slow" : ""}`;
  element.setAttribute("aria-label", `${card.rank}${SUIT_NAMES[card.suit]}`);
  element.innerHTML = `
    <div class="corner"><span>${card.rank}</span><span class="corner-suit">${card.symbol}</span></div>
    <div class="pip-field" aria-hidden="true">
      <span class="pip ghost top">${card.symbol}</span>
      <span class="pip main">${card.symbol}</span>
      <span class="pip ghost bottom">${card.symbol}</span>
    </div>
    <div class="face"><span class="rank">${card.rank}</span><span class="suit">${card.symbol}</span></div>
    <div class="corner bottom"><span>${card.rank}</span><span class="corner-suit">${card.symbol}</span></div>
  `;
  return element;
}

function renderBets() {
  BET_KEYS.forEach((key) => {
    dom.betAmounts[key].textContent = formatMoney(state.bets[key]);
  });
  dom.betBoxes.forEach((box) => {
    const key = box.dataset.betTarget;
    box.disabled = state.phase !== "betting";
    box.classList.toggle("has-bet", state.bets[key] > 0);
  });
  [...dom.chipRack.querySelectorAll("[data-chip]")].forEach((chip) => {
    chip.classList.toggle("active", Number(chip.dataset.chip) === state.selectedChip);
    chip.disabled = state.phase !== "betting";
  });
}

function renderRoads() {
  const outcomes = [...state.history].reverse();
  const bigRoad = buildBigRoad(outcomes);
  renderBigRoad(bigRoad);
  renderDerivedRoad(dom.bigEyeRoad, buildDerivedRoad(bigRoad, 1), "hollow");
  renderDerivedRoad(dom.smallRoad, buildDerivedRoad(bigRoad, 2), "solid");
  renderDerivedRoad(dom.cockroachRoad, buildDerivedRoad(bigRoad, 3), "slash");
  renderBeadRoad(outcomes);
  renderForecast(outcomes);

  const stats = {
    庄: outcomes.filter((item) => item.winner === "banker").length,
    闲: outcomes.filter((item) => item.winner === "player").length,
    和: outcomes.filter((item) => item.winner === "tie").length,
    Dragon: outcomes.filter((item) => item.dragon).length,
    Panda: outcomes.filter((item) => item.panda).length,
  };
  dom.statsList.replaceChildren();
  Object.entries(stats).forEach(([label, value]) => {
    const row = document.createElement("div");
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    dom.statsList.appendChild(row);
  });
}

function buildBigRoad(outcomes) {
  const placements = [];
  const occupied = new Set();
  let lastWinner = null;
  let col = 0;
  let row = 0;

  outcomes.forEach((outcome) => {
    if (outcome.winner === "tie") {
      if (placements.length > 0) {
        placements[placements.length - 1].ties += 1;
        placements[placements.length - 1].tieNaturals.push(outcome);
      }
      return;
    }

    if (!lastWinner) {
      col = 0;
      row = 0;
    } else if (outcome.winner === lastWinner) {
      const nextRow = row + 1;
      if (nextRow < ROAD_ROWS && !occupied.has(roadKey(col, nextRow))) {
        row = nextRow;
      } else {
        col += 1;
      }
    } else {
      col = getMaxColumn(placements) + 1;
      row = 0;
    }

    const placement = { col, row, outcome, winner: outcome.winner, ties: 0, tieNaturals: [] };
    placements.push(placement);
    occupied.add(roadKey(col, row));
    lastWinner = outcome.winner;
  });

  return {
    placements,
    occupied,
    heights: buildColumnHeights(placements),
  };
}

function buildColumnHeights(placements) {
  const heights = new Map();
  placements.forEach((placement) => {
    const current = heights.get(placement.col) || 0;
    heights.set(placement.col, Math.max(current, placement.row + 1));
  });
  return heights;
}

function buildDerivedRoad(bigRoad, lookback) {
  const marks = [];
  bigRoad.placements.forEach((placement) => {
    const color = getDerivedColor(bigRoad, placement, lookback);
    if (color) {
      marks.push({ color, source: placement });
    }
  });
  return buildColorRoad(marks);
}

function getDerivedColor(bigRoad, placement, lookback) {
  if (placement.row === 0) {
    if (placement.col - lookback - 1 < 0) return null;
    const previousDepth = bigRoad.heights.get(placement.col - 1) || 0;
    const compareDepth = bigRoad.heights.get(placement.col - 1 - lookback) || 0;
    return previousDepth === compareDepth ? "red" : "blue";
  }

  if (placement.col - lookback < 0) return null;
  const sameRowExists = bigRoad.occupied.has(roadKey(placement.col - lookback, placement.row));
  const aboveExists = bigRoad.occupied.has(roadKey(placement.col - lookback, placement.row - 1));
  return sameRowExists === aboveExists ? "red" : "blue";
}

function buildColorRoad(marks) {
  const placements = [];
  const occupied = new Set();
  let lastColor = null;
  let col = 0;
  let row = 0;

  marks.forEach((mark) => {
    if (!lastColor) {
      col = 0;
      row = 0;
    } else if (mark.color === lastColor) {
      const nextRow = row + 1;
      if (nextRow < ROAD_ROWS && !occupied.has(roadKey(col, nextRow))) {
        row = nextRow;
      } else {
        col += 1;
      }
    } else {
      col = getMaxColumn(placements) + 1;
      row = 0;
    }

    placements.push({ col, row, ...mark });
    occupied.add(roadKey(col, row));
    lastColor = mark.color;
  });

  return placements;
}

function renderBigRoad(bigRoad) {
  const columns = Math.max(BIG_ROAD_MIN_COLUMNS, getMaxColumn(bigRoad.placements) + 1);
  const placementMap = new Map(bigRoad.placements.map((placement) => [roadKey(placement.col, placement.row), placement]));
  renderRoadMatrix(dom.bigRoad, columns, ROAD_ROWS, "road-cell", (cell, col, row) => {
    const placement = placementMap.get(roadKey(col, row));
    if (placement) cell.appendChild(buildBigRoadMark(placement));
  });
}

function renderDerivedRoad(host, placements, style) {
  const columns = Math.max(DERIVED_ROAD_MIN_COLUMNS, getMaxColumn(placements) + 1);
  const placementMap = new Map(placements.map((placement) => [roadKey(placement.col, placement.row), placement]));
  renderRoadMatrix(host, columns, ROAD_ROWS, "mini-cell", (cell, col, row) => {
    const placement = placementMap.get(roadKey(col, row));
    if (placement) cell.appendChild(buildDerivedMark(placement.color, style));
  });
}

function renderBeadRoad(outcomes) {
  const columns = Math.max(8, Math.ceil(outcomes.length / ROAD_ROWS));
  renderRoadMatrix(dom.beadRoad, columns, ROAD_ROWS, "mini-cell", (cell, col, row) => {
    const outcome = outcomes[col * ROAD_ROWS + row];
    if (outcome) cell.appendChild(buildOutcomeMark(outcome, "bead"));
  });
}

function renderForecast(outcomes) {
  dom.forecastGrid.replaceChildren();
  ["banker", "player"].forEach((winner) => {
    const simulated = [...outcomes, createForecastOutcome(winner)];
    const bigRoad = buildBigRoad(simulated);
    const latest = bigRoad.placements[bigRoad.placements.length - 1];
    const card = document.createElement("div");
    card.className = `forecast-option ${winner}`;
    card.innerHTML = `<strong>${LABELS[winner]}</strong>`;

    [
      ["大眼", 1, "hollow"],
      ["小路", 2, "solid"],
      ["小强", 3, "slash"],
    ].forEach(([label, lookback, style]) => {
      const row = document.createElement("span");
      const color = latest ? getDerivedColor(bigRoad, latest, lookback) : null;
      row.append(label);
      row.appendChild(color ? buildDerivedMark(color, style) : buildPendingMark());
      card.appendChild(row);
    });

    dom.forecastGrid.appendChild(card);
  });
}

function renderRoadMatrix(host, columns, rows, cellClass, fillCell) {
  host.replaceChildren();
  host.style.setProperty("--columns", String(columns));
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < columns; col += 1) {
      const cell = document.createElement("div");
      cell.className = cellClass;
      fillCell(cell, col, row);
      host.appendChild(cell);
    }
  }
}

function buildBigRoadMark(placement) {
  const mark = buildOutcomeMark(placement.outcome, "big");
  if (placement.outcome.natural) {
    mark.classList.add("natural");
  }
  if (placement.outcome.dragon) {
    mark.appendChild(buildBonusBadge("dragon"));
  }
  if (placement.outcome.panda) {
    mark.appendChild(buildBonusBadge("panda"));
  }

  if (placement.ties > 0) {
    mark.classList.add("has-tie");
    const tie = document.createElement("span");
    tie.className = "tie-stroke";
    if (placement.tieNaturals.length > 0) {
      tie.classList.add("natural-tie");
    }
    mark.appendChild(tie);
    if (placement.ties > 1) {
      const badge = document.createElement("span");
      badge.className = "tie-badge";
      badge.textContent = placement.ties;
      mark.appendChild(badge);
    }
    const latestNaturalTie = placement.tieNaturals[placement.tieNaturals.length - 1];
    if (latestNaturalTie) {
      const badge = buildNaturalBadge(latestNaturalTie);
      badge.className = "natural-badge tie-natural";
      mark.appendChild(badge);
    }
  }
  return mark;
}

function buildNaturalBadge(outcome) {
  const badge = document.createElement("span");
  badge.className = "natural-badge";
  badge.textContent = outcome.naturalTotal;
  return badge;
}

function buildBonusBadge(type) {
  const badge = document.createElement("span");
  badge.className = `bonus-badge ${type}`;
  badge.textContent = type === "dragon" ? "龍" : "熊";
  badge.title = type === "dragon" ? "Dragon 7" : "Panda 8";
  return badge;
}

function buildOutcomeMark(outcome, mode = "bead") {
  const mark = document.createElement("span");
  mark.className = `mark ${mode} ${outcome.winner}${outcome.dragon ? " dragon" : ""}${outcome.panda ? " panda" : ""}`;
  mark.textContent = mode === "big" && outcome.natural ? outcome.naturalTotal : mode === "big" ? "" : outcome.winner === "banker" ? outcome.bankerTotal : outcome.winner === "player" ? outcome.playerTotal : "和";
  mark.title = buildOutcomeMessage(outcome);
  return mark;
}

function buildDerivedMark(color, style) {
  const mark = document.createElement("span");
  mark.className = `derived-mark ${color} ${style}`;
  return mark;
}

function buildPendingMark() {
  const mark = document.createElement("span");
  mark.className = "derived-mark pending";
  mark.textContent = "--";
  return mark;
}

function createForecastOutcome(winner) {
  return {
    winner,
    playerTotal: winner === "player" ? "?" : "?",
    bankerTotal: winner === "banker" ? "?" : "?",
    dragon: false,
    panda: false,
  };
}

function getMaxColumn(placements) {
  return placements.reduce((max, placement) => Math.max(max, placement.col), -1);
}

function roadKey(col, row) {
  return `${col}:${row}`;
}

function renderLastResult() {
  if (!state.lastOutcome) {
    dom.lastResult.textContent = "--";
    dom.resultCard.textContent = "等待下一局。";
    return;
  }

  const outcome = state.lastOutcome;
  dom.lastResult.textContent = outcome.winner === "tie" ? "和" : LABELS[outcome.winner];
  dom.resultCard.innerHTML = `
    <strong>${buildOutcomeMessage(outcome)}</strong><br>
    闲牌：${formatCards(outcome.playerCards)}<br>
    庄牌：${formatCards(outcome.bankerCards)}<br>
    ${buildSettlementNote(outcome)}
    本局返还：${formatMoney(outcome.payout)} / 净输赢：${formatSignedMoney(outcome.net)}
    ${buildSettlementBreakdown(outcome)}
  `;
}

function formatCards(cards) {
  return cards.map((card) => `${card.rank}${card.symbol}`).join(" ");
}

function buildSettlementNote(outcome) {
  if (outcome.bankerPushOnDragon) {
    return `庄主注：Dragon 7 不付 1:1，只退本金 ${formatMoney(outcome.bets.banker)}。<br>`;
  }
  return "";
}

async function animatePayout(outcome) {
  if (!dom.payoutLayer || !outcome.settlements.length || prefersReducedMotion()) {
    return;
  }

  dom.payoutLayer.replaceChildren();
  const target = dom.bankroll.closest(".hud-card") || dom.bankroll;
  const targetRect = target.getBoundingClientRect();
  const targetPoint = getRectCenter(targetRect);

  outcome.settlements.forEach((settlement, settlementIndex) => {
    const source = document.querySelector(`[data-bet-target="${settlement.key}"]`);
    if (!source) return;
    const sourcePoint = getRectCenter(source.getBoundingClientRect());
    const color = getPayoutColor(settlement.key, settlement.type);
    const chipCount = getPayoutChipCount(settlement.amount);

    for (let index = 0; index < chipCount; index += 1) {
      const chip = document.createElement("span");
      chip.className = `payout-token ${settlement.type}`;
      chip.textContent = chipLabel(settlement.amount, chipCount, index);
      chip.style.setProperty("--from-x", `${sourcePoint.x + (index - 1) * 8}px`);
      chip.style.setProperty("--from-y", `${sourcePoint.y + (index % 2 ? 8 : -8)}px`);
      chip.style.setProperty("--to-x", `${targetPoint.x + (index - 1) * 5}px`);
      chip.style.setProperty("--to-y", `${targetPoint.y + (index % 2 ? -4 : 4)}px`);
      chip.style.setProperty("--mid-x", `${(sourcePoint.x + targetPoint.x) / 2 + (index - 1) * 12}px`);
      chip.style.setProperty("--mid-y", `${(sourcePoint.y + targetPoint.y) / 2}px`);
      chip.style.setProperty("--arc", `${-80 - index * 18}px`);
      chip.style.setProperty("--delay", `${settlementIndex * 160 + index * 48}ms`);
      chip.style.setProperty("--chip-color", color);
      dom.payoutLayer.appendChild(chip);
    }

    const label = document.createElement("span");
    label.className = `payout-label ${settlement.type}`;
    label.textContent = settlement.type === "push"
      ? `${settlement.label} 退 ${formatMoney(settlement.amount)}`
      : `${settlement.label} +${formatMoney(settlement.profit)}`;
    label.style.setProperty("--from-x", `${sourcePoint.x}px`);
    label.style.setProperty("--from-y", `${sourcePoint.y - 48}px`);
    label.style.setProperty("--to-x", `${targetPoint.x - 12}px`);
    label.style.setProperty("--to-y", `${targetPoint.y - 48}px`);
    label.style.setProperty("--delay", `${settlementIndex * 160}ms`);
    dom.payoutLayer.appendChild(label);
  });

  target.classList.add("payout-receive");
  await wait(PAYOUT_ANIMATION_MS + outcome.settlements.length * 180);
  target.classList.remove("payout-receive");
  dom.payoutLayer.replaceChildren();
}

async function animateResultSplash(outcome) {
  if (!dom.payoutLayer || prefersReducedMotion()) {
    return;
  }

  dom.payoutLayer.replaceChildren();
  const type = getResultSplashType(outcome);
  const splash = document.createElement("div");
  splash.className = `result-splash ${type}`;
  splash.setAttribute("role", "status");
  splash.setAttribute("aria-label", getResultSplashLabel(outcome, type));
  splash.innerHTML = buildResultSplashMarkup(outcome, type);
  dom.payoutLayer.appendChild(splash);

  await wait(RESULT_SPLASH_MS);
  splash.remove();
}

function getResultSplashType(outcome) {
  if (outcome.dragon) return "dragon";
  if (outcome.panda) return "panda";
  return outcome.winner;
}

function getResultSplashLabel(outcome, type) {
  if (type === "dragon") return "Dragon 7 bonus hit";
  if (type === "panda") return "Panda 8 bonus hit";
  return `${LABELS[outcome.winner]} wins ${outcome.playerTotal} to ${outcome.bankerTotal}`;
}

function buildResultSplashMarkup(outcome, type) {
  if (type === "dragon") {
    return `
      <div class="result-aura"></div>
      <div class="dragon-scene" aria-hidden="true">
        <span class="dragon-trail"></span>
        <span class="dragon-mark">龍</span>
        <span class="dragon-flame"></span>
      </div>
      <strong>Dragon 7</strong>
      <em>Banker three-card 7</em>
    `;
  }

  if (type === "panda") {
    return `
      <div class="result-aura"></div>
      <div class="panda-scene" aria-hidden="true">
        <span class="bamboo bamboo-left"></span>
        <span class="panda-face">熊</span>
        <span class="bamboo bamboo-right"></span>
      </div>
      <strong>Panda 8</strong>
      <em>Player three-card 8</em>
    `;
  }

  const winnerLabel = type === "banker" ? "庄" : type === "player" ? "闲" : "和";
  const resultText = type === "tie" ? "Tie" : `${type === "banker" ? "Banker" : "Player"} wins`;

  return `
    <div class="result-aura"></div>
    <div class="winner-symbol" aria-hidden="true">${winnerLabel}</div>
    <strong>${winnerLabel}</strong>
    <em>${resultText} ${outcome.playerTotal} - ${outcome.bankerTotal}</em>
  `;
}

function getRectCenter(rect) {
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

function getPayoutColor(key, type) {
  if (type === "push") return "#cbd5c3";
  if (key === "player" || key === "panda") return "#1ea6ff";
  if (key === "banker" || key === "dragon") return "#ff304b";
  return "#f2d84a";
}

function getPayoutChipCount(amount) {
  if (amount >= 2500) return 6;
  if (amount >= 1000) return 5;
  if (amount >= 300) return 4;
  if (amount >= 100) return 3;
  return 2;
}

function chipLabel(amount, chipCount, index) {
  if (index === chipCount - 1) return formatMoney(amount);
  if (amount >= 500) return "$100";
  if (amount >= 100) return "$25";
  return "";
}

function prefersReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function buildSettlementBreakdown(outcome) {
  if (!outcome.settlements.length) {
    return `<div class="settlement-list"><span>没有命中派彩。</span></div>`;
  }

  const rows = outcome.settlements.map((settlement) => {
    const detail = settlement.type === "push"
      ? "Push 退本金"
      : `${settlement.odds}:1 净赢 ${formatMoney(settlement.profit)}`;
    return `
      <span>
        <b>${settlement.label}</b>
        <em>${detail}</em>
        <strong>${formatMoney(settlement.amount)}</strong>
      </span>
    `;
  }).join("");

  return `<div class="settlement-list">${rows}</div>`;
}

function renderTournament() {
  const score = getTournamentScore();
  const room = new URLSearchParams(window.location.search).get("room");
  dom.tournamentStatus.textContent = room ? `Room ${room}` : "Local Table";
  dom.tournamentScore.textContent = formatSignedMoney(score);
  dom.tournamentScore.classList.toggle("positive", score > 0);
  dom.tournamentScore.classList.toggle("negative", score < 0);
  dom.tournamentHands.textContent = String(state.handsPlayed);
  dom.tournamentBonus.textContent = String(state.bonusHits);

  if (document.activeElement !== dom.playerNameInput) {
    dom.playerNameInput.value = state.playerName;
  }

  renderLeaderboardRows();
}

function renderLeaderboardRows() {
  const rows = getLeaderboardRows();
  renderLeaderboard(dom.leaderboard, rows);
  renderLeaderboard(dom.topLeaderboard, rows);
}

function getLeaderboardRows() {
  const rows = [
    {
      rank: 1,
      name: state.playerName,
      score: getTournamentScore(),
      bankroll: state.bankroll,
      reloads: state.reloadCount,
      hands: state.handsPlayed,
      bonus: state.bonusHits,
      self: true,
    },
  ];

  for (let seat = 2; seat <= LEADERBOARD_SIZE; seat += 1) {
    rows.push({
      rank: seat,
      name: `Open Seat ${seat}`,
      score: null,
      bankroll: null,
      reloads: null,
      hands: null,
      bonus: null,
      waiting: true,
    });
  }

  return rows;
}

function renderLeaderboard(host, rows) {
  if (!host) return;
  host.replaceChildren();
  rows.forEach((row) => host.appendChild(buildLeaderboardRow(row)));
}

function buildLeaderboardRow(row) {
  const item = document.createElement("div");
  item.className = `leaderboard-row${row.self ? " self" : ""}${row.waiting ? " waiting" : ""}`;

  const rank = document.createElement("span");
  rank.className = "leaderboard-rank";
  rank.textContent = `#${row.rank}`;

  const avatar = document.createElement("span");
  avatar.className = "leaderboard-avatar";
  avatar.textContent = row.waiting ? "..." : getInitials(row.name);

  const main = document.createElement("span");
  main.className = "leaderboard-main";
  const name = document.createElement("strong");
  name.textContent = row.name;
  const meta = document.createElement("em");
  meta.textContent = row.waiting
    ? "Supabase 连接后自动同步"
    : `${formatMoney(row.bankroll)} · Reload ${row.reloads} · ${row.hands} 手 · Bonus ${row.bonus}`;
  main.append(name, meta);

  const score = document.createElement("b");
  score.className = "leaderboard-score";
  if (row.score === null) {
    score.textContent = "--";
  } else {
    score.textContent = formatSignedMoney(row.score);
    score.classList.toggle("positive", row.score > 0);
    score.classList.toggle("negative", row.score < 0);
  }

  item.append(rank, avatar, main, score);
  return item;
}

function getTournamentScore() {
  return state.bankroll - STARTING_BANKROLL * (state.reloadCount + 1);
}

function getInitials(name) {
  const trimmed = name.trim();
  if (!trimmed) return "P";
  return [...trimmed].slice(0, 2).join("").toUpperCase();
}

function normalizePlayerName(value) {
  const trimmed = value.trim();
  return trimmed || "Player";
}

function getSavedPlayerName() {
  try {
    return normalizePlayerName(localStorage.getItem("baccaratPlayerName") || "Yang");
  } catch {
    return "Yang";
  }
}

function savePlayerName(name) {
  try {
    localStorage.setItem("baccaratPlayerName", name);
  } catch {
    // Local storage can be unavailable in strict browser modes.
  }
}

function formatSignedMoney(amount) {
  if (amount > 0) return `+${formatMoney(amount)}`;
  if (amount < 0) return `-${formatMoney(Math.abs(amount))}`;
  return formatMoney(0);
}

function formatMoney(amount) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

init();
