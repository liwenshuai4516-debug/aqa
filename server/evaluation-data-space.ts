/** Private, owner-bound bridge. Data Space owns its files; evaluation cannot invoke intake or native execution. */
export type DataSpaceBinding = {
	principalId: string;
	workspaceId: string;
	workspace: string;
};
export type DataSpaceEvaluationProvider = (
	request: Record<string, unknown>,
	binding: DataSpaceBinding,
	verify: () => void,
) => Promise<unknown>;
