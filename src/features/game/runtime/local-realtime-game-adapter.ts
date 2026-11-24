import {parseHuroofRematchResult} from '../huroof-rematch-client';
import { authenticateYouTubeMedia, youtubeEmbedUrl, YOUTUBE_MEDIA_CONTENT_TYPE } from './youtube-media';
import { CLIENT_CHALLENGE_CAPABILITY, type ChallengeMechanic, type ClientRole, type CreateRoomRequest, type GameIntent, type GameRuntimeAdapter, type JoinRoomRequest, type ProjectionEnvelope } from './contracts';

export class LocalRoomCreationFailure extends Error {
  readonly definitive:boolean;
  constructor(readonly status:number,readonly code:string){super(code);this.name='LocalRoomCreationFailure';this.definitive=status===400&&code==='LOCAL_CREATE_REQUEST_INVALID'||status===422&&code==='LOCAL_CREATE_SETUP_UNAVAILABLE';}
}
/** Default adapter; the Node service validates its capability token on every request. */
export class LocalRealtimeGameAdapter implements GameRuntimeAdapter {
  readonly kind = 'local' as const;
  private token = '';
  setCapabilityToken(token: string) { this.token = token; }
  async createRoom(request: CreateRoomRequest, authority?: { idToken: string; assertCurrent?: () => void }) { authority?.assertCurrent?.(); const response = await fetch('/api/rooms', { method: 'POST', headers: { 'content-type': 'application/json', ...(authority ? { authorization: `Bearer ${authority.idToken}` } : {}) }, body: JSON.stringify(request) }); if (!response.ok) {let code='LOCAL_CREATE_UNAVAILABLE';try{const data=await response.json();if(typeof data.error==='string'&&/^[A-Z0-9_]{1,100}$/.test(data.error))code=data.error;}catch{/* non-JSON error body: keep the generic code */}throw new LocalRoomCreationFailure(response.status,code);} const value = await response.json(); authority?.assertCurrent?.(); this.token = value.token; return value; }
  async rematchRoom(predecessorRoomId:string,requestKey:string,authority:{idToken:string;hostCapability?:string;assertCurrent?:()=>void}){
    authority.assertCurrent?.();const response=await fetch(`/api/rooms/${encodeURIComponent(predecessorRoomId)}/rematch`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${authority.idToken}`,'x-almaidan-host-capability':authority.hostCapability??this.token},body:JSON.stringify({requestKey})});
    if(!response.ok){let code='LOCAL_CREATE_UNAVAILABLE';try{const data=await response.json();if(typeof data.error==='string'&&/^[A-Z0-9_]{1,100}$/.test(data.error))code=data.error;}catch{/* non-JSON error body: keep the generic code */}throw new LocalRoomCreationFailure(response.status,code);}
    const value=await response.json();authority.assertCurrent?.();try{parseHuroofRematchResult(value,predecessorRoomId);}catch{throw new LocalRoomCreationFailure(503,'LOCAL_CREATE_UNAVAILABLE');}this.token=value.token;return value;
  }
  async getChallengeAvailability() { const response = await fetch('/api/challenge-availability', { cache: 'no-store' }); if (!response.ok) throw new Error(await response.text()); return response.json() as Promise<{ enabledMechanics: ChallengeMechanic[] }>; }
  async joinRoom(request: JoinRoomRequest) { const response = await fetch(`/api/rooms/${encodeURIComponent(request.roomCode)}/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...request, challenge: request.challenge ?? CLIENT_CHALLENGE_CAPABILITY }) }); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); this.token = value.token; return value; }
  async joinAudience(roomCode: string, challenge = CLIENT_CHALLENGE_CAPABILITY) { const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/audience`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ challenge }) }); if (!response.ok) throw new Error(await response.text()); const value = await response.json(); this.token = value.token; return value; }
  async resumeRoom(roomId: string, challenge = CLIENT_CHALLENGE_CAPABILITY) { const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/resume`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify({ challenge }) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
  async submitGameIntent(roomId: string, intent: GameIntent) { const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/intents`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify(intent) }); if (!response.ok) throw new Error(await response.text()); return response.json(); }
  async getCurrentQuestionMedia(request: { roomId: string; mediaId: string; assetSha256: string }) {
    const issued = await fetch(`/api/rooms/${encodeURIComponent(request.roomId)}/current-question-media`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` }, body: JSON.stringify({ mediaId: request.mediaId, assetSha256: request.assetSha256 }) });
    if (!issued.ok) throw new Error(await issued.text());
    const ticket = await issued.json() as { ticket?: unknown; expiresAt?: unknown };
    if (typeof ticket.ticket !== 'string' || typeof ticket.expiresAt !== 'string') throw new Error('MEDIA_UNAVAILABLE');
    const response = await fetch(`/api/question-media/${encodeURIComponent(ticket.ticket)}`, { headers: { authorization: `Bearer ${this.token}` }, cache: 'no-store' });
    if (!response.ok) throw new Error(await response.text());
    if (response.headers.get('content-type')?.split(';')[0] === YOUTUBE_MEDIA_CONTENT_TYPE) {
      const youtube = await authenticateYouTubeMedia(await response.json(), request.assetSha256);
      return { mediaId: request.mediaId, assetSha256: request.assetSha256, url: youtubeEmbedUrl(youtube), youtube, expiresAt: ticket.expiresAt };
    }
    const blob = await response.blob();
    if (!['image/png', 'image/jpeg', 'video/mp4'].includes(blob.type)) throw new Error('MEDIA_INVALID_TYPE');
    return { mediaId: request.mediaId, assetSha256: request.assetSha256, url: URL.createObjectURL(blob), expiresAt: ticket.expiresAt };
  }
  subscribeProjection(roomId: string, _role: ClientRole, _uid: string, onProjection: (value: ProjectionEnvelope) => void) { const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'; const socket = new WebSocket(`${protocol}//${location.host}/ws?roomId=${encodeURIComponent(roomId)}&token=${encodeURIComponent(this.token)}&challenge=${encodeURIComponent(JSON.stringify(CLIENT_CHALLENGE_CAPABILITY))}`); socket.addEventListener('message', (event) => onProjection(JSON.parse(String(event.data)) as ProjectionEnvelope)); return () => socket.close(); }
}
