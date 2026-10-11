/* 命令行重建索引：npm run reindex */
import { bootstrapVault } from "../src/lib/vault/bootstrap";
import { reindexAll, indexStatus } from "../src/lib/index/indexer";
import { embedPending, embedStatus } from "../src/lib/index/embed";

async function main() {
  await bootstrapVault();
  console.log("扫描 vault…", reindexAll());
  console.log("计算向量…");
  await embedPending(16, 10000);
  console.log("向量状态：", embedStatus());
  console.log("索引状态：", indexStatus());
}

main().catch((e) => { console.error(e); process.exit(1); });
