/** 数据空间视图样式（自包含，只吃宿主主题变量；深浅主题自动跟随）。 */
export const CSS = `
.dsp { --dsp-gap: 12px; position: relative; min-height: 100%; color: var(--text, #e6e6e6); font-size: 13px; line-height: 1.55; padding-bottom: 40px; }
.dsp *, .dsp *::before, .dsp *::after { box-sizing: border-box; }
.dsp svg { width: 16px; height: 16px; }
.dsp-head { position: sticky; top: 0; z-index: 6; padding: 16px 20px 0; background: var(--bg, #17181c); border-bottom: 1px solid var(--border, #2c2f36); }
.dsp-head-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
.dsp-brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
.dsp-brand-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 9px; background: color-mix(in srgb, var(--accent, #4f8cff) 16%, transparent); color: var(--accent, #4f8cff); flex: none; }
.dsp-brand-icon svg { width: 18px; height: 18px; }
.dsp-brand-name { font-size: 14.5px; font-weight: 600; letter-spacing: .2px; }
.dsp-brand-sub { font-size: 11.5px; color: var(--text-faint, #8a8f98); }
.dsp-tools { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsp-search { width: 220px; }
.dsp input, .dsp select, .dsp textarea { font: inherit; color: inherit; background: var(--bg-elev2, #22242a); border: 1px solid var(--border, #2c2f36); border-radius: 8px; padding: 6px 9px; outline: none; min-width: 0; }
.dsp input:focus, .dsp select:focus, .dsp textarea:focus { border-color: var(--accent, #4f8cff); }
.dsp textarea { resize: vertical; }
.dsp-nav { display: flex; align-items: flex-end; gap: 2px; margin-top: 14px; overflow-x: auto; }
.dsp-nav button { appearance: none; border: 0; background: transparent; color: var(--text-dim, #a4a9b3); font: inherit; padding: 9px 14px; border-radius: 9px 9px 0 0; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; border-bottom: 2px solid transparent; white-space: nowrap; }
.dsp-nav button:hover { color: var(--text, #e6e6e6); background: var(--bg-elev2, #22242a); }
.dsp-nav button.on { color: var(--text, #e6e6e6); border-bottom-color: var(--accent, #4f8cff); font-weight: 600; }
.dsp-num { font-size: 11px; padding: 0 6px; border-radius: 99px; background: var(--bg-elev2, #22242a); border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); }
.dsp-body { padding: 18px 20px 0; }
.dsp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 16px; }
.dsp-stat { border: 1px solid var(--border, #2c2f36); border-radius: 11px; padding: 12px 14px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); min-width: 0; }
.dsp-stat-label { font-size: 11.5px; color: var(--text-faint, #8a8f98); }
.dsp-stat-value { font-size: 22px; font-weight: 600; line-height: 1.5; }
.dsp-stat-hint { font-size: 11px; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 14px; }
@media (max-width: 860px) { .dsp-cols { grid-template-columns: minmax(0, 1fr); } }
.dsp-card { border: 1px solid var(--border, #2c2f36); border-radius: 11px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); padding: 12px 14px; min-width: 0; }
.dsp-card-head { font-size: 12px; color: var(--text-faint, #8a8f98); margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsp-bar-row { display: grid; grid-template-columns: 96px minmax(0, 1fr) 34px; align-items: center; gap: 8px; padding: 3px 0; font-size: 12px; }
.dsp-bar-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-dim, #a4a9b3); }
.dsp-bar { height: 6px; border-radius: 99px; background: var(--bg-elev2, #22242a); overflow: hidden; }
.dsp-bar i { display: block; height: 100%; border-radius: 99px; background: var(--accent, #4f8cff); }
.dsp-bar-num { text-align: right; color: var(--text-faint, #8a8f98); font-variant-numeric: tabular-nums; }
.dsp-recent { display: flex; flex-direction: column; gap: 2px; }
.dsp-recent-row { display: flex; align-items: center; gap: 8px; padding: 6px; border-radius: 8px; cursor: pointer; min-width: 0; }
.dsp-recent-row:hover { background: var(--bg-elev2, #22242a); }
.dsp-recent-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-recent-time { font-size: 11px; color: var(--text-faint, #8a8f98); flex: none; }
.dsp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
.dsp-chip { appearance: none; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--border, #2c2f36); background: transparent; color: var(--text-dim, #a4a9b3); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.dsp-chip:hover { color: var(--text, #e6e6e6); background: var(--bg-elev2, #22242a); }
.dsp-chip.on { color: var(--accent-contrast, #fff); background: var(--accent, #4f8cff); border-color: transparent; }
.dsp-table-wrap { border: 1px solid var(--border, #2c2f36); border-radius: 11px; overflow: hidden; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); }
.dsp-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
.dsp-table th { text-align: left; font-weight: 500; font-size: 11.5px; color: var(--text-faint, #8a8f98); padding: 9px 12px; border-bottom: 1px solid var(--border, #2c2f36); background: var(--bg-elev2, #22242a); }
.dsp-table td { padding: 9px 12px; border-bottom: 1px solid var(--border-soft, var(--border, #2c2f36)); vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-table tr:last-child td { border-bottom: 0; }
.dsp-table tbody tr:hover { background: var(--bg-elev2, #22242a); }
.dsp-name-cell { display: flex; align-items: center; gap: 7px; min-width: 0; cursor: pointer; }
.dsp-name-cell b { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-tags { display: flex; gap: 4px; overflow: hidden; }
.dsp-tag { font-size: 10.5px; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); white-space: nowrap; }
.dsp-dot { width: 8px; height: 8px; border-radius: 99px; flex: none; background: var(--accent, #4f8cff); }
.dsp-dot.blue { background: var(--blue, #4f8cff); }
.dsp-dot.green { background: var(--green, #3ecf8e); }
.dsp-dot.amber { background: var(--amber, #e0a63c); }
.dsp-dot.purple { background: var(--plugin-purple, #a78bfa); }
.dsp-dot.gray { background: var(--text-faint, #8a8f98); }
.dsp-row-actions { display: flex; gap: 4px; justify-content: flex-end; }
.dsp-btn { appearance: none; font: inherit; font-size: 12px; padding: 5px 11px; border-radius: 8px; border: 1px solid var(--border, #2c2f36); background: var(--bg-elev2, #22242a); color: var(--text, #e6e6e6); cursor: pointer; display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
.dsp-btn:hover:not(:disabled) { border-color: var(--accent, #4f8cff); }
.dsp-btn:disabled { opacity: .55; cursor: default; }
.dsp-btn.icon { padding: 4px 7px; background: transparent; border-color: transparent; color: var(--text-dim, #a4a9b3); }
.dsp-btn.icon:hover { background: var(--bg-elev2, #22242a); color: var(--text, #e6e6e6); border-color: transparent; }
.dsp-btn.primary { background: var(--accent, #4f8cff); border-color: transparent; color: var(--accent-contrast, #fff); font-weight: 600; }
.dsp-btn.danger:hover { border-color: var(--red, #e5484d); color: var(--red, #e5484d); }
.dsp-empty { border: 1px dashed var(--border, #2c2f36); border-radius: 11px; padding: 36px 20px; text-align: center; color: var(--text-faint, #8a8f98); }
.dsp-empty b { display: block; color: var(--text, #e6e6e6); font-size: 14px; margin-bottom: 4px; }
.dsp-empty .dsp-btn { margin-top: 12px; }
.dsp-empty-inline { color: var(--text-faint, #8a8f98); font-size: 12px; padding: 8px 0; }
.dsp-muted { color: var(--text-faint, #8a8f98); font-size: 12px; }
.dsp-foot { margin-top: 12px; font-size: 11.5px; color: var(--text-faint, #8a8f98); overflow-wrap: anywhere; }
.dsp-group { border: 1px solid var(--border, #2c2f36); border-radius: 11px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); padding: 12px 14px; }
.dsp-group-new { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 14px; }
.dsp-group-row { display: grid; grid-template-columns: 18px minmax(120px, 1.1fr) 100px minmax(150px, 1.6fr) 62px auto; gap: 8px; align-items: center; padding: 7px 0; border-bottom: 1px solid var(--border-soft, var(--border, #2c2f36)); }
.dsp-group-row:last-child { border-bottom: 0; }
.dsp-group-count { font-size: 11.5px; color: var(--text-faint, #8a8f98); text-align: right; font-variant-numeric: tabular-nums; }
.dsp-group-actions { display: flex; gap: 4px; justify-content: flex-end; }
@media (max-width: 820px) { .dsp-group-row { grid-template-columns: 18px minmax(0, 1fr) 96px; } .dsp-group-note { grid-column: 1 / -1; } .dsp-group-actions { grid-column: 1 / -1; justify-content: flex-start; } }
.dsp-kv { display: grid; grid-template-columns: minmax(110px, 1fr) minmax(0, 2fr) minmax(110px, 1fr) 32px; gap: 8px; align-items: start; }
.dsp-kv-head { font-size: 11.5px; color: var(--text-faint, #8a8f98); padding-bottom: 2px; }
.dsp-kv textarea { min-height: 34px; }
.dsp-overlay { position: fixed; inset: 0; z-index: 70; background: rgba(0,0,0,.45); display: flex; align-items: center; justify-content: center; padding: 24px; }
.dsp-modal { width: min(860px, 100%); max-height: 90vh; display: flex; flex-direction: column; background: var(--bg, #17181c); border: 1px solid var(--border, #2c2f36); border-radius: 13px; box-shadow: 0 24px 60px rgba(0,0,0,.4); overflow: hidden; }
.dsp-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--border, #2c2f36); font-weight: 600; }
.dsp-modal-body { padding: 14px 16px; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; }
.dsp-modal-foot { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 11px 16px; border-top: 1px solid var(--border, #2c2f36); }
.dsp-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
.dsp-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
.dsp-field > span { font-size: 11.5px; color: var(--text-faint, #8a8f98); }
.dsp-section { border: 1px solid var(--border, #2c2f36); border-radius: 10px; padding: 10px 12px; }
.dsp-section-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: var(--text-faint, #8a8f98); margin-bottom: 8px; }
.dsp-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(12px); z-index: 90; padding: 8px 16px; border-radius: 9px; background: var(--bg-elev2, #26282e); border: 1px solid var(--border, #2c2f36); color: var(--text, #e6e6e6); font-size: 12.5px; opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s; }
.dsp-toast.on { opacity: 1; transform: translateX(-50%) translateY(0); }
.dsp-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; background: var(--bg-elev2, #22242a); border: 1px solid var(--border, #2c2f36); border-radius: 7px; padding: 2px 6px; overflow-wrap: anywhere; }
.dsp-stack { display: flex; flex-direction: column; gap: 12px; }
.dsp-stack h4 { margin: 0 0 6px; font-size: 12.5px; }
.dsp-inline { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
`;
