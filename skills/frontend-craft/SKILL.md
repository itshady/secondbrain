---
name: frontend-craft
description: "Universal frontend engineering and visual verification standards: modern React/Tailwind/shadcn stack defaults, anti-AI-slop design discipline, and mandatory bb browser-automation screenshot self-critique."
tier: heavy
---

# Frontend Craft & Visual Verification Standards (`skills/frontend-craft/SKILL.md`)

This skill defines the engineering and aesthetic baseline for all user interfaces across the Second Brain OS ecosystem. Every frontend deliverable must feel intentional, domain-authentic, and rigorously verified.

---

## 1. Design-First Commitment & Anti-AI-Slop Discipline
Before writing application code or markup, establish a coherent aesthetic foundation:
* **Domain-Authentic Aesthetic:** Ground the interface in the problem domain rather than generic templates. Select distinctive typography pairings (e.g., editorial serif headlines with clean geometric sans body for knowledge engines; crisp monospace with high-density tabular numerals for developer tooling).
* **Restrained Semantic Token Palette:** Restrict the color palette to 1 primary accent hue paired with intentional neutral scales (zinc, slate, or stone). Declare all colors as semantic CSS variables/tokens (`--primary`, `--muted`, `--border`, `--background`); never scatter raw hex literals across component files.
* **Strict Anti-AI-Slop Invariants:**
  * **No Neon/Purple Slates:** Forbid generic cyberpunk glowing violet/purple-on-dark gradients and neon borders.
  * **No Emoji Clutter:** Forbid decorative emoji in headings, tabs, navigation items, buttons, or badges. Use clean SVG icons (e.g., Lucide or Radix) sparingly.
  * **No Card-Inside-Card Clutter:** Eliminate nested card containers and redundant borders. Use negative space, subtle hairline dividers, and typographic scale to delineate content sections.
  * **No Wall of Badges:** Do not plaster interfaces with arbitrary pill tags, colored chips, or decorative progress indicators that lack actionable meaning.
  * **No Above-the-Fold Metric Dumping:** Resist cramming every metric, statistic, and chart into the initial viewport. Prioritize focused focal points and purposeful visual hierarchy.

---

## 2. Modern Stack Default
For any non-trivial web application, dashboard, or interactive view:
* **Baseline Architecture:** Default to **Vite + React + TypeScript + Tailwind CSS + shadcn/ui** (or **Next.js** App Router when server-side rendering, streaming, or full-stack API capabilities are required).
* **Maintainable Component Structure:** Decompose views into focused, single-responsibility components under `components/` and custom hooks under `hooks/`.
* **Zero Vanilla Sprawl:** Never accumulate multi-thousand-line monolithic vanilla HTML, CSS, or JavaScript files. Even lightweight tools must use modular components and typed props.

---

## 3. Mandatory Visual Verification & Self-Critique Loop
Never declare frontend work complete based on unit tests or DOM string assertions alone. UI is an inherently visual discipline and must be verified visually before concluding any task (consult the `browser-automation` skill for full API details).

1. **Boot Development Server:**
   Start the local dev server (e.g., `npm run dev` or `vite`) in the background or subshell and confirm clean compilation without warnings.
2. **Open Headless Browser Session:**
   ```bash
   bb browser-automation open --backend local --headless --machine <host-id> --json
   ```
   Inspect console outputs to verify zero runtime exceptions, unhandled Promise rejections, or missing network assets.
3. **Navigate & Capture Responsive Viewports:**
   * **Desktop Viewport (1440px):** Navigate and set desktop viewport:
     ```bash
     bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.setViewportSize({ width: 1440, height: 900 }); await p.goto("http://localhost:<port>"); await p.shot({ type: "jpeg", maxEdge: 960, quality: 70 }); undefined' --json
     ```
   * **Mobile Viewport (390px):** Resize and capture mobile layout:
     ```bash
     bb browser-automation run <session-id> --script 'const p = await browser.getPage("main"); await p.setViewportSize({ width: 390, height: 844 }); await p.shot({ type: "jpeg", maxEdge: 960, quality: 70 }); undefined' --json
     ```
   * Alternatively, capture snapshots via `bb browser-automation screenshot <session-id> --page main --json` and inspect the returned `images[].path` with `read_file`.
4. **Autonomous Self-Critique as Design Lead:**
   * Inspect the captured image files using your multimodal image-reading tool.
   * Evaluate visual rhythm: check for inconsistent padding, visual hierarchy flattening, low contrast text, misaligned grid baselines, and horizontal scroll leakage on mobile.
5. **Iterate & Clean Session Teardown:**
   * Fix any visual flaws identified during self-critique.
   * Re-capture screenshots to confirm resolution.
   * Cleanly close the browser session:
     ```bash
     bb browser-automation close <session-id>
     ```
