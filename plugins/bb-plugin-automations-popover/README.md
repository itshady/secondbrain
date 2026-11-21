# bb-plugin-automations-popover

Universal BB sidebar-footer popover to inspect and manage scheduled agent and script automations across all projects.

## Features
- **Cross-Project Aggregation**: Lists automations across all registered standard and personal projects.
- **Direct Controls**: Pause or resume any automation with an on/off toggle.
- **On-Demand Execution**: Trigger one-off runs instantly via the Run Now button.
- **Inline Schedule Editor**:
  - Hourly, Daily, Weekly (day-of-week selector), Monthly (day 1-28), One-time (datetime picker), and Custom Cron.
  - Interactive time picker and IANA timezone configuration.
- **Theme-Aware & Responsive**: Styled using BB standard theme tokens and Radix/Tailwind components.

## Build & Install
```bash
bb plugin build .
bb plugin install .
```
