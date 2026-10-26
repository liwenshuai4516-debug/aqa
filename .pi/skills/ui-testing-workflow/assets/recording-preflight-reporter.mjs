// Public Reporter API only. Do not serialize use values, metadata or collection errors.
export default class RecordingPreflightReporter {
	report = { version: 1, projects: [], tests: [], errors: false };
	onBegin(config, suite) {
		this.report.projects = config.projects.map((project) => ({
			name: project.name,
			testDir: project.testDir,
			storageStateConfigured:
				project.use.storageState !== undefined || project.use.contextOptions?.storageState !== undefined,
		}));
		this.report.tests = suite.allTests().map((test) => ({ file: test.location.file }));
	}
	onError() {
		this.report.errors = true;
	}
	onEnd() {
		process.stdout.write(JSON.stringify(this.report));
	}
}
