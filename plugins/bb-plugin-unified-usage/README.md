# bb-plugin-unified-usage

Unified provider and Antigravity/Gemini CLI quota popover for BB's bottom-left sidebar footer.

## Features
- Combines native BB provider usage (`sdk.system.usageLimits`) and Antigravity CLI quota (`agy -p "/usage"`) into one compact disclosure popover.
- In-memory 2-minute TTL cache with background warm-up for instant (<20ms) opens, plus an on-demand **Refresh** button.
- Normalizes remaining quota percentages with clear color thresholds (>30% green, 10–30% amber, <10% red) and human-readable reset timestamps.

## Build & Install
```bash
bb plugin build .
bb plugin install .
```
