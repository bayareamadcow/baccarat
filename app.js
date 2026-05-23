const DECKS = 8;
const CARDS_PER_DECK = 52;
const STARTING_BANKROLL = 5000;
const CUT_CARD_REMAINING = 18;
const DEAL_MS = 300;
const THIRD_CARD_PAUSE_MS = 720;
const BET_KEYS = ["player", "panda", "tie", "dragon", "banker"];
const CHIPS = [25, 50, 100, 200, 500];

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
  shoeCount: document.querySelector("#shoe-count"),
  playerCards: document.querySelector("#player-cards"),
  bankerCards: document.querySelector("#banker-cards"),
  playerTotal: document.querySelector("#player-total"),
  bankerTotal: document.querySelector("#banker-total"),
  status: document.querySelector("#status"),
  dealButton: document.querySelector("#deal-btn"),
  clearButton: document.querySelector("#clear-btn"),
  newShoeButton: document.querySelector("#new-shoe-btn"),
  chipRack: document.querySelector("#chip-rack"),
  bigRoad: document.querySelector("#big-road"),
  beadRoad: document.querySelector("#bead-road"),
  statsList: document.querySelector("#stats-list"),
  lastResult: document.querySelector("#last-result"),
  resultCard: document.querySelector("#result-card"),
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
  roundNumber: 0,
  shoeNumber: 0,
  selectedChip: 25,
  shoe: [],
  phase: "betting",
  bets: createEmptyBets(),
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

  dom.clearButton.addEventListener("click", clearBets);
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
  settleRound();
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

  let payout = 0;
  if (winner === "player") {
    payout += pay("player", 1);
  } else if (winner === "banker") {
    if (dragon) {
      payout += push("banker");
    } else {
      payout += pay("banker", 1);
    }
  } else {
    payout += push("player") + push("banker") + pay("tie", 8);
  }

  if (dragon) payout += pay("dragon", 40);
  if (panda) payout += pay("panda", 25);
  state.bankroll += payout;

  const outcome = {
    winner,
    playerTotal,
    bankerTotal,
    dragon,
    panda,
    payout,
    bankerPushOnDragon: dragon && state.bets.banker > 0,
    bets: { ...state.bets },
    playerCards: [...state.player],
    bankerCards: [...state.banker],
  };
  state.history.unshift(outcome);
  state.history = state.history.slice(0, 72);
  state.lastOutcome = outcome;
  state.message = buildOutcomeMessage(outcome);
}

function pay(key, odds) {
  const stake = state.bets[key] || 0;
  return stake > 0 ? stake * (odds + 1) : 0;
}

function push(key) {
  return state.bets[key] || 0;
}

function buildOutcomeMessage(outcome) {
  const winnerLabel = outcome.winner === "tie" ? "和" : LABELS[outcome.winner];
  const bonuses = [
    outcome.dragon ? "Dragon 7 命中 40:1，庄主注 Push 不赔" : "",
    outcome.panda ? "Panda 8 命中 25:1" : "",
  ].filter(Boolean).join("，");
  return `${winnerLabel}赢，闲 ${outcome.playerTotal} / 庄 ${outcome.bankerTotal}${bonuses ? `，${bonuses}` : ""}。`;
}

function handTotal(cards) {
  return cards.reduce((sum, card) => sum + card.value, 0) % 10;
}

function getTotalBet() {
  return BET_KEYS.reduce((sum, key) => sum + state.bets[key], 0);
}

function render() {
  dom.bankroll.textContent = formatMoney(state.bankroll);
  dom.roundNumber.textContent = String(state.roundNumber);
  dom.shoeNumber.textContent = String(state.shoeNumber);
  dom.shoeCount.textContent = `${state.shoe.length} cards`;
  dom.playerTotal.textContent = state.player.length ? handTotal(state.player) : "--";
  dom.bankerTotal.textContent = state.banker.length ? handTotal(state.banker) : "--";
  dom.status.textContent = state.message;
  dom.dealButton.disabled = state.phase !== "betting";
  dom.clearButton.disabled = state.phase !== "betting";
  dom.newShoeButton.disabled = state.phase !== "betting";
  renderCards(dom.playerCards, state.player);
  renderCards(dom.bankerCards, state.banker);
  renderBets();
  renderRoads();
  renderLastResult();
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
  dom.bigRoad.replaceChildren();
  const cells = 18 * 6;
  for (let index = 0; index < cells; index += 1) {
    const cell = document.createElement("div");
    cell.className = "road-cell";
    const outcome = state.history[cells - 1 - index];
    if (outcome) cell.appendChild(buildMark(outcome));
    dom.bigRoad.appendChild(cell);
  }

  dom.beadRoad.replaceChildren();
  for (let index = 0; index < 40; index += 1) {
    const cell = document.createElement("div");
    cell.className = "mini-cell";
    const outcome = state.history[39 - index];
    if (outcome) cell.appendChild(buildMark(outcome, true));
    dom.beadRoad.appendChild(cell);
  }

  const stats = {
    庄: state.history.filter((item) => item.winner === "banker").length,
    闲: state.history.filter((item) => item.winner === "player").length,
    和: state.history.filter((item) => item.winner === "tie").length,
    Dragon: state.history.filter((item) => item.dragon).length,
    Panda: state.history.filter((item) => item.panda).length,
  };
  dom.statsList.replaceChildren();
  Object.entries(stats).forEach(([label, value]) => {
    const row = document.createElement("div");
    row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
    dom.statsList.appendChild(row);
  });
}

function buildMark(outcome, small = false) {
  const mark = document.createElement("span");
  mark.className = `mark ${outcome.winner}${outcome.dragon ? " dragon" : ""}${outcome.panda ? " panda" : ""}`;
  mark.textContent = small ? "" : outcome.winner === "banker" ? outcome.bankerTotal : outcome.winner === "player" ? outcome.playerTotal : "和";
  mark.title = buildOutcomeMessage(outcome);
  return mark;
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
    本局返还：${formatMoney(outcome.payout)}
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
