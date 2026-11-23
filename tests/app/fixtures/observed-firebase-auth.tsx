import { type ReactNode,useLayoutEffect,useRef } from 'react';
import { FirebaseAuthContext,type FirebaseAuthContextValue } from '../../../src/features/auth/auth-context';
import { beginOwnerProvider,observeProviderOwner,invalidateProviderOwner,endOwnerProvider,type ProviderLease } from '../../../src/features/enta/auth-epoch';
import { renderHook,type RenderHookOptions } from '@testing-library/react';
import type { User } from 'firebase/auth';
/** Context-based view fixtures still need the authority observation supplied
 * by the real AuthProvider. This scoped adapter models published test users;
 * actual provider/batched transition behavior has separate mounted tests. */
export function ObservedFirebaseAuthProvider({value,children}:{value:FirebaseAuthContextValue;children:ReactNode}) {
  const active=useRef<ProviderLease|null>(null);
  useLayoutEffect(()=>{const lease=beginOwnerProvider();active.current=lease;return()=>{if(active.current===lease)active.current=null;endOwnerProvider(lease);};},[]);
  useLayoutEffect(()=>{const lease=active.current;if(!lease)return;if(!value.isAvailable||value.status==='loading'||value.status==='unavailable'||value.status==='error')invalidateProviderOwner(lease);else observeProviderOwner(lease,value.user?.uid??null);},[value.user,value.status,value.isAvailable]);
  return <FirebaseAuthContext.Provider value={value}>{children}</FirebaseAuthContext.Provider>;
}
/** Hooks receiving a User directly have no context/provider in the legacy
 * fixture. Observe that explicit actor with a mounted scoped layout lifecycle
 * before its passive transport effects; rerenders publish the new actor. */
export function renderObservedOwnerHook<Result,Props>(owner:User|((props:Props)=>User|null),callback:(props:Props)=>Result,options?:RenderHookOptions<Props>) {
  return renderHook((props:Props)=>{
    const actor=typeof owner==='function'?owner(props):owner;
    const active=useRef<ProviderLease|null>(null);
    useLayoutEffect(()=>{const lease=beginOwnerProvider();active.current=lease;return()=>{if(active.current===lease)active.current=null;endOwnerProvider(lease);};},[]);
    useLayoutEffect(()=>{if(active.current)observeProviderOwner(active.current,actor?.uid??null);},[actor]);
    return callback(props);
  },options);
}
