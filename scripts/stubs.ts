/**
 * MDX stub generator: content/plan.json -> src/content/articles/<cluster>/<slug>.mdx
 *
 *   pnpm plan                 # generate stubs for every "planned" item
 *   pnpm plan -- --limit 10   # only the first N (highest priority)
 *   pnpm plan -- --slug foo   # a single item
 *
 * Stubs are created with `draft: true`, a full frontmatter, an H2 outline matching the intent,
 * FAQ placeholders and the internal link targets. The body is for a human to write.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { ARTICLES_DIR, ROOT } from './lib/content-index';
import type { PlanItem } from './plan';

const PLAN = join(ROOT, 'content', 'plan.json');
const DEFAULT_AUTHOR = 'editorial-team';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : undefined;
}

function yamlStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

const OUTLINES: Record<PlanItem['intent'], string[]> = {
  'what-is': [
    'What {kw} means in plain English',
    'How it works',
    'Where you will see it in practice',
    'Common misconceptions',
    'How it relates to the rest of an IPTV setup',
    'Legal note',
  ],
  'how-to': [
    'Before you start',
    'Step 1: TODO',
    'Step 2: TODO',
    'Step 3: TODO',
    'Checking that it works',
    'Common errors and fixes',
    'Legal note',
  ],
  troubleshooting: [
    'What the symptom tells you',
    'Quick checks (2 minutes)',
    'Step-by-step diagnosis',
    'Fixes by cause',
    'When it is not fixable locally',
    'Legal note',
  ],
  comparison: [
    'Summary: which fits whom',
    'What we compared and how',
    'Feature by feature',
    'Costs (cite every figure)',
    'Verdict by use case',
    'Legal note',
  ],
  legal: [
    'The short answer',
    'What the law says (with citations)',
    'What this means for viewers',
    'How to recognise a licensed service',
    'Disclaimer',
  ],
};

function stubFor(item: PlanItem, today: string): string {
  const isHowTo = item.intent === 'how-to' || item.intent === 'troubleshooting';
  const outline = OUTLINES[item.intent].map((h) => h.replace('{kw}', item.targetKeyword));

  const fm = [
    '---',
    `title: ${yamlStr(item.title.slice(0, 60))}`,
    `description: ${yamlStr(`TODO: 120-155 character description for "${item.targetKeyword}".`.slice(0, 155))}`,
    `cluster: ${item.cluster}`,
    `targetKeyword: ${yamlStr(item.targetKeyword)}`,
    'secondaryKeywords:',
    ...(item.secondaryKeywords.length
      ? item.secondaryKeywords.map((k) => `  - ${yamlStr(k)}`)
      : ['  []']),
    `intent: ${item.intent}`,
    `geo: ${item.geo}`,
    `publishedAt: ${today}`,
    `author: ${DEFAULT_AUTHOR}`,
    'pillar: false',
    'draft: true',
    'keyTakeaways:',
    "  - 'TODO: takeaway 1'",
    "  - 'TODO: takeaway 2'",
    "  - 'TODO: takeaway 3'",
    'faq:',
    "  - question: 'TODO: question 1?'",
    "    answer: 'TODO: answer 1'",
    "  - question: 'TODO: question 2?'",
    "    answer: 'TODO: answer 2'",
    'related:',
    ...item.internalLinkTargets
      .filter((t) => t.split('/').filter(Boolean).length === 2)
      .map((t) => `  - ${t.replace(/^\/|\/$/g, '')}`),
  ];
  if (isHowTo) {
    fm.push(
      'howTo:',
      `  name: ${yamlStr(item.title.slice(0, 60))}`,
      "  totalTime: 'PT20M'",
      '  steps:',
      "    - name: 'TODO: step 1'",
      "      text: 'TODO: what to do'",
      "    - name: 'TODO: step 2'",
      "      text: 'TODO: what to do'",
    );
  }
  fm.push('---', '');

  const body = [
    `{/* TODO(human): write this article. Target keyword: "${item.targetKeyword}". Intent: ${item.intent}. Geo: ${item.geo}.`,
    `    Minimum 800 words (1800 if you mark it as pillar). Add original screenshots / tests and cite sources.`,
    `    Remove draft: true and every TODO before publishing; \`pnpm seo-check --strict\` enforces both. */}`,
    '',
    ...outline.flatMap((h) => [`## ${h}`, '', 'TODO', '']),
    '## Internal links to include',
    '',
    ...item.internalLinkTargets.map((t) => `- [TODO anchor text](${t})`),
    '',
  ];
  return fm.join('\n') + body.join('\n');
}

function main() {
  if (!existsSync(PLAN)) {
    console.error('content/plan.json not found. Run `pnpm plan:build` first.');
    process.exit(1);
  }
  const plan = JSON.parse(readFileSync(PLAN, 'utf8')) as { items: PlanItem[] };
  const limit = Number(arg('--limit') ?? Infinity);
  const only = arg('--slug');
  const today = new Date().toISOString().slice(0, 10);

  let created = 0;
  for (const item of plan.items) {
    if (item.status !== 'planned') continue;
    if (only && item.slug !== only) continue;
    if (created >= limit) break;
    const file = join(ARTICLES_DIR, item.cluster, `${item.slug}.mdx`);
    if (existsSync(file)) {
      item.status = 'stubbed';
      continue;
    }
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, stubFor(item, today));
    item.status = 'stubbed';
    created++;
    console.log(`+ ${relative(ROOT, file)}`);
  }
  writeFileSync(PLAN, JSON.stringify(plan, null, 2) + '\n');
  console.log(`${created} stub(s) created.`);
}

main();
