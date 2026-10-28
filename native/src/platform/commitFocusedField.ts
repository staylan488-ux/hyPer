// Replaces ../src/lib/commitFocusedField.ts (see metro.config.js), which uses
// react-dom and the DOM's focused element.
//
// Blurs the focused text input so its commit-on-blur runs. Unlike the web
// version this is not synchronous: the blur arrives as a native event, so
// native screens commit typed values as they change rather than relying on it.
import { TextInput } from 'react-native';

export function commitFocusedField(): void {
  const focused = TextInput.State.currentlyFocusedInput();
  if (focused) TextInput.State.blurTextInput(focused);
}
