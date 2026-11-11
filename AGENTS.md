# Repository instructions

These instructions apply to the entire Aula Photo Downloader repository.

## Function documentation

- Use JSDoc-style `/** ... */` comments immediately above non-trivial functions,
  including functions assigned to `const` arrow expressions.
- Explain the function's purpose and non-obvious contract: side effects, security
  boundaries, failure behavior, resource ownership, timezone assumptions, or
  resume/checkpoint rules when relevant.
- Add `@param`, `@returns`, and `@throws` only when they explain behavior that the
  signature does not convey. Do not duplicate TypeScript types in comments.
- Keep comments accurate when changing behavior. Do not add comments that merely
  restate a function name or annotate every obvious accessor or UI assignment.
- Inline `//` comments are appropriate for explaining a specific implementation
  choice inside a function; they do not replace its JSDoc contract.

## Code style

- Use named `const` arrow functions, including `async` arrow functions, rather
  than function declarations.
- Prefer expression bodies for short, clear returns and curly-braced block bodies
  for longer logic or multiple statements. Preserve normal functions when an external
  interface requires dynamic `this`.
- ESLint owns code style and formatting; do not add a separate formatter.
  Keep blank lines between statements and braces around control-flow bodies.
- Run `npm run lint:fix` after edits and `npm run lint` before delivery, with zero
  errors and warnings. Use the shared Antfu preset; keep overrides limited to explicit project
  preferences and the extension/Node test environment.
- For executable changes, also run `npm run typecheck`, `npm test`, and
  `npm run build`. Use `npm run test:wasm` when changing metadata processing.

## Version compatibility

- Do not add or preserve compatibility between plugin versions: no persisted-state
  migrations, legacy storage layouts, gallery-key aliases, or old-format adapters.
- Read only the current storage schema and layout. Reset incompatible extension
  state instead of converting it; never delete or alter existing downloaded files.
- Continue validating current data and recovering jobs within the current version.
  Aula API version probing is a separate feature and remains supported.

## Generated and user files

- Edit maintained sources, not generated files in `dist/`.
- Preserve user-extracted folders and existing download files.
- Do not generate release ZIPs unless requested. A build in `dist/` is sufficient
  for loading the extension locally.

## Private data and fixtures

- Never save or commit live Aula photos, screenshots, recordings, HAR files,
  response dumps, cookies, signed URLs, real names, account/profile/album IDs,
  institutions, contact details, locations or other identifying data. Keep browser
  debugging evidence outside this repository and Git staging area.
- Preserve API structure only. Replace every identifying value before writing a
  fixture: use explicitly Synthetic/Example/Test names, reserved numeric IDs
  1–1999 (12345 for album-route examples), fixed invented dates, reserved test email
  domains and `/synthetic/` media paths with dummy signatures. Never copy real
  identifiers into deny lists, comments, assertions or sanitization examples.
- Test media must be generated locally or be an independently reviewed public
  regression fixture, with no personal pixels, audio or metadata. Delete any
  Aula-sourced development/test media; preserve the user's actual download folders.
- New or changed data fixtures, media and snapshots require a provenance/privacy
  review before updating the approved digests in `scripts/check-privacy.mjs`.
  Inspect decoded content and metadata; never automatically approve captured data.
- Run `npm run prepare` after `npm ci --ignore-scripts` to install the Husky hook.
  Pre-commit checks inspect the exact staged content and run Gitleaks; do not bypass
  them. CI also runs `npm run privacy:check`. These checks supplement manual review;
  they cannot determine whether every arbitrary name or number belongs to a person.

## Central configuration

- Put shared runtime settings (Aula origins and API defaults, timeouts, limits,
  archive paths and timezone, storage keys, and browser asset paths) in root
  `config.json`. Import them through `src/config.ts`; do not duplicate them
  in consumers or generated manifests. Configuration is bundled at build time.
- Keep API field names, metadata tag names, wire-format parsing rules, and UI
  copy near their implementation; they describe contracts rather than settings.
- Changing an origin must update generated permissions and runtime validation
  together. `scripts/build.mjs` generates manifest host permissions and CSP
  from the central configuration.
