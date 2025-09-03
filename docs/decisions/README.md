# Architectural Decision Records (ADR)

This directory contains Architectural Decision Records using MADR (Markdown Architectural Decision Records).

- Format: MADR. See the docs at [adr.github.io/madr](https://adr.github.io/madr/) and the repository at [github.com/adr/madr](https://github.com/adr/madr).
- Template: `adr-template.md`
- Initial ADR: `0000-use-markdown-architectural-decision-records.md`

## How to create a new ADR

1. Choose the next zero-padded number (e.g., `0001`).
2. Copy the template:

```
cp adr-template.md 0001-short-title.md
```

3. Fill in the sections and set the status (`proposed`, `accepted`, `rejected`, `deprecated`, or `superseded`).
4. Commit the ADR with a meaningful message (e.g., "ADR-0001: Accept X").

## Naming

- File name: `NNNN-short-title.md` where `NNNN` is the zero-padded sequence number.
- Title: Use a short imperative phrase.

## Status values

- `proposed`: Under discussion
- `accepted`: Agreed and to be implemented (or already implemented)
- `rejected`: Considered but not adopted
- `deprecated`: No longer recommended for new work
- `superseded`: Replaced by another ADR (link the successor)
