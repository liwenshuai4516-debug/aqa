/** Pi adapter uses only the strict host reader; never opens a session file. */
export const piEvidenceAdapter = {
	id: "pi",
	version: "1",
	capabilities: () => ({
		history: "partial",
		live: "partial",
		tools: "partial",
		children: "partial",
		usage: "partial",
	}),
	collect(host, clientId, scope, conversationId, cursor) {
		return host.readEvaluationEvidence(clientId, {
			conversationId,
			mode: "collect",
			sessionId: scope.sessionId,
			startMessageId: scope.startMessageId,
			endMessageId: scope.endMessageId,
			childSessionIds: scope.childSessionIds,
			cursor,
			limit: 1000,
		});
	},
};
