import { EventEmitter } from "node:events";

export interface WrittenEvent { path: string; reason: string; actor: "user" | "agent" | "system" }

const g = globalThis as unknown as { __lifeosVaultEvents?: EventEmitter };
/** vault 写入事件总线：索引器订阅它（开发热更新时保持单例） */
export const vaultEvents: EventEmitter = g.__lifeosVaultEvents ?? (g.__lifeosVaultEvents = new EventEmitter());
vaultEvents.setMaxListeners(50);
