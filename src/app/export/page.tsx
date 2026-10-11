import { Page, PageHeader } from "@/components/page";
import { BackupCard } from "@/components/backup-card";

export default function BackupPage() {
  return (
    <Page>
      <PageHeader title="备份与迁移" description="把全部数据打包成一个 zip，换电脑或重装后导入，就能原样接上。" />
      <BackupCard />
    </Page>
  );
}
