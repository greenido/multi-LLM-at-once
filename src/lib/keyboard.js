/**
 * Whether a keydown in a prompt box should send it: Enter on its own.
 *
 * Shift+Enter is a new line. So is an Enter that confirms an IME candidate —
 * someone typing Japanese, Chinese or Korean presses Enter to pick the word,
 * and sending on that would fire the question half-typed. Browsers flag that
 * key as composing; Safari reports it with isComposing false but the legacy
 * keyCode 229, so both are checked.
 */
export function isSubmitKey(event) {
  const composing = event.nativeEvent?.isComposing ?? event.isComposing;
  return event.key === 'Enter' && !event.shiftKey && !composing && event.keyCode !== 229;
}
