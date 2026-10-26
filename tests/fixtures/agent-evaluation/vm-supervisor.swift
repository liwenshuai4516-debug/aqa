import Darwin
import Dispatch
// Test-only diskless Linux VM. No network/share/disk/vsock devices; serial is the sole guest channel.
import Foundation
import Virtualization

func event(_ values: [String: Any]) {
  let data = try! JSONSerialization.data(withJSONObject: values, options: [.sortedKeys])
  FileHandle.standardError.write(data + Data([10]))
}
let args = CommandLine.arguments
guard args.count == 3 else {
  event(["event": "invalid-arguments"])
  exit(2)
}
let boot = VZLinuxBootLoader(kernelURL: URL(fileURLWithPath: args[1]))
boot.initialRamdiskURL = URL(fileURLWithPath: args[2])
boot.commandLine = "console=hvc0 rdinit=/bin/sh panic=-1 loglevel=4"
let serial = VZVirtioConsoleDeviceSerialPortConfiguration()
serial.attachment = VZFileHandleSerialPortAttachment(
  fileHandleForReading: .standardInput, fileHandleForWriting: .standardOutput)
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
  event(["event": "validation-error", "error": String(describing: error)])
  exit(2)
}
let vm = VZVirtualMachine(configuration: config)
final class Delegate: NSObject, VZVirtualMachineDelegate {
  func guestDidStop(_ virtualMachine: VZVirtualMachine) {
    event(["event": "guest-stopped"])
    exit(0)
  }
  func virtualMachine(_ virtualMachine: VZVirtualMachine, didStopWithError error: Error) {
    event(["event": "vm-error", "error": String(describing: error)])
    exit(3)
  }
}
let delegate = Delegate()
vm.delegate = delegate
signal(SIGUSR1, SIG_IGN)
let stop = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: .main)
stop.setEventHandler {
  event(["event": "force-stop-request", "state": vm.state.rawValue])
  vm.stop { error in
    if let error = error {
      event(["event": "stop-error", "error": String(describing: error)])
      exit(4)
    }
    event(["event": "force-stopped", "state": vm.state.rawValue])
    exit(0)
  }
}
stop.resume()
// A crashed test controller cannot leave this diagnostic guest running indefinitely.
DispatchQueue.main.asyncAfter(deadline: .now() + 45) {
  event(["event": "watchdog-stop"])
  vm.stop { _ in exit(6) }
}
vm.start { result in
  switch result {
  case .success:
    event([
      "event": "running", "networkDevices": config.networkDevices.count,
      "shares": config.directorySharingDevices.count, "disks": config.storageDevices.count,
      "sockets": config.socketDevices.count,
    ])
  case .failure(let error):
    event(["event": "start-error", "error": String(describing: error)])
    exit(5)
  }
}
dispatchMain()
