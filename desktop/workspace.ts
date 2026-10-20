import { accessSync, constants, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

/** Resolve symlinks before rejecting the home root; never create a selected project. */
export function validateWorkspace(candidate: string): string {
	const path = realpathSync(resolve(candidate));
	if (path === realpathSync(homedir())) throw new Error("请选择具体项目文件夹，不能使用用户主目录。");
	if (!statSync(path).isDirectory()) throw new Error("工作区必须是文件夹。");
	accessSync(path, constants.R_OK | constants.X_OK);
	return path;
}
