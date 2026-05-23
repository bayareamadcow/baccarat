# Parkwest Style Baccarat Trainer

A static EZ Baccarat practice table with Player, Banker, Tie, Dragon 7, and Panda 8 bets.

Rules implemented:

- 8-deck baccarat shoe.
- Tie pays 8:1.
- Dragon 7 pays 40:1 when Banker wins with a three-card 7. Banker main bet pushes on Dragon 7 and does not pay 1:1.
- Panda 8 pays 25:1 when Player wins with a three-card 8.
- Third-card draw sequence is animated and dealt Player first, then Banker when required.
- Winning and pushed bets animate chips from the winning bet boxes back to the bankroll, with per-bet payout breakdowns.
- Reload Chips resets the practice bankroll to $5,000, clears unplayed bets, and tracks the reload count.
- Tournament Mode tracks a local leaderboard score, hands played, bonus hits, and reload penalties.
- Scoreboard includes Bead Plate, Big Road, Big Eye Boy, Small Road, Cockroach Pig, and a Banker/Player forecast preview for derived-road marks.
- Big Road marks two-card Natural 8/9 wins as a solid Banker/Player circle with `8` or `9`; Natural Tie keeps the tie slash and adds a small solid `8/9` badge.
- Big Road marks Dragon 7 with a red dragon badge and Panda 8 with a blue panda badge.

Rule references:

- Parkwest Casino Lotus EZ Baccarat page mentions Panda 8 and Dragon 7: https://parkwestcasinolotus.com/game/ez-baccarat/
- Ocean Casino EZ Baccarat rules describe Dragon 7 paying 40:1 and Panda 8 paying 25:1: https://www.theoceanac.com/casino/table-games/how-to-play-ez-baccarat
- Baccarat road layout and derived-road behavior reference: https://www.baccarat.net/guide/roads/
- Derived road predictor concept reference: https://www.baccarat.wiki/how-to-play/roads

This project was built as an original static trainer instead of copying a third-party codebase.
