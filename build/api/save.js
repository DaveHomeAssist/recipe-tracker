// POST /api/save  { recipes: [...] }  →  { ok, commit }
//
// Commits the provided recipes array to public/recipes.json in the GitHub repo.
// Uses the GitHub Contents API with a fine-grained PAT stored in env.
//
// Env vars (all required):
//   GITHUB_TOKEN       fine-grained PAT with "Contents: read+write" on this repo only
//   GITHUB_REPO        owner/name, e.g. "dave/recipe-tracker"
//   GITHUB_BRANCH      branch to commit to (default "main")
//   GITHUB_FILE_PATH   path within the repo (default "public/recipes.json")
//   ALLOW_ORIGIN       origin allowed by CORS (default "*")
//   SHARED_SECRET      optional — if set, the frontend must send X-Recipe-Secret
//
// Safety:
//   - Validates that the payload is a non-empty array of plain objects.
//   - Rejects payloads over 2 MB.
//   - Uses the "If-Match"-style `sha` optimistic-concurrency field — we fetch
//     the current file sha first, then send it with the PUT so GitHub rejects
//     concurrent overwrites.

const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || '*';
const BRANCH       = process.env.GITHUB_BRANCH || 'main';
const FILE_PATH    = process.env.GITHUB_FILE_PATH || 'public/recipes.json';
const MAX_BYTES    = 2 * 1024 * 1024;

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Recipe-Secret');
}

function ghHeaders() {
  return {
    'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'recipe-tracker-saver',
  };
}

async function getCurrentSha(repo) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(FILE_PATH)}?ref=${encodeURIComponent(BRANCH)}`;
  const res = await fetch(url, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET contents failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return data.sha || null;
}

async function putContents(repo, sha, contentBase64, message) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(FILE_PATH)}`;
  const body = {
    message,
    content: contentBase64,
    branch: BRANCH,
  };
  if (sha) body.sha = sha;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { ...ghHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT contents failed: ${res.status} ${await res.text()}`);
  return res.json();
}

module.exports = async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  if (!process.env.GITHUB_TOKEN || !process.env.GITHUB_REPO) {
    return res.status(500).json({ error: 'Server not configured: missing GITHUB_TOKEN or GITHUB_REPO' });
  }
  if (process.env.SHARED_SECRET && req.headers['x-recipe-secret'] !== process.env.SHARED_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
  const recipes = body && body.recipes;
  if (!Array.isArray(recipes) || recipes.length === 0) {
    return res.status(400).json({ error: 'Expected { recipes: [...] } non-empty array' });
  }
  for (const r of recipes) {
    if (r === null || typeof r !== 'object' || Array.isArray(r)) {
      return res.status(400).json({ error: 'Every recipe must be a plain object' });
    }
  }

  const json = JSON.stringify(recipes, null, 2) + '\n';
  if (Buffer.byteLength(json, 'utf8') > MAX_BYTES) {
    return res.status(413).json({ error: 'Payload too large' });
  }
  const content64 = Buffer.from(json, 'utf8').toString('base64');

  try {
    const sha = await getCurrentSha(process.env.GITHUB_REPO);
    const commit = await putContents(
      process.env.GITHUB_REPO,
      sha,
      content64,
      `Update recipes.json (${recipes.length} recipes)`
    );
    return res.status(200).json({
      ok: true,
      count: recipes.length,
      commit: commit.commit && commit.commit.sha,
      url: commit.content && commit.content.html_url,
    });
  } catch (e) {
    return res.status(502).json({ error: String(e.message || e) });
  }
};
