# Seafood Site (Split Version)

This is a **no-loss split** of the original single-file `gpt.html` into:
- `public/index.html`
- `public/assets/css/styles.css`  (moved from <style> blocks)
- `public/assets/js/app.js`       (moved from <script type="module">)

## How to run (simple)
- Open `public/index.html` in a browser.
  - Note: because Firebase module imports are used, some browsers require a local server.
- Recommended:
  - `python -m http.server 5173` from the `public` folder, then open:
    - http://localhost:5173

## Notes
- The HTML was left intact, except:
  - `<style>` blocks were removed and replaced with a `<link rel="stylesheet" ...>`
  - The first `<script type="module">...</script>` block was removed and replaced with:
    `<script type="module" src="./assets/js/app.js"></script>`
- All code (CSS/JS/HTML) is preserved verbatim in the new files.
