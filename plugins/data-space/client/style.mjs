/** 数据空间视图样式（自包含，只吃宿主主题变量；深浅主题自动跟随）。 */
export const CSS = `
.dsp { --dsp-gap: 12px; position: relative; min-height: 100%; color: var(--text, #e6e6e6); font-size: 13px; line-height: 1.55; padding-bottom: 40px; }
.dsp *, .dsp *::before, .dsp *::after { box-sizing: border-box; }
.dsp svg { width: 16px; height: 16px; }
.dsp-head { position: sticky; top: 0; z-index: 6; display: flex; align-items: flex-end; gap: 12px; padding: 5px 16px 0; background: var(--bg, #17181c); border-bottom: 1px solid var(--border, #2c2f36); }
.dsp-head-hint { margin-left: auto; padding-bottom: 8px; font-size: 11px; color: var(--text-faint, #8a8f98); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: none; }
.dsp-tools { display: flex; align-items: center; gap: 8px; min-width: 0; }
.dsp-search { width: 220px; }
.dsp input, .dsp select, .dsp textarea { font: inherit; color: inherit; background: var(--bg-elev2, #22242a); border: 1px solid var(--border, #2c2f36); border-radius: 8px; padding: 6px 9px; outline: none; min-width: 0; }
.dsp input:focus, .dsp select:focus, .dsp textarea:focus { border-color: var(--accent, #4f8cff); }
.dsp textarea { resize: vertical; }
.dsp-nav { display: flex; align-items: flex-end; gap: 2px; overflow-x: auto; min-width: 0; }
.dsp-nav button { appearance: none; border: 0; background: transparent; color: var(--text-dim, #a4a9b3); font: inherit; padding: 7px 12px; border-radius: 8px 8px 0 0; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; border-bottom: 2px solid transparent; white-space: nowrap; }
.dsp-nav button:hover { color: var(--text, #e6e6e6); background: var(--bg-elev2, #22242a); }
.dsp-nav button.on { color: var(--text, #e6e6e6); border-bottom-color: var(--accent, #4f8cff); font-weight: 600; }
.dsp-num { font-size: 11px; padding: 0 6px; border-radius: 99px; background: var(--bg-elev2, #22242a); border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); }
.dsp-body { padding: 10px 16px 0; }
.dsp h3 { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.35; display: flex; align-items: center; gap: 7px; min-width: 0; }
.dsp-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(142px, 1fr)); gap: 10px; margin-bottom: 12px; }
.dsp-stat { border: 1px solid var(--border, #2c2f36); border-radius: 10px; padding: 9px 12px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); min-width: 0; }
.dsp-stat-label { font-size: 11.5px; color: var(--text-faint, #8a8f98); }
.dsp-stat-value { font-size: 20px; font-weight: 600; line-height: 1.4; }
.dsp-stat-hint { font-size: 11px; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); gap: 12px; }
@media (max-width: 860px) { .dsp-cols { grid-template-columns: minmax(0, 1fr); } }
.dsp-card { border: 1px solid var(--border, #2c2f36); border-radius: 10px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); padding: 10px 12px; min-width: 0; }
.dsp-card-head { font-size: 12px; color: var(--text-faint, #8a8f98); margin-bottom: 8px; display: flex; align-items: center; justify-content: space-between; gap: 8px; }
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
.dsp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 10px; }
.dsp-chip { appearance: none; font: inherit; font-size: 12px; padding: 4px 10px; border-radius: 99px; border: 1px solid var(--border, #2c2f36); background: transparent; color: var(--text-dim, #a4a9b3); cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.dsp-chip:hover { color: var(--text, #e6e6e6); background: var(--bg-elev2, #22242a); }
.dsp-chip.on { color: var(--accent-contrast, #fff); background: var(--accent, #4f8cff); border-color: transparent; }
.dsp-table-wrap { border: 1px solid var(--border, #2c2f36); border-radius: 11px; overflow: auto; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); }
.dsp-table { width: 100%; min-width: 640px; border-collapse: collapse; table-layout: fixed; }
.dsp-table.wide { min-width: 940px; }
.dsp-table th { text-align: left; font-weight: 500; font-size: 11.5px; color: var(--text-faint, #8a8f98); padding: 7px 11px; border-bottom: 1px solid var(--border, #2c2f36); background: var(--bg-elev2, #22242a); }
.dsp-table td { padding: 7px 11px; border-bottom: 1px solid var(--border-soft, var(--border, #2c2f36)); vertical-align: middle; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
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
.dsp-modal { width: min(860px, 100%); max-height: 92vh; display: flex; flex-direction: column; background: var(--bg, #17181c); border: 1px solid var(--border, #2c2f36); border-radius: 13px; box-shadow: 0 24px 60px rgba(0,0,0,.4); overflow: hidden; }
.dsp-modal-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 13px 16px; border-bottom: 1px solid var(--border, #2c2f36); font-weight: 600; }
.dsp-modal-body { padding: 14px 16px 18px; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; }
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

/* ---------------------------------------------------------- 用例库：左项目列表 + 右内容 */
.dsp-layout { display: grid; grid-template-columns: 244px minmax(0, 1fr); gap: 14px; align-items: start; }
.dsp-content { min-width: 0; }
.dsp-projects { position: sticky; top: 42px; max-height: calc(100vh - 72px); display: flex; flex-direction: column; border: 1px solid var(--border, #2c2f36); border-radius: 10px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); overflow: hidden; }
.dsp-projects-head { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--border, #2c2f36); }
.dsp-projects-title { font-size: 11.5px; color: var(--text-faint, #8a8f98); letter-spacing: .3px; flex: 1; }
.dsp-projects-search { padding: 6px 8px; border-bottom: 1px solid var(--border, #2c2f36); }
.dsp-projects-search input { width: 100%; padding: 4px 8px; font-size: 12px; }
.dsp-projects-body { overflow: auto; padding: 6px; flex: 1; display: flex; flex-direction: column; gap: 1px; }
.dsp-project { display: flex; align-items: center; gap: 8px; padding: 7px 8px; border-radius: 8px; cursor: pointer; min-width: 0; border: 1px solid transparent; background: transparent; }
.dsp-project:hover { background: var(--bg-elev2, #22242a); }
.dsp-project.on { background: color-mix(in srgb, var(--accent, #4f8cff) 16%, transparent); border-color: color-mix(in srgb, var(--accent, #4f8cff) 42%, transparent); }
.dsp-project .dsp-dot { flex: none; }
.dsp-project svg { width: 15px; height: 15px; flex: none; color: var(--text-faint, #8a8f98); }
.dsp-project-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.dsp-project-name { font-size: 12.5px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-project-name em { font-style: normal; font-weight: 400; font-size: 10px; color: var(--text-faint, #8a8f98); border: 1px solid var(--border, #2c2f36); border-radius: 4px; padding: 0 3px; margin-left: 4px; }
.dsp-project-meta { font-size: 10.5px; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-project.all { border-bottom: 1px dashed var(--border, #2c2f36); margin-bottom: 4px; }
.dsp-project.all .dsp-project-name { font-weight: 600; }
.dsp-projects-empty { padding: 14px 8px; display: flex; flex-direction: column; gap: 8px; align-items: flex-start; color: var(--text-faint, #8a8f98); font-size: 12px; }
.dsp-projects-foot { border-top: 1px solid var(--border, #2c2f36); padding: 6px 10px; font-size: 10.5px; color: var(--text-faint, #8a8f98); }
.dsp-cnt { font-size: 10.5px; color: var(--text-faint, #8a8f98); font-variant-numeric: tabular-nums; flex: none; }
.dsp-cnt.zero { color: var(--amber, #e0a63c); border: 1px solid color-mix(in srgb, var(--amber, #e0a63c) 45%, transparent); border-radius: 99px; padding: 0 5px; }

/* 项目内的模块 / 功能筛选 */
.dsp-scope { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
.dsp-scope-line { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.dsp-scope-label { font-size: 11px; color: var(--text-faint, #8a8f98); flex: none; width: 28px; }
.dsp-chip-num { margin-left: 5px; font-size: 10px; color: var(--text-faint, #8a8f98); font-variant-numeric: tabular-nums; }
.dsp-chip.on .dsp-chip-num { color: inherit; opacity: .85; }

/* ---------------------------------------------------------- 页头 / 面包屑 / 工具条 */
.dsp-page-head { display: flex; align-items: center; justify-content: space-between; gap: 10px 12px; margin-bottom: 8px; flex-wrap: wrap; }
.dsp-page-title { font-size: 15px; font-weight: 600; display: flex; align-items: center; gap: 7px; min-width: 0; }
.dsp-page-title-wrap { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1 1 320px; }
.dsp-page-sub { font-size: 11.5px; line-height: 1.5; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-crumb { display: flex; align-items: center; gap: 5px; font-size: 11.5px; color: var(--text-faint, #8a8f98); margin-bottom: 4px; flex-wrap: wrap; }
.dsp-crumb button { appearance: none; border: 0; background: transparent; color: var(--text-dim, #a4a9b3); font: inherit; cursor: pointer; padding: 0; }
.dsp-crumb button:hover { color: var(--accent, #4f8cff); text-decoration: underline; }
.dsp-crumb-sep { opacity: .5; }
.dsp-toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.dsp-toolbar .dsp-search { width: 240px; }
.dsp-toolbar .dsp-chips-sep { padding-left: 10px; border-left: 1px solid var(--border, #2c2f36); }

/* ---------------------------------------------------------- 功能 / 模块卡片 + 覆盖率 */
.dsp-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(232px, 1fr)); gap: 12px; }
.dsp-feature-card { border: 1px solid var(--border, #2c2f36); border-radius: 11px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); padding: 11px 13px; display: flex; flex-direction: column; gap: 7px; cursor: pointer; min-width: 0; }
.dsp-feature-card:hover { border-color: var(--accent, #4f8cff); }
.dsp-feature-top { display: flex; align-items: center; gap: 8px; justify-content: space-between; min-width: 0; }
.dsp-feature-name { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-feature-foot { display: flex; align-items: center; gap: 8px; justify-content: space-between; font-size: 11.5px; color: var(--text-faint, #8a8f98); }
.dsp-progress { height: 5px; border-radius: 99px; background: var(--bg-elev2, #22242a); overflow: hidden; flex: 1; min-width: 40px; }
.dsp-progress i { display: block; height: 100%; border-radius: 99px; background: var(--green, #3ecf8e); }
.dsp-progress i.mid { background: var(--amber, #e0a63c); }
.dsp-progress i.zero { background: var(--red, #e5484d); }
.dsp-gap { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border-radius: 8px; cursor: pointer; min-width: 0; }
.dsp-gap:hover { background: var(--bg-elev2, #22242a); }
.dsp-gap-path { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-gap b { flex: none; max-width: 40%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-gap-go { color: var(--accent, #4f8cff); font-size: 11.5px; flex: none; }

/* ---------------------------------------------------------- 徽章 */
.dsp-prio { font-size: 10.5px; font-weight: 600; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); flex: none; }
.dsp-prio.P0 { color: var(--red, #e5484d); border-color: color-mix(in srgb, var(--red, #e5484d) 45%, transparent); background: color-mix(in srgb, var(--red, #e5484d) 12%, transparent); }
.dsp-prio.P1 { color: var(--amber, #e0a63c); border-color: color-mix(in srgb, var(--amber, #e0a63c) 45%, transparent); background: color-mix(in srgb, var(--amber, #e0a63c) 12%, transparent); }
.dsp-prio.P2 { color: var(--accent, #4f8cff); border-color: color-mix(in srgb, var(--accent, #4f8cff) 45%, transparent); background: color-mix(in srgb, var(--accent, #4f8cff) 12%, transparent); }
.dsp-status { font-size: 10.5px; padding: 0 6px; border-radius: 99px; background: var(--bg-elev2, #22242a); border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); flex: none; }
.dsp-status.待评审 { color: var(--amber, #e0a63c); }
.dsp-status.已评审 { color: var(--green, #3ecf8e); }
.dsp-status.已废弃 { color: var(--text-faint, #8a8f98); text-decoration: line-through; }
/* 执行结果：颜色只三档（通过/失败/阻塞），未执行用虚线弱化，过期降不透明度 */
.dsp-result-cell { white-space: nowrap; }
.dsp-result { appearance: none; font: inherit; font-size: 10.5px; line-height: 16px; padding: 0 6px; border-radius: 99px; border: 1px solid var(--border, #2c2f36); background: transparent; color: var(--text-faint, #8a8f98); cursor: pointer; display: inline-flex; align-items: center; gap: 4px; }
.dsp-result:hover { background: var(--bg-elev2, #22242a); }
.dsp-result.pass { color: var(--green, #3ecf8e); border-color: color-mix(in srgb, var(--green, #3ecf8e) 45%, transparent); }
.dsp-result.fail { color: var(--red, #e5484d); border-color: color-mix(in srgb, var(--red, #e5484d) 45%, transparent); }
.dsp-result.blocked { color: var(--amber, #e0a63c); border-color: color-mix(in srgb, var(--amber, #e0a63c) 45%, transparent); }
.dsp-result.none { border-style: dashed; color: var(--text-faint, #8a8f98); }
.dsp-result.stale { opacity: 0.6; }
/* 执行结果页：来源徽章、流水表、任务卡片 */
.dsp-source { font-size: 10.5px; line-height: 17px; padding: 0 6px; border-radius: 99px; border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); flex: none; white-space: nowrap; }
.dsp-source.ai { color: var(--accent, #8b5cf6); border-color: color-mix(in srgb, var(--accent, #8b5cf6) 45%, transparent); background: color-mix(in srgb, var(--accent, #8b5cf6) 12%, transparent); }
.dsp-source.manual { color: var(--text-dim, #a4a9b3); }
.dsp-table.runs { min-width: 960px; }
.dsp-table.runs .dsp-result { cursor: default; }
.dsp-runs-time { font-variant-numeric: tabular-nums; color: var(--text-dim, #a4a9b3); white-space: nowrap; }
/* 环境列：一个短名字，过长截断，完整值在 title 里 */
.dsp-env-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 92px; }
.dsp-task-env { font-size: 10.5px; line-height: 17px; padding: 0 6px; border-radius: 99px; border: 1px solid var(--border, #2c2f36); color: var(--text-dim, #a4a9b3); flex: none; white-space: nowrap; }
.dsp-default { font-size: 10.5px; line-height: 16px; padding: 0 5px; border-radius: 4px; color: var(--blue, #4c9aff); border: 1px solid color-mix(in srgb, var(--blue, #4c9aff) 45%, transparent); flex: none; }
.dsp-url-cell { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 320px; }
.dsp-url-cell .dsp-code { font-size: 11.5px; }
.dsp-run-case { display: flex; align-items: center; gap: 6px; min-width: 0; }
.dsp-run-case b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-run-note { color: var(--text-faint, #8a8f98); font-size: 12px; }
.dsp-task-list { display: flex; flex-direction: column; gap: 10px; }
.dsp-task { border: 1px solid var(--border, #2c2f36); border-radius: 11px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); overflow: hidden; }
.dsp-task-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px; border-bottom: 1px solid var(--border, #2c2f36); flex-wrap: wrap; }
.dsp-task-name { font-weight: 600; min-width: 0; max-width: 44%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-task-when { font-size: 11px; color: var(--text-faint, #8a8f98); font-variant-numeric: tabular-nums; flex: none; }
.dsp-task-sum { margin-left: auto; font-size: 11.5px; color: var(--text-faint, #8a8f98); }
.dsp-task-bar { width: 66px; height: 5px; border-radius: 99px; background: var(--bg-elev2, #22242a); overflow: hidden; flex: none; }
.dsp-task-bar i { display: block; height: 100%; border-radius: 99px; background: var(--green, #3ecf8e); }
.dsp-task-row { appearance: none; font: inherit; color: inherit; text-align: left; display: grid; grid-template-columns: 66px 78px minmax(0, 1fr) minmax(0, 1fr) 84px; gap: 8px; align-items: center; padding: 6px 12px; border: 0; border-bottom: 1px solid var(--border-soft, var(--border, #2c2f36)); background: transparent; cursor: pointer; min-width: 0; width: 100%; }
.dsp-task-row:hover { background: var(--bg-elev2, #22242a); }
.dsp-task-row:last-child { border-bottom: 0; }
.dsp-task-code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-dim, #a4a9b3); }
.dsp-task-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-task-note { font-size: 11.5px; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-task-more { margin: 0 12px 8px; }
.dsp-result-time { font-size: 9.5px; color: var(--text-faint, #8a8f98); font-variant-numeric: tabular-nums; }
.dsp-progress i.pass { background: var(--green, #3ecf8e); }
.dsp-bar i.pass { background: var(--green, #3ecf8e); }
.dsp-bar i.fail { background: var(--red, #e5484d); }
.dsp-bar i.blocked { background: var(--amber, #e0a63c); }
.dsp-bar i.none { background: var(--text-faint, #8a8f98); }
.dsp-bad { color: var(--red, #e5484d); }
.dsp-warn { color: var(--amber, #e0a63c); }
.dsp-code-cell { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; color: var(--text-dim, #a4a9b3); }.dsp-path-cell { font-size: 11px; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-cell-main { white-space: normal; }
.dsp-type-cell { white-space: nowrap; }
.dsp-case-path { font-size: 10.5px; color: var(--text-faint, #8a8f98); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 2px; }
.dsp-type { display: inline-block; font-size: 10.5px; line-height: 17px; padding: 0 6px; border-radius: 5px; flex: none; white-space: nowrap; border: 1px solid var(--border, #2c2f36); color: var(--text-faint, #8a8f98); }
.dsp-type.api { color: var(--blue, #3b82f6); border-color: color-mix(in srgb, var(--blue, #3b82f6) 45%, transparent); background: color-mix(in srgb, var(--blue, #3b82f6) 12%, transparent); }
.dsp-type.ui { color: var(--accent, #8b5cf6); border-color: color-mix(in srgb, var(--accent, #8b5cf6) 45%, transparent); background: color-mix(in srgb, var(--accent, #8b5cf6) 12%, transparent); }
.dsp-type.other { color: var(--text-faint, #8a8f98); background: var(--bg-elev2, #22242a); }

/* ---------------------------------------------------------- 弹窗内步骤 / 关联数据 / 三级选择 */
.dsp-step { display: grid; grid-template-columns: 20px minmax(0, 1fr) minmax(0, 1fr) 28px; gap: 6px; align-items: start; margin-bottom: 6px; }
.dsp-step-head { font-size: 11.5px; color: var(--text-faint, #8a8f98); margin-bottom: 4px; }
.dsp-step-no { font-size: 11px; color: var(--text-faint, #8a8f98); text-align: center; padding-top: 8px; }
.dsp-step textarea { min-height: 34px; }
.dsp-linked { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 2px; max-height: 168px; overflow: auto; }
.dsp-linked-item { display: grid; grid-template-columns: 14px minmax(0, 1fr); column-gap: 6px; align-items: center; padding: 3px 6px; border-radius: 7px; cursor: pointer; min-width: 0; }
.dsp-linked-item:hover { background: var(--bg-elev2, #22242a); }
.dsp-linked-item input { grid-row: 1 / span 2; }
.dsp-linked-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-linked-item .dsp-muted { font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-path-selects { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; }
.dsp-modal.narrow { width: min(520px, 100%); }

/* ---------------------------------------------------------- 引入到 AI 对话 */
.dsp-modal.brief-modal { width: min(620px, 100%); }
.dsp-brief-scope { display: flex; flex-direction: column; gap: 1px; border: 1px solid var(--border, #2c2f36); border-radius: 9px; padding: 7px 10px; background: var(--bg-elev, var(--bg-elev2, #1d1f24)); min-width: 0; }
.dsp-brief-scope b { font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-brief-preview { width: 100%; min-height: 210px; max-height: 42vh; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; line-height: 1.65; white-space: pre; overflow: auto; }
.dsp-brief-note { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
.dsp-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--text-dim, #a4a9b3); cursor: pointer; }
.dsp-check input { width: 14px; height: 14px; padding: 0; }
.dsp-brief-count { margin-right: auto; }
.dsp-briefed { font-size: 10px; line-height: 16px; padding: 0 5px; border-radius: 5px; flex: none; white-space: nowrap; color: var(--green, #3ecf8e); border: 1px solid color-mix(in srgb, var(--green, #3ecf8e) 45%, transparent); background: color-mix(in srgb, var(--green, #3ecf8e) 12%, transparent); }
.dsp-tips { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--text-dim, #a4a9b3); }
.dsp-tips div::before { content: "·"; margin-right: 6px; color: var(--text-faint, #8a8f98); }
.dsp-tip { border: 1px solid color-mix(in srgb, var(--amber, #e0a63c) 40%, transparent); background: color-mix(in srgb, var(--amber, #e0a63c) 10%, transparent); border-radius: 9px; padding: 7px 11px; font-size: 12px; margin-bottom: 12px; }
.dsp-case-title { display: flex; align-items: center; gap: 6px; min-width: 0; cursor: pointer; }
.dsp-case-title b { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dsp-case-title:hover b { color: var(--accent, #4f8cff); }
.dsp-num-cell { font-variant-numeric: tabular-nums; color: var(--text-dim, #a4a9b3); text-align: right; }
.dsp-meta-line { font-size: 11.5px; color: var(--text-faint, #8a8f98); margin-top: 3px; }
.dsp-gap-list { display: flex; flex-direction: column; gap: 1px; }
.dsp-project, .dsp-gap, .dsp-feature-card { appearance: none; font: inherit; color: inherit; text-align: left; width: 100%; border-radius: 8px; }
.dsp-notice { border: 1px solid color-mix(in srgb, var(--amber, #e0a63c) 40%, transparent); background: color-mix(in srgb, var(--amber, #e0a63c) 10%, transparent); color: var(--text, #e6e6e6); border-radius: 9px; padding: 8px 11px; font-size: 12px; }

@media (max-width: 1000px) {
	.dsp-layout { grid-template-columns: minmax(0, 1fr); }
	.dsp-projects { position: static; max-height: 260px; }
	.dsp-head { padding: 4px 12px 0; }
	.dsp-head-hint { display: none; }
	.dsp-body { padding: 10px 12px 0; }
	.dsp-overlay { padding: 12px; }
	.dsp-step { grid-template-columns: 18px minmax(0, 1fr) 26px; }
	.dsp-step textarea[data-sf="expect"] { grid-column: 2 / 3; }
	/* 执行结果窄屏：先保住时间 / 结论 / 环境 / 用例，路径、来源与任务靠搜索与展开看 */
	.dsp-table.runs col:nth-child(5), .dsp-table.runs th:nth-child(5), .dsp-table.runs td:nth-child(5),
	.dsp-table.runs col:nth-child(7), .dsp-table.runs th:nth-child(7), .dsp-table.runs td:nth-child(7) { display: none; }
	.dsp-task-row { grid-template-columns: 60px minmax(0, 1fr) 76px; }
	.dsp-task-note { display: none; }
	/* 窄屏先让位给名称与地址，备注/更新时间靠编辑弹窗查看 */
	.dsp-table.ds col:nth-child(5), .dsp-table.ds th:nth-child(5), .dsp-table.ds td:nth-child(5) { display: none; }}
@media (max-width: 620px) {
	/* 更窄时地址最要紧，让出所属项目与备注 */
	.dsp-table.ds col:nth-child(2), .dsp-table.ds th:nth-child(2), .dsp-table.ds td:nth-child(2),
	.dsp-table.ds col:nth-child(4), .dsp-table.ds th:nth-child(4), .dsp-table.ds td:nth-child(4) { display: none; }
}
`;
