# T19：真实模型委派、目标执行与 D06 修复

当前 macOS 内部包已包含 D06 的一行修复。真实模型委派通过，目标执行写入并读回指定文件、审查者实际读取成功；T19 的最终判定请求因累计 8 次上限被拦截，完整闭环未通过。不能将本地脚本 PASS 当作真实供应商 PASS。

## 费用和请求证据

用户先批准累计 8 次，再明确批准将 deepseek-chat 改为当前官方有明确价格的 deepseek-flash。新增 6 次全部 HTTP 200，共输入 9,016、输出 342 tokens，单次输出最高 86。加上原两次，累计输入 12,251、输出 358 tokens。按官方高峰价且忽略缓存优惠，新增费用上界 0.020768 元；这不是账单。官方公开价格文本保留，密钥未写入应用配置、源码、日志或产物。

T19-real-budget.json 在转发前持久化计数；失败/不明请求也占用次数，费用全额预留，不静默重试或退还次数。T19-real.json 保留整体 FAIL 和请求阶段；T19-real-transcript-summary.json 留存独立测试目录下的实际工具调用、成功结果及两个测试文件哈希。真实执行者多做一次 read，使完整审查超出本轮额度；下一个请求在本地被拒绝，未向供应商转发。

## D06 的复现与修复

旧实际 DMG 中，委派开关重载 SDK 后遗失工具禁用设置，目标审查请求重新携带 30 个工具、43,652 字节。D06-before-package.json 保留大小和工具列表，不含请求正文或凭据。输入守卫提前拦截，因此没有为这次本地诊断付费。

用户批准后，仅在 setDelegateMode 的 reload 后调用已有 applyToolGating。原 delegate-mode-test 新增请求工具列表断言：修复前失败，修复后同一测试全部通过。受保护源码与原目录哈希核对通过，登记文件为 approved-changes.json；未触碰来源未明的 bottombar 差异。

新实际安装包 T19-local.json 完成原委派、目标执行、审查者 read 和原服务器接受判定。各请求只有 read/write。6 次本地请求后，额外的自动完成回复被守卫拦截；这不影响此前已完成的本地判定，但也不能推出真实模型一定用同样回合数完成。

## 重建、安装和检查

常规打包在 Electron 下载阶段网络连接停滞，保留 T19-package-build.log；停止该自有打包进程后，使用已安装且同版本的 Electron 44.4.2 目录完成打包，见 T19-package-local-runtime.log。SDK/运行时版本未升级。

T19-installed-artifacts.json/log：实际 DMG 挂载复制并卸载镜像后启动，ZIP 解压启动；均位于源码目录外中文/空格路径，移除系统 Node PATH，健康接口 200、正常退出。安装检查还逐字比较主进程、daemon 和本次修改的 agent-service 编译文件。T19-packaged-smoke.json/png 与 T19-package-smoke.log 验证包内 SDK、鉴权、原离线插件安装器和真实 PTY 输入/尺寸/退出。历史 packaged-smoke 文件已恢复原始内容，新证据独立保存；测试补充可选证据路径参数，避免后续覆盖历史。

相关 17 文件 / 113 单测、全项目类型检查通过。预算守卫另有独立边界测试；T20 扩额后新增保留计数、仅结算已完成用量及不明费用不退还检查，共 4 项通过。

本轮新 DMG SHA-256：ba2f4f3efcca5c8cb098c2f0612b8acc6422bf3295010f78e0c17d2e41e2bc71。
新 ZIP SHA-256：0add6ad5b3870724c169c0ce54c64798823cae9ec5b3636379e7f4933a01da49。
release/SHA256SUMS.txt 已更新。仍为临时身份、未签名/公证内部包；没有正式更新发布、旧版本升级或全新账户 Gatekeeper 验收。
