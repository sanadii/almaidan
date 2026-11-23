import { Prisma, PrismaClient } from '@prisma/client';
import type { MatchRecord } from '../gameplay/types';
import { assertLocalDevelopment } from './guard';
import type {FavoriteRecord} from '../favorites/service';
export interface OwnerState { favoriteCategories?: FavoriteRecord[]; favoriteReceipts?: Record<string,{categoryKey:string;wanted:boolean;active:boolean}>; matches: Record<string,MatchRecord>; starts: Record<string,{hash:string; id:string}>; logicalIds: Record<string,string>; commands: Record<string,{hash:string; sequence:number}> }
export const emptyOwnerState = (): OwnerState => ({matches:{},starts:{},logicalIds:{},commands:{}});
export interface LocalStore { transaction<T>(uid:string, work:(state:OwnerState)=>Promise<T>):Promise<T> }
export function createLocalStore() {
  const prisma = new PrismaClient({datasourceUrl:assertLocalDevelopment()});
  return {
    async initialize() {
      await prisma.$executeRawUnsafe('CREATE SCHEMA IF NOT EXISTS local_development');
      await prisma.$executeRawUnsafe('CREATE TABLE IF NOT EXISTS local_development.owner_state (uid text PRIMARY KEY, data jsonb NOT NULL)');
    },
    async transaction<T>(uid:string, work:(state:OwnerState)=>Promise<T>):Promise<T> {
      assertLocalDevelopment();
      return prisma.$transaction(async tx => {
        await tx.$executeRaw(Prisma.sql`INSERT INTO local_development.owner_state(uid,data) VALUES (${uid},${JSON.stringify(emptyOwnerState())}::jsonb) ON CONFLICT DO NOTHING`);
        const rows = await tx.$queryRaw<{data:OwnerState}[]>(Prisma.sql`SELECT data FROM local_development.owner_state WHERE uid=${uid} FOR UPDATE`);
        const before = JSON.stringify(rows[0].data);
        const result = await work(rows[0].data);
        const after = JSON.stringify(rows[0].data);
        if (after !== before) await tx.$executeRaw(Prisma.sql`UPDATE local_development.owner_state SET data=${after}::jsonb WHERE uid=${uid}`);
        return result;
      });
    },
    close:()=>prisma.$disconnect(),
  };
}
