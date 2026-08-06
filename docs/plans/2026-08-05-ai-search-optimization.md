# AI Search Optimization

## Goal

Improve the existing search engine enough for configured difficulty levels to complete deeper searches without changing chess rules or adding dependencies.

## Constraints

- Preserve legal move generation and deterministic normal/hard opening choices.
- Keep easy mode intentionally nondeterministic.
- Keep the existing time budgets and synchronous public behavior.
- Avoid architectural rewrites such as Web Workers in this pass.

## Changes

1. Add a Node-based regression harness around the existing browser script.
2. Cache square occupancy per board without changing the board representation.
3. Remove redundant legality checks during move ordering.
4. Reuse leaf legal moves in quiescence search.
5. Search every legal evasion when quiescence starts in check.

## Verification

- Initial position exposes 44 legal moves for each side.
- Every AI difficulty returns a legal move.
- Normal and hard modes preserve the expected opening move.
- A checked quiescence position cannot use stand-pat instead of evading check.
- Benchmarks report completed iterative-deepening root passes and stay within a bounded time overhead.
