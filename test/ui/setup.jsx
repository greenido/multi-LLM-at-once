import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';

// jsdom has <dialog> but not its modal methods.
HTMLDialogElement.prototype.showModal ??= function showModal() {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function close() {
  this.open = false;
};

// Nor ResizeObserver, which the growing textarea listens with.
globalThis.ResizeObserver ??= class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

Object.defineProperty(navigator, 'clipboard', {
  configurable: true,
  value: { writeText: vi.fn(() => Promise.resolve()) },
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  document.documentElement.classList.remove('dark');
  vi.unstubAllGlobals();
});
