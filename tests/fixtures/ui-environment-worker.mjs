import { createProjectEnvironment } from "../../qa/ui/project-environment.mjs";
const fixture = await createProjectEnvironment({ signalHandlers: true });
const data = await fixture.createOwnedData({ synthetic: true });
process.send({ root: fixture.root, port: fixture.port, serverPid: fixture.serverPid, data: data.value });
