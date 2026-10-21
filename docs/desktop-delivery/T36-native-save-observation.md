# T36 原生保存句柄与字节补证

日期：2026-10-21。对应 T07/A05、T33。使用原 T19/D06 实际 DMG 安装应用、原下载按钮及原 showSaveFilePicker。只修改验收脚本 native-save-raw-probe.mjs，不修改生产源码、前端下载分支或安装包。

## 方法与记录

新增可选 --observe-restrictions：包装原 Session.emit，观察受限路径事件后原样调用原 emit；没有注册权限事件监听器、调用许可回调、改变原选择器结果或关闭目录保护。新增 --home-downloads：在 Downloads 下建立专属临时验收目录，期望该目录中的中文文件名，不触及已有文件。测试脚本不写目标 ZIP，只写独立工作区的源样本。

新增原始 CDP Page.frameNavigated 记录与主文档 1.2 秒导航静默等待。导航只记录时间、origin 和 pathname，丢弃 query/hash；不改变文件选择器或下载行为。接口包装仍把原参数和原返回句柄原样传回原下载流程，仅另存引用用于读回。

首轮 T36-native-save-observed 为 FAIL：接口很快返回 AbortError，未记录受限路径事件，未进入已确认的原生等待。不凭该结果断言 /tmp 属于取消原因。

T36-native-save-stable 为句柄/内容 PASS：记录一次原页面导航，静默后触发原文件行下载。两秒时原接口仍 pending，随后 selected，返回原 FileSystemFileHandle；其 getFile/arrayBuffer 实际读到与源样本相同的 22 字节有效空 ZIP。suggestedName 与 handle.name 均为“报告.zip”。用户随后明确回复“已经保存了”。应用正常退出，真实模型请求为 0。

独立核对见 T36-native-save-independent.json：源样本、句柄字节和预设 ZIP 字节完全一致，SHA256=8739c76e681f900923b900c9df0ef75cf421d39cabb54650c4b9ad19b6a76d85。未用人工确认替代字节断言。

## 不能计为通过的部分

预设 /Users/liyingjun/Downloads/pi-native-save-HChpsJ/中文 downloads/报告.zip 不存在，expectedPathExists=false 原样保留。实际选择的宿主完整路径尚未确认；有限范围查找也未定位文件。因此这里只证明原生接口返回中文文件句柄且原写入后的内容正确，不宣称指定中文目录落地或跨进程重开文件通过。

两轮均未观察到 file-system-access-restricted 事件，只表述为未记录，不据此排除所有目录权限因素。成功轮触发前 focused=false、visible=true、minimized=false；不能凭一次成功宣布窗口焦点不影响所有场景。导航稳定等待与一次成功同时发生，但尚未证明此前所有 AbortError 都由重载造成。原 T33/T36 FAIL 全部保留，不关闭整个 A05，也不重建尚无已证实修复的安装包。

## 工程检查

定向 Prettier、全项目 typecheck、源目录/受保护哈希门禁通过。首次单测命令误列两个不存在的过滤路径，实际只有 files-wire-path 的 7 PASS/5 SKIP，原日志 T36-related-unit.log 保留；随后明确运行三个实际相关文件，T36-verified-related-unit.log 为 3 文件/15 PASS/5 Windows 专属 SKIP。未把未匹配文件或 SKIP 计为通过。

来源未明的 bottombar 差异保持独立未提交。没有生产改动、额外付费请求、选择器模拟或遗留运行中的测试应用。正式发布、原生目录选择/取消、通知及实际保存路径等未完成项继续保留。
