# Ground Zero

Ground Zero (`ground-zero`) is a zero-config static site generator that wraps Vite, EJS templates, and modern CSS. Install it, run one command, and you get hot module reloading, BrowserSync mirroring, and production builds without writing any config files.

## Why ground-zero?

- **Zero setup:** Vite config, BrowserSync, and file watching are bundled, so you only write templates and CSS.
- **Pure EJS + CSS:** No React, no SCSS pipeline—just standard EJS partials and native CSS features (nesting, layers, imports).
- **Instant feedback:** Vite's HMR keeps the browser in sync while BrowserSync mirrors clicks, scroll, and form inputs across devices.
- **Predictable builds:** Every build runs `EJS → Vite build → CSS minify`, so what you preview is what you ship.

## Core concepts

| Concept | What it means |
| --- | --- |
| **EJS pages** | Files under `src/pages/*.ejs` become HTML in `dev-html/` (dev) or `build/` (prod). Include partials from `src/partials/*.ejs`. |
| **Module entry** | `src/assets/js/main.js` is injected via `/@fs/` so you can import modules without fiddling with paths. |
| **One-click commands** | `gzero` runs the dev loop (compile + Vite serve). `gzero-build` compiles, then minifies CSS with esbuild. |
| **Modern CSS** | Write plain `.css` files that use nesting, layers, imports, and variables—Vite handles the rest. |

## Quick start

```bash
mkdir my-site && cd my-site
npm init -y
npm install ground-zero

# minimal structure
mkdir -p src/pages src/partials src/assets/css src/assets/js
touch src/pages/index.ejs src/assets/css/main.css src/assets/js/main.js
```

Example `src/pages/index.ejs`:

```html
<!DOCTYPE html>
<html lang="en">
  <%- include('partials/head') %>
  <body>
    <%- include('partials/header') %>
    <main>
      <h1>Hello from Ground Zero</h1>
    </main>
    <%- include('partials/footer') %>
  </body>
</html>
```

### Develop with HMR

```bash
npx gzero
```

This command:
1. Compiles all EJS pages into `dev-html/`.
2. Starts Vite with HMR so you see changes immediately.
3. Keeps BrowserSync in sync across open devices.

### Build for production

```bash
npx gzero-build
```

This command:
1. Recompiles EJS → HTML.
2. Runs `vite build` with the packaged config (multi-page aware).
3. Minifies every CSS file in `build/` using esbuild.

Deploy the `build/` folder to any static host.

## License

MIT © Ground Zero contributors.

