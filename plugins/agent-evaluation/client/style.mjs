export const CSS = `
.aev { color: var(--text); background: var(--bg); padding: 24px; font: inherit; line-height: 1.6; min-height: 100%; }
.aev * { box-sizing: border-box; }
.aev header, .aev .actions { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.aev header { justify-content: space-between; margin-bottom: 20px; }
.aev h1 { font-size: 22px; margin: 0; }
.aev h2 { font-size: 17px; margin: 0 0 12px; }
.aev h3 { font-size: 15px; margin: 0 0 8px; }
.aev p { margin: 8px 0; overflow-wrap: anywhere; }
.aev button, .aev input, .aev select, .aev textarea { font: inherit; color: inherit; background: var(--bg-elev2, var(--bg)); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; min-height: 36px; max-width: 100%; }
.aev button { cursor: pointer; }
.aev button:hover { background: var(--bg-elev); }
.aev button:active { border-color: var(--accent); }
.aev button:disabled { opacity: .55; cursor: default; }
.aev :focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.aev .primary { background: var(--accent); color: var(--accent-contrast, white); }
.aev .primary:hover { background: var(--accent); filter: brightness(.95); }
.aev label { display: grid; gap: 6px; margin: 12px 0; }
.aev [data-configuration] .grid > label, .aev [data-project-panel] .grid > label { min-width: 0; max-width: 100%; }
.aev [data-configuration] input, .aev [data-configuration] select { width: 100%; min-width: 0; }
.aev [data-project-panel] select, .aev [data-project-panel] button { min-height: 44px; min-width: 0; }
.aev [data-experiments] form, .aev [data-experiments] label { min-width: 0; max-width: 100%; }
.aev [data-experiments] select, .aev [data-experiments] input:not([type=checkbox]) { width: 100%; min-width: 0; }
.aev [data-experiments] button, .aev [data-experiments] select, .aev [data-experiments] input:not([type=checkbox]) { min-height: 44px; }
.aev fieldset { border: 1px solid var(--border); border-radius: 6px; min-width: 0; margin: 12px 0; }
.aev .check-label { display: flex; align-items: center; gap: 10px; min-height: 36px; }
.aev .check-label span { min-width: 0; overflow-wrap: anywhere; }
.aev input[type=checkbox] { min-height: 20px; width: 20px; flex: none; }
.aev textarea[readonly] { color: var(--text-dim, var(--text)); }
.aev textarea { width: 100%; min-height: 88px; resize: vertical; }
.aev .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 230px), 1fr)); gap: 16px; }
.aev section, .aev article, .aev .panel { border: 1px solid var(--border); border-radius: 10px; padding: 16px; margin-bottom: 16px; background: var(--bg-elev, var(--bg)); min-width: 0; }
.aev .muted { color: var(--text-dim, var(--text)); }
.aev .badge { display: inline-block; border: 1px solid var(--border); border-radius: 4px; padding: 1px 7px; font-size: 12px; margin-right: 8px; }
.aev .table-wrap { overflow-x: auto; }
.aev table { width: 100%; border-collapse: collapse; text-align: left; }
.aev th, .aev td { padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; min-width: 110px; overflow-wrap: anywhere; }
.aev td:first-child { min-width: 230px; max-width: 360px; }
.aev pre { white-space: pre-wrap; overflow-wrap: anywhere; font: 12px/1.6 ui-monospace, monospace; max-height: 400px; overflow: auto; }
.aev details { margin: 10px 0; }
.aev summary { cursor: pointer; padding: 4px 0; }
.aev .empty { padding: 36px 16px; text-align: center; }
.aev [role=alert]:not(:empty) { border-left: 3px solid var(--red, var(--accent)); padding: 12px; margin-bottom: 16px; }
.aev .status { min-height: 26px; margin-bottom: 12px; }
.aev .review { border-left: 3px solid var(--accent); padding-left: 12px; margin-top: 12px; }
@media (max-width: 700px) { .aev { padding: 12px; } .aev header { align-items: flex-start; } }
`;
