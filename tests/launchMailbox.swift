import Foundation
import Darwin

@main
enum LaunchMailboxCheck {
  static func main() throws {
    let directory = URL(fileURLWithPath: CommandLine.arguments[1])
    let mailbox = HyperLaunchMailbox(directory: directory, key: "test")
    if CommandLine.arguments.count > 2 {
      mailbox.post(["action": "snap-meal", "atMs": 200])
      return
    }
    precondition(mailbox.take().isEmpty)
    mailbox.post(["action": "train", "atMs": 100])
    mailbox.post(["action": "snap-meal", "atMs": 200])
    precondition(mailbox.take()["action"] as? String == "snap-meal")
    precondition(mailbox.take().isEmpty)

    let other = HyperLaunchMailbox(directory: directory, key: "other-app")
    mailbox.post(["action": "train", "atMs": 100])
    other.post(["action": "log-food", "atMs": 200])
    precondition(mailbox.take()["action"] as? String == "train")
    precondition(other.take()["action"] as? String == "log-food")

    for _ in 0..<100 {
      mailbox.post(["action": "snap-meal", "atMs": 200])
      let lock = NSLock()
      var consumed = 0
      DispatchQueue.concurrentPerform(iterations: 16) { _ in
        let reader = HyperLaunchMailbox(directory: directory, key: "test")
        if !reader.take().isEmpty {
          lock.lock()
          consumed += 1
          lock.unlock()
        }
      }
      precondition(consumed == 1)
    }

    let descriptor = open(directory.appendingPathComponent("test.lock").path, O_RDWR)
    precondition(descriptor >= 0)
    precondition(flock(descriptor, LOCK_EX) == 0)
    let child = Process()
    child.executableURL = URL(fileURLWithPath: CommandLine.arguments[0])
    child.arguments = [directory.path, "post"]
    try child.run()
    Thread.sleep(forTimeInterval: 0.1)
    precondition(child.isRunning)
    precondition(!FileManager.default.fileExists(atPath: directory.appendingPathComponent("test.plist").path))
    flock(descriptor, LOCK_UN)
    close(descriptor)
    child.waitUntilExit()
    precondition(child.terminationStatus == 0)
    precondition(mailbox.take()["action"] as? String == "snap-meal")
    precondition(mailbox.take().isEmpty)
    print("Launch mailbox: latest press, app isolation, concurrent takes and cross-process locking passed")
  }
}
