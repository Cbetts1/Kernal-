# Contributing to AIOS Kernel

Thank you for your interest in contributing! This document explains how to get started.

---

## Getting Started

1. **Fork & Clone** the repository
2. **Install dev dependencies** (optional — only needed for linting/testing):
   ```bash
   npm install
   ```
3. **Run tests**:
   ```bash
   npm test
   ```
4. **Lint** the source:
   ```bash
   npm run lint
   ```

---

## Project Philosophy

- **Zero runtime dependencies** — `kernel.js` must remain usable with a bare `<script>` tag or `require('./kernel')` with no `npm install`
- **Universal** — code must run in Node.js, modern browsers, and Android WebView without transpilation
- **Minimal** — prefer smaller, focused changes over large rewrites

---

## Development Guidelines

### Code Style
- Follow the ESLint rules in `.eslintrc.json`
- Use `'single quotes'` for strings
- Always use `const` / `let` (never `var`)
- Add JSDoc comments for every new public method or class

### Tests
- Every new feature or bug fix must be accompanied by a test
- Tests live in `test/kernel.test.js`
- Run `npm test -- --coverage` to check coverage; aim for ≥85% overall

### Commits
- Use imperative mood: `"Add broadcast() to InterOS"`, not `"Added broadcast"`
- Keep commits focused — one logical change per commit

---

## Pull Request Process

1. Create a feature branch: `git checkout -b feat/my-feature`
2. Make your changes and add tests
3. Run `npm run lint && npm test` — both must pass
4. Open a PR against `main` with a clear description of the change

---

## Reporting Bugs

Please open a GitHub Issue with:
- A minimal reproduction script
- Expected vs actual behaviour
- Node.js / browser version

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
