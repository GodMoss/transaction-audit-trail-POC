const fs = require('fs');
const path = require('path');

const WATERMARK_PATH = path.join(__dirname, '..', 'state', 'header-rules-watermark.json');
const RULES_LIST_URL = 'https://es-test.test.logik.io/api/txn-header/v2/blueprints/default/rules?page=0&size=100&sort=modified%2CDESC';

async function main() {
  const apiKey = process.env.LOGIK_ADMIN_API_KEY;

  const watermarkState = JSON.parse(fs.readFileSync(WATERMARK_PATH, 'utf8'));
  const lastWatermark = new Date(watermarkState.lastModified);
  console.log('Current watermark:', lastWatermark.toISOString());

  const response = await fetch(RULES_LIST_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Rules list fetch failed: ${response.status}`);
  }

  const data = await response.json();
  const rules = data.content || [];

  const changed = [];
  for (const rule of rules) {
    const modified = new Date(rule.modified);
    if (modified <= lastWatermark) {
      // List is sorted DESC by modified - once we hit one this old, everything after is too.
      break;
    }
    changed.push(rule);
  }

  console.log(`Found ${changed.length} changed/new rule(s) since last watermark:`);
  changed.forEach(r => console.log(` - ${r.variableName} (modified ${r.modified}, by ${r.lastModifiedBy})`));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
