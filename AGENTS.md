# MarkdownShelf / 文架

This is an independent Marky-derived application, not part of CodeTrail.
User-authorized scope overrides upstream's viewer-only rule in CLAUDE.md:
Markdown editing and creation are intentional; keep all other stack conventions.
Use Rust/Tauri, React/TypeScript, pnpm, and Marky's sanitized Markdown pipeline.
Keep LICENSE and NOTICE. Do not publish or install system-wide unless requested.

Keep the visible product two columns: document list and reading/editing body.
No AI integration, cloud, graph, tagging or third pane in v1.
User-selected project folders remain the source of truth; never move documents.
New files must never overwrite existing files. Saves require the loaded hash.
Preserve dirty drafts on external changes, navigation and restart; conflicts
must remain visible. Never silently replace edits with watcher results.
All document read/write commands must enforce registered project boundaries.

Tests: pnpm test; pnpm build; cargo test --manifest-path src-tauri/Cargo.toml;
production Tauri build and actual native reading/editing/create/external-change
verification on isolated fixtures. Do not edit users' real documents to test.
Update README and verification notes to match actual observed results.

Required reading is an explicit human choice scoped by registered project root
and canonical document path. Store the confirmed content hash separately in
application data, never in the source Markdown or project repository. Reading,
watcher refresh and saving edits must not auto-confirm. Changed content remains
required but needs review; stale confirmations must fail. Keep marks and drafts
when removing a project, and never publish local project settings or reading data.
