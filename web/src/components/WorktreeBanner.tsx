/**
 * web/src/components/WorktreeBanner.tsx
 *
 * 顶部 Git 工作树（Worktree）状态横幅：
 * 1. 状态一：当前工作区正处于某个子工作树（Linked Worktree）内：
 *    - 强视觉提示当前分支与关联主仓库；
 *    - 一键切回主仓库 (main)；
 *    - 一键清理/销毁工作树。
 * 2. 状态二：当前在主仓库，但检测到名下有尚未清理的子工作树（含修改/隔离分支）：
 *    - 提醒用户有未合入或未清理的工作树，防止漏改；
 *    - 支持一键切换过去查看或一键清理。
 */

import React, { useState } from "react";
import type { WorktreeInfo } from "../types";
import { useT } from "../i18n";

export interface WorktreeBannerProps {
	worktree: WorktreeInfo;
	onSwitch: (path: string) => void;
	onRemove: (path: string, force?: boolean) => void;
}

export const WorktreeBanner: React.FC<WorktreeBannerProps> = ({ worktree, onSwitch, onRemove }) => {
	const t = useT();
	const [expanded, setExpanded] = useState(false);

	const getFolderName = (p: string) => {
		const parts = p.replace(/\\/g, "/").split("/").filter(Boolean);
		return parts[parts.length - 1] || p;
	};

	/**
	 * 删除确认：干净的工作树一次确认即可；有未提交修改时必须再确认一次才带 force，
	 * 否则服务端会以「包含未提交的文件修改」拒绝，用户点垃圾桶永远删不掉。
	 */
	const confirmRemove = (path: string, name: string, dirty: boolean, count?: number) => {
		if (!window.confirm(t("worktreeActionRemoveConfirm", { path: name }))) return;
		if (!dirty) {
			onRemove(path);
			return;
		}
		const changes = count && count > 0 ? count : 1;
		if (window.confirm(t("worktreeActionRemoveForceConfirm", { path: name, count: changes }))) {
			onRemove(path, true);
		}
	};

	// 状态一：当前工作区就是子工作树
	if (worktree.isLinkedWorktree) {
		const branchName = worktree.branch || getFolderName(worktree.currentPath);
		const currentLinked = (worktree.linkedWorktrees || []).find((w) => w.path === worktree.currentPath);
		return (
			<div className="worktree-banner linked" role="region" aria-label={branchName}>
				<div className="worktree-banner-info">
					<span className="worktree-banner-title">
						🌿 {t("worktreeBannerActiveTitle", { branch: branchName })}
						<span className="lp-worktree-badge linked">{t("worktreeBadgeLinked")}</span>
					</span>
					<span className="worktree-banner-desc">
						{t("worktreeBannerActiveDesc", {
							main: worktree.mainPath,
							mainBranch: worktree.mainBranch || "main",
						})}
					</span>
				</div>
				<div className="worktree-banner-actions">
					<button
						type="button"
						className="worktree-banner-btn primary"
						title={t("worktreeActionSwitchMainTip")}
						onClick={() => onSwitch(worktree.mainPath)}
					>
						⬅️ {t("worktreeActionSwitchMain")}
					</button>
					<button
						type="button"
						className="worktree-banner-btn danger"
						title={t("worktreeActionRemoveTip")}
						onClick={() =>
							confirmRemove(
								worktree.currentPath,
								branchName,
								currentLinked?.isDirty ?? false,
								currentLinked?.uncommittedCount,
							)
						}
					>
						🗑️ {t("worktreeActionRemove")}
					</button>
				</div>
			</div>
		);
	}

	// 状态二：当前在主仓库，名下有子工作树
	const linked = worktree.linkedWorktrees || [];
	if (linked.length === 0) {
		return null;
	}

	const dirtyCount = linked.filter((w) => w.isDirty).length;
	const namesSummary = linked
		.map((w) => {
			const b = w.branch || getFolderName(w.path);
			return w.isDirty ? `${b}*` : b;
		})
		.join(" · ");

	return (
		<div className="worktree-banner notice" role="region" aria-label="Git Worktrees">
			<div className="worktree-banner-info">
				<span className="worktree-banner-title">
					⚠️ {t("worktreeBannerUncleanedTitle", { count: linked.length })}
					{dirtyCount > 0 && (
						<span className="lp-worktree-badge dirty">{t("worktreeBadgeDirtyCount", { count: dirtyCount })}</span>
					)}
				</span>
				<span className="worktree-banner-desc">{t("worktreeBannerUncleanedDesc", { names: namesSummary })}</span>
			</div>
			<div className="worktree-banner-actions">
				{linked.slice(0, 2).map((wt) => {
					const name = wt.branch || getFolderName(wt.path);
					return (
						<React.Fragment key={wt.path}>
							<button
								type="button"
								className="worktree-banner-btn"
								title={t("worktreeActionSwitchToTip", { name })}
								onClick={() => onSwitch(wt.path)}
							>
								➡️ {t("worktreeActionSwitchTo", { name })}
							</button>
							<button
								type="button"
								className="worktree-banner-btn danger"
								title={t("worktreeActionRemoveTip")}
								onClick={() => confirmRemove(wt.path, name, Boolean(wt.isDirty), wt.uncommittedCount)}
							>
								🗑️
							</button>
						</React.Fragment>
					);
				})}
				{linked.length > 2 && (
					<button type="button" className="worktree-banner-btn" onClick={() => setExpanded(!expanded)}>
						{expanded ? t("worktreeActionCollapse") : t("worktreeActionMore", { count: linked.length - 2 })}
					</button>
				)}
			</div>
			{expanded && linked.length > 2 && (
				<div className="worktree-banner-expand">
					{linked.slice(2).map((wt) => {
						const name = wt.branch || getFolderName(wt.path);
						return (
							<div key={wt.path} className="worktree-expand-row">
								<span className="worktree-expand-name">
									{name}
									{wt.isDirty && (
										<span className="lp-worktree-badge dirty">
											{t("worktreeBadgeDirtyCount", { count: wt.uncommittedCount || 1 })}
										</span>
									)}
								</span>
								<div className="worktree-expand-actions">
									<button type="button" className="worktree-banner-btn" onClick={() => onSwitch(wt.path)}>
										➡️ {t("worktreeActionSwitchTo", { name })}
									</button>
									<button
										type="button"
										className="worktree-banner-btn danger"
										onClick={() => confirmRemove(wt.path, name, Boolean(wt.isDirty), wt.uncommittedCount)}
									>
										🗑️
									</button>
								</div>
							</div>
						);
					})}
				</div>
			)}
		</div>
	);
};
