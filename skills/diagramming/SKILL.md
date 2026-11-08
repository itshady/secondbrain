---
name: diagramming
description: "Single source of truth for visual architecture diagramming using the render-diagram adapter (D2 sketch mode)."
tier: light
---

# Visual Architecture Diagramming (`skills/diagramming/SKILL.md`)

Whenever creating or updating an architecture diagram, use this skill and the `render-diagram` adapter so diagramming remains 100% consistent and swappable in one place.

## 1. File & Storage Convention
* Store declarative source files in `docs/diagrams/<name>.d2`.
* Compile to `docs/diagrams/<name>.svg` using:
  ```bash
  render-diagram docs/diagrams/<name>.d2 docs/diagrams/<name>.svg
  ```
* In `README.md` and Markdown documentation, always link to the `.svg` asset (`![Architecture](docs/diagrams/<name>.svg)`). Never invoke raw compiler flags directly in project scripts.

## 2. Active Syntax Rules (D2 Sketch Mode)
1. **Header Config:**
   ```d2
   vars: {
     d2-config: {
       sketch: true
     }
   }
   ```
2. **Valid Shapes Only:** Use `rectangle`, `page`, `person`, `hexagon`, `diamond`, `oval`, `package`, `document`, `cylinder`. (Do not use `folder`).
3. **No Container-to-Descendant Edges:** In `dagre` layout, never draw an arrow from a parent container directly to a child node inside that same container; connect sibling nodes instead.
