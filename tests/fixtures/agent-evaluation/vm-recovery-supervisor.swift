// Offline crash-recovery probe only. Immutable host records; no PID-directed control or product API.
import Darwin
import Dispatch
import Foundation
import Virtualization

let args = CommandLine.arguments
guard args.count == 4 || (args.count == 5 && args[4] == "--crash-after-claim") else { exit(2) }
let directory = args[3]
let intentURL = URL(fileURLWithPath: directory).appendingPathComponent("intent.json")
func readIntent() -> [String: String] {
  guard let data = try? Data(contentsOf: intentURL),
    let value = try? JSONSerialization.jsonObject(with: data) as? [String: String],
    value["attemptId"] != nil, value["nonce"] != nil
  else { exit(2) }
  return value
}
let intent = readIntent()
let attempt = intent["attemptId"]!
let nonce = intent["nonce"]!
let supervisor = UUID().uuidString
// Never remove this marker: even a crash before the first handle must prevent automatic resubmission.
let claim = open(directory + "/launch-claim", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
guard claim >= 0 else { exit(9) }
guard fsync(claim) == 0 else { exit(10) }
close(claim)
let directoryFD = open(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)
guard directoryFD >= 0, fsync(directoryFD) == 0 else { exit(10) }
if args.count == 5 { kill(getpid(), SIGKILL) }
let started = ProcessInfo.processInfo.systemUptime
var sequence = 0
func record(_ event: String, _ extra: [String: Any] = [:]) {
  sequence += 1
  var values: [String: Any] = [
    "event": event, "attemptId": attempt, "nonce": nonce, "supervisorId": supervisor,
    "pid": getpid(), "supervisorStartedMonotonic": started, "sequence": sequence,
  ]
  for (key, value) in extra { values[key] = value }
  do {
    let bytes = try JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
    let file = directory + String(format: "/event-%06d.json", sequence)
    let fd = open(file, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard fd >= 0 else { exit(10) }
    // FileHandle.write handles partial writes. No event is trusted until a later exclusive seal exists.
    let handle = FileHandle(fileDescriptor: fd, closeOnDealloc: false)
    try handle.write(contentsOf: bytes)
    guard fsync(fd) == 0 else { exit(10) }
    close(fd)
    let seal = open(file + ".sealed", O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW, 0o600)
    guard seal >= 0, fsync(seal) == 0 else { exit(10) }
    close(seal)
    guard fsync(directoryFD) == 0 else { exit(10) }
  } catch { exit(10) }
}
record("claimed")
let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: args[1]))
boot.initialRamdiskURL = URL(fileURLWithPath: args[2])
boot.commandLine = "console=hvc0 rdinit=/bin/sh panic=-1 loglevel=4"
let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
serial.attachment = VZFileHandleSerialPortAttachment(
  fileHandleForReading: nil, fileHandleForWriting: .standardOutput)
let config = VZVirtualMachineConfiguration()
config.platform = VZGenericPlatformConfiguration()
config.bootLoader = boot
config.cpuCount = 2
config.memorySize = 512 * 1024 * 1024
config.serialPorts = [serial]
config.entropyDevices = [VZVirtioEntropyDeviceConfiguration()]
config.networkDevices = []
config.directorySharingDevices = []
config.storageDevices = []
config.socketDevices = []
do { try config.validate() } catch {
  record("validation-error", ["error": String(describing: error)])
  exit(2)
}
let vm = VZVirtualMachine(configuration: config)
var stopping = false
func stop(_ reason: String) {
  guard !stopping else { return }
  stopping = true
  record("stop-requested", ["reason": reason, "state": vm.state.rawValue])
  vm.stop { error in
    if let error = error {
      record("stop-error", ["error": String(describing: error)])
      exit(4)
    }
    record("stopped", ["reason": reason, "state": vm.state.rawValue])
    exit(0)
  }
}
final class Delegate: NSObject, VZVirtualMachineDelegate {
  func guestDidStop(_ virtualMachine: VZVirtualMachine) {
    record("guest-stopped", ["state": virtualMachine.state.rawValue])
    exit(0)
  }
  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    record("vm-error", ["error": String(describing: error)])
    exit(3)
  }
}
let delegate = Delegate()
vm.delegate = delegate
let timer = DispatchSource.makeTimerSource(queue: .main)
var lastCommand: Data?
timer.schedule(deadline: .now(), repeating: .milliseconds(50))
timer.setEventHandler {
  let url = URL(fileURLWithPath: directory).appendingPathComponent("control.json")
  guard let data = try? Data(contentsOf: url), data != lastCommand else { return }
  lastCommand = data
  guard data.count <= 4096,
    let command = try? JSONSerialization.jsonObject(with: data) as? [String: String],
    command["attemptId"] == attempt, command["nonce"] == nonce,
    command["supervisorId"] == supervisor,
    let request = command["requestId"], request.count <= 64,
    ["stop", "probe"].contains(command["action"] ?? "")
  else {
    record("control-rejected")
    return
  }
  if command["action"] == "probe" {
    record("probe", ["requestId": request, "state": vm.state.rawValue])
  } else if vm.state == .running {
    stop("recovered-controller")
  } else {
    record("control-not-running", ["state": vm.state.rawValue])
  }
}
timer.resume()
// Test-owned finite lifetime even if both controllers crash. Not a product timeout policy.
DispatchQueue.main.asyncAfter(deadline: .now() + 30) { stop("diagnostic-watchdog") }
record("starting")
vm.start { result in
  switch result {
  case .success:
    record("running", ["state": vm.state.rawValue])
  case .failure(let error):
    record("start-error", ["error": String(describing: error)])
    exit(5)
  }
}
dispatchMain()
