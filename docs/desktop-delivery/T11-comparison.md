# T11：原宿主与 macOS 安装包同机对照

日期 2026-10-20；macOS arm64、Electron 44.4.2、SDK 1.1.0。生产代码与产物未变，当前包对应 c56bcf6；本轮新增验收脚本与证据。

原目录只读。脚本读取原 desktop/*.ts/cts，经 esbuild 单文件转译到新项目 dist/desktop-baseline-comparison，不捆绑或修改源文件。原宿主与当前安装包使用同版本业务构建和 Electron，D02/D03 在本夹具不触发；这份对照只证明桌面宿主迁移影响，不冒充独立重建全部原业务的比较。

每个模式各三次，交替运行顺序。每次新建独立 userData、agent、data 和会话根目录，工作区使用同一实体路径；相同 1280×860 内容区域、DPR=2、默认主题和中文语言。未清系统磁盘缓存，因此是“新配置目录启动”，不是严格冷盘启动。

| 指标（三次中位数） | 原宿主 | 当前安装包 |
| --- | --- | --- |
| 到 .app 且启动占位消失 | 2,698.6 ms | 2,372.0 ms |
| 空闲 3 秒后自有进程树 RSS | 824.3 MiB | 832.0 MiB |
| 终端输入到真实输出 | 51.0 ms | 51.3 ms |
| 200 条消息滚动帧间隔 P95 | 33.6 ms | 34.6 ms |

RSS 是进程树求和，可能重复计共享页；终端等待以 50ms 轮询采样，不能分辨亚 50ms 延迟。滚动使用真实导入的 200 条会话消息、60 次位置更新及 requestAnimationFrame；当前所有六个样本均有非零可滚动视口，内容高度 43,447 CSS px、视口 674 CSS px。这些有限样本没有显示明显退化，不能推导性能保证。

初次长对话脚本漏传扁平会话根而找不到记录，随后部分滚动样本持有被 React 替换的旧元素，出现零视口。两者均修正测试夹具和观测方法并重新运行，原失败/无效结果保存为 missing-session-root、stale-scroll 证据，不纳入中位数。最终结果为 baseline-comparison.json、performance-summary.json。

## 视觉

同一长对话底部、同一草稿、同一工作区，以只读基线宿主和当前包分别截图。仅隐藏闪烁光标，掩码 selector 为 `.status-host-metrics`（实时 CPU/内存）、`.project-time` 与 `.session-time`（时间）；没有掩盖布局或消息内容。

主要 topbar、inputbar、inputbox 的边界矩形、字体、文字色及背景色记录完全一致（compare-*-layout.json）。2560×1720 截图中通道差异大于 8 的像素 12,522 / 4,403,200，即 0.2844%。已目视原图和差异图，未见位移、组件缺失或样式重设计；差异集中于动态显示及渐变/透明渲染，不能仅凭比例断言所有页面视觉一致。原图 compare-baseline.png、compare-current.png，差异图 compare-difference.png，计算为 visual-comparison.json。

## DMG 安装路径

将最终 DMG 只读挂载，使用系统复制工具把应用复制到源码外的中文/空格路径，随后卸载镜像。使用这份已复制应用执行原生连续启动检查，不依赖挂载镜像或开发 Node PATH。安装位置和操作见 dmg-install.json，运行结果见 dmg-native-launch.json。未签名，未完成新系统用户、下载隔离与 Gatekeeper 验收。

任务仍未全部完成。系统浏览器实际派发、系统通知/扬声器人工感知、部分业务组合、正式签名/更新渠道与受控升级仍需后续证据。
