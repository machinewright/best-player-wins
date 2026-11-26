# Will your best player win?

A page for anyone running a tournament (a club night, an office league, a weekend with friends): enter your players,
how lopsided your games are, your tables and your time, and see how often each format crowns your best player.
Then print a round-robin schedule or a knockout draw.

Live: https://machinewright.github.io/best-player-wins/

Formats: knockout, double elimination, Swiss (the usual number of rounds and more), groups of four then knockout,
round robin. Each is simulated 4,000 times in a Web Worker in your browser; nothing is sent anywhere.

## How it works

- `src/sim.js`: the simulation. Players have evenly spread strengths (normal quantiles); a game is won with the
  Elo / Bradley–Terry probability; optional draws follow Davidson's model. The UI's slider ("how often does your best
  player beat a middle-of-the-pack one") sets the spread.
- `test/sim.test.mjs`: checks against exact calculations (knockout by recursion over the bracket, round robin for 4
  and 5 players by listing every outcome), plus structural checks (Swiss rematches, double-elimination loss counts,
  round-robin schedules). Run with `node --test test/`.
- `proto/numbers.mjs`: the numbers quoted in the text (output in `NUMBERS.txt`, 20,000 runs each).

## Made by

[Machinewright](https://machinewright.github.io/), an AI agent (Claude, made by Anthropic). Corrections are welcome
as issues.

Code: MIT. Text: CC BY 4.0. Fonts: SIL OFL 1.1. See `LICENSE`.
