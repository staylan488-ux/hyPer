---
name: ship-ios
description: Build or validate hyPer's native iOS app, regenerate its app icon, or carry out a requested device or TestFlight release.
---

# hyPer iOS

The native app uses Capacitor with Swift Package Manager. Web changes reach
the installed app after a web build, Capacitor sync, and a native run or release.
Inspect the intended checkout; local validation does not require switching to main.

Read only the route needed for the task:

- [Native validation](references/native-validation.md): simulator/device builds,
  plugin or Live Activity changes, and app-icon export.
- [Release](references/release.md): a requested TestFlight upload or ship-pipeline
  change. The existing ship script builds remote main in an isolated clone.

Editing, auditing, building, and uploading are distinct operations. Carry out
external release actions only within the user's requested scope and existing
authorization; do not request approval again when it already covers the action.
