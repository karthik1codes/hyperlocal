/**
 * One-shot: node --import tsx scripts/probe-public-sdk.ts
 * Or: npx tsx --env-file=.env scripts/probe-public-sdk.ts
 */
import { probePublicSdk } from "../lib/bento/public-api";

async function main() {
  const report = await probePublicSdk();
  console.log(`\nbaseUrl: ${report.baseUrl}`);
  console.log(`ok: ${report.okCount}  fail: ${report.failCount}\n`);
  for (const row of report.rows) {
    const mark = row.ok ? "✓" : "✗";
    const extra = row.ok ? row.detail : row.error;
    console.log(`${mark} ${row.name} (${row.ms}ms) ${extra ?? ""}`);
  }
  process.exit(report.failCount > 0 && report.okCount === 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
