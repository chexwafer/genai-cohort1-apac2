import { signal } from '@angular/core';

const STORAGE_KEY = 'app.session';

export class SessionService {
  public readonly userId = signal<string | null>(null);
  public readonly sessionId = signal<string | null>(null);

  constructor() {
    this.load();
  }

  public generate() {
    const uid = this.randomId();
    const sid = this.randomId();
    this.userId.set(uid);
    this.sessionId.set(sid);
    this.save();
  }

  public clear() {
    this.userId.set(null);
    this.sessionId.set(null);
    localStorage.removeItem(STORAGE_KEY);
  }

  private save() {
    try {
      const payload = {
        userId: this.userId() ?? null,
        sessionId: this.sessionId() ?? null,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore storage errors
    }
  }

  private load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.userId) this.userId.set(parsed.userId);
      if (parsed?.sessionId) this.sessionId.set(parsed.sessionId);
    } catch {
      // ignore parse errors
    }
  }

  private randomId(): string {
    try {
      // browser crypto
      // @ts-ignore
      if (typeof crypto !== 'undefined' && typeof (crypto as any).randomUUID === 'function') {
        // @ts-ignore
        return (crypto as any).randomUUID();
      }
    } catch {}
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }
}

export const session = new SessionService();
