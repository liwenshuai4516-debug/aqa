# T00 源码冻结

源目录：`/Users/liyingjun/Desktop/SW-QA/pi-web-ui-main`（只读）。
版本：pi-web-ui 0.109.0，无上游 Git 元数据。
任务书清单 1,481 文件逐个长度/SHA-256 验证一致，无修改/删除。
初始提交：c5663ab。清单之外 47 项原有资源/语言包/部署文件按 supplemental-manifest.json 补充复用，不从远端替换。
构建环境：macOS arm64；Node 24.19.0（替代当前终端 Node 23.10.0，不改依赖）。
安装命令：npm ci --include=dev --include=optional。

首次提交部分资源受原 .gitignore 排除；T02 显式加入所有基线资源。
