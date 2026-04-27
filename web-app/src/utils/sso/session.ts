export const PRIVIDIUM_LOGOUT_EVENT = 'prividium:logout';

export function emitPrividiumLogoutEvent() {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new Event(PRIVIDIUM_LOGOUT_EVENT));
}
