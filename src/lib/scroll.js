/**
 * Whether a scroll container is close enough to its bottom to count as
 * following along.
 *
 * A streaming panel should chase its own output, but only while the user is
 * actually at the bottom — someone who scrolled up to re-read an earlier
 * answer should not have it yanked away every 60ms.
 *
 * The slack matters: browsers report fractional scroll positions on zoomed or
 * high-DPI displays, so an exact comparison is never true, and a user within a
 * line of the bottom means to be following.
 */
export const STICK_SLACK_PX = 24;

export function isAtBottom({ scrollTop, scrollHeight, clientHeight }, slack = STICK_SLACK_PX) {
  return scrollHeight - scrollTop - clientHeight <= slack;
}
