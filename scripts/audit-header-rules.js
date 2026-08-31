const fs = require('fs');
const path = require('path');

const WATERMARK_PATH = path.join(__dirname, '..', 'state', 'header-rules-watermark.json');
const RULES_DIR = path.join(__dirname, '..', 'rules');
const RULES_LIST_URL = 'https://es-test.test.logik.io/api/txn-header/v2/blueprints/default/rules?page=0&size=100&sort=modified%2CDESC';
const RULE_DETAIL_URL = (variableName) => `https://es-test.test.logik.io/api/txn-header/v3/rules/${variableName}`;
const SCRIPT_URL = (scriptId) => `https://es-test.test.logik.io/api/admin/v1/scripts/${scriptId}`;

async function attachScriptContent(rule, authHeaders) {
  const scriptIds = new Set();
  if (rule.condition && rule.condition.scriptId) scriptIds.add(rule.condition.scriptId);
  (rule.actions || []).forEach(a => { if (a.scriptId) scriptIds.add(a.scriptId); });

  if (scriptIds.size === 0) return;

  const scriptContents = {};
  for (const scriptId of scriptIds) {
    const res = await fetch(SCRIPT_URL(scriptId), { headers: authHeaders });
    if (!res.ok) {
      console.error(`  Failed to fetch script ${scriptId}: ${res.status}`);
      continue;
    }
    const scriptData = await res.json();
    scriptContents[scriptId] = scriptData.content || '';
  }

  if (rule.condition && rule.condition.scriptId) {
    rule.condition.scriptContent = scriptContents[rule.condition.scriptId];
  }
  (rule.actions || []).forEach(a => {
    if (a.scriptId) {
      a.scriptContent = scriptContents[a.scriptId];
    }
  });
}


async function main() {
  const apiKey = process.env.LOGIK_ADMIN_API_KEY;
  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };

  const watermarkState = JSON.parse(fs.readFileSync(WATERMARK_PATH, 'utf8'));
  const lastWatermark = new Date(watermarkState.lastModified);
  console.log('Current watermark:', lastWatermark.toISOString());

  const listResponse = await fetch(RULES_LIST_URL, { headers: authHeaders });
  if (!listResponse.ok) {
    throw new Error(`Rules list fetch failed: ${listResponse.status}`);
  }
  const listData = await listResponse.json();
  const rules = listData.content || [];

  const changed = [];
  for (const rule of rules) {
    const modified = new Date(rule.modified);
    if (modified <= lastWatermark) {
      break;
    }
    changed.push(rule);
  }

  console.log(`Found ${changed.length} changed/new rule(s) since last watermark.`);

  fs.mkdirSync(RULES_DIR, { recursive: true });

  for (const rule of changed) {
    const detailResponse = await fetch(RULE_DETAIL_URL(rule.variableName), { headers: authHeaders });
    if (!detailResponse.ok) {
      console.error(`  Failed to fetch detail for ${rule.variableName}: ${detailResponse.status}`);
      continue;
    }
    const detail = await detailResponse.json();
    await attachScriptContent(detail, authHeaders);

    const filePath = path.join(RULES_DIR, `${rule.variableName}.json`);
    fs.writeFileSync(filePath, JSON.stringify(detail, null, 2) + '\n');
    console.log(` - wrote ${filePath} (modified ${rule.modified}, by ${rule.lastModifiedBy})`);
  }
  
  const commitMessagePath = path.join(__dirname, '..', 'commit-message.txt');
  if (changed.length > 0) {
    const lines = [`Update ${changed.length} header rule(s)`, ''];
    changed.forEach(r => {
      lines.push(`- ${r.variableName} modified by ${r.lastModifiedBy} at ${r.modified}`);
    });
    fs.writeFileSync(commitMessagePath, lines.join('\n') + '\n');
  }

  if (rules.length > 0) {
    const newWatermark = rules[0].modified; // list is DESC-sorted, so this is the newest
    fs.writeFileSync(WATERMARK_PATH, JSON.stringify({ lastModified: newWatermark }, null, 2) + '\n');
    console.log('Updated watermark to:', newWatermark);
  } else {
    console.log('No rules returned - watermark left unchanged.');
  }

}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
