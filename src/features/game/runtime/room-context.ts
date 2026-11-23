import { createContext } from 'react';
import type { ClientRole } from './contracts.js';
import type { PgGameAdapter } from './pg-game-adapter.js';

/** Explicit injection only; null preserves all existing runtime defaults. */
export const PgRuntimeContext = createContext<PgGameAdapter | null>(null);

/** All fields are server-verified metadata; credentials are never persisted here. */
export interface PgRoomContext {
  backend: 'pg'; namespace: string; engine: 'huroof'; profile: string; locator: string;
  roomId: string; roomGeneration: string; principal: string;
  memberGeneration: string; role: ClientRole; view:'member'|'audience'; authEpoch: number; routeEpoch: number; viewEpoch:number;
}
export interface ContextTicket { authEpoch: number; routeEpoch: number; viewEpoch:number; view:'member'|'audience'; principal: string | null; locator: string | null }
/** Increment on every transition, including returning to an earlier value. */
export class RoomContextEpoch {
  private authEpoch = 0;
  private routeEpoch = 0;
  private viewEpoch = 0;
  private view:'member'|'audience' = 'member';
  private principal: string | null = null;
  private locator: string | null = null;
  changePrincipal(principal: string | null): void { this.principal = principal; this.authEpoch++; }
  changeRoute(locator: string | null): void { this.locator = locator; this.routeEpoch++; }
  changeView(view:'member'|'audience'):void { this.view=view; this.viewEpoch++; }
  ticket(): ContextTicket { return { authEpoch: this.authEpoch, routeEpoch: this.routeEpoch, viewEpoch:this.viewEpoch,view:this.view,principal: this.principal, locator: this.locator }; }
  current(ticket: ContextTicket): boolean { return ticket.authEpoch === this.authEpoch && ticket.routeEpoch === this.routeEpoch && ticket.viewEpoch===this.viewEpoch && ticket.view===this.view && ticket.principal === this.principal && ticket.locator === this.locator; }
  assertCurrent(ticket: ContextTicket): void { if (!this.current(ticket)) throw new Error('STALE_CONTEXT'); }
}
export function pgContextKey(context: PgRoomContext): string {
  return JSON.stringify([context.backend, context.namespace, context.engine, context.profile, context.locator, context.roomId, context.roomGeneration, context.principal, context.memberGeneration, context.role,context.view,context.authEpoch,context.routeEpoch,context.viewEpoch]);
}

