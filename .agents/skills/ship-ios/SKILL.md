---
name: ship-ios
description: Build or validate hyPer's native iOS app, update its app icon, or carry out a requested device or TestFlight release.
---

# hyPer iOS

The app is the React Native app in `native/`, released as `app.hyper.mobile`.
Its screens, simulator checks and phone installs follow the
[blanc-native skill](../blanc-native/SKILL.md).
Inspect the intended checkout; local validation does not require switching to main.

Read only the route needed for the task:

- [Native validation](references/native-validation.md): prebuilds, native module,
  widget or Live Activity changes, device-only checks, and the app icon.
- [Release](references/release.md): a requested TestFlight upload or ship-pipeline
  change. The existing ship script builds remote main in an isolated clone.

Editing, auditing, building, and uploading are distinct operations. Carry out
external release actions only within the user's requested scope and existing
authorization; do not request approval again when it already covers the action.
