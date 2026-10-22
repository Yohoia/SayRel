# Agent Configuration

This document configures how AI agents work with the Sayrel codebase.

## Agent skills

### Issue tracker

Issues are tracked in GitHub Issues for this repository (resolve its current location with `git remote -v`). Skills use the `gh` CLI to create, read, and update issues. See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context layout: one `GLOSSARY.md` at the repo root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
