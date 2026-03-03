import { getUncachableGitHubClient, getAccessToken } from "../server/github";
import fs from "fs";
import path from "path";

const REPO_NAME = "nexuscomm";
const REPO_DESC = "NexusComm — private enterprise communication platform with real-time messaging, video calling, file sharing, Telegram monitor, and PWA support";

const IGNORE = new Set([
  "node_modules", ".git", "dist", "uploads", ".cache",
  ".local", ".config", "*.log", "__pycache__", ".env"
]);

const IGNORE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".ico", ".webp",
  ".mp4", ".mp3", ".wav", ".woff", ".woff2", ".ttf", ".eot"
]);

function shouldIgnore(p: string): boolean {
  const parts = p.split(path.sep);
  return parts.some(part => IGNORE.has(part) || part.startsWith(".local"));
}

function collectFiles(dir: string, base = ""): { path: string; absPath: string }[] {
  const results: { path: string; absPath: string }[] = [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return results; }

  for (const entry of entries) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);

    if (IGNORE.has(entry.name) || entry.name.startsWith(".local")) continue;

    if (entry.isDirectory()) {
      results.push(...collectFiles(abs, rel));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!IGNORE_EXTENSIONS.has(ext)) {
        // Skip files > 1MB
        try {
          const stat = fs.statSync(abs);
          if (stat.size < 1_000_000) results.push({ path: rel, absPath: abs });
        } catch { /* skip */ }
      }
    }
  }
  return results;
}

async function run() {
  const octokit = await getUncachableGitHubClient();
  const token = await getAccessToken();

  // Get authenticated user
  const { data: user } = await octokit.users.getAuthenticated();
  console.log(`Authenticated as: ${user.login}`);

  // Create or verify repo exists
  let repoExists = false;
  let isEmpty = false;
  try {
    const { data: repoData } = await octokit.repos.get({ owner: user.login, repo: REPO_NAME });
    repoExists = true;
    isEmpty = !repoData.default_branch || repoData.size === 0;
    console.log(`Repo ${user.login}/${REPO_NAME} exists (empty=${isEmpty}) — will update.`);
  } catch {
    console.log(`Creating repo: ${REPO_NAME}...`);
    await octokit.repos.createForAuthenticatedUser({
      name: REPO_NAME,
      description: REPO_DESC,
      private: true,
      auto_init: false,
    });
    repoExists = false;
    isEmpty = true;
    console.log(`Repo created: https://github.com/${user.login}/${REPO_NAME}`);
  }

  // If repo is empty, initialize it with a README so the git API works
  if (isEmpty) {
    console.log("Initializing empty repo with README...");
    await octokit.repos.createOrUpdateFileContents({
      owner: user.login,
      repo: REPO_NAME,
      path: "README.md",
      message: "Initialize repository",
      content: Buffer.from(`# NexusComm\n\n${REPO_DESC}\n`).toString("base64"),
    });
    // Small delay to let GitHub process the init
    await new Promise(r => setTimeout(r, 2000));
  }

  // Collect all project files
  const root = process.cwd();
  const files = collectFiles(root);
  console.log(`Found ${files.length} files to push...`);

  // Create blobs for each file
  const treeItems: { path: string; mode: "100644"; type: "blob"; sha: string }[] = [];
  let done = 0;

  for (const file of files) {
    try {
      const content = fs.readFileSync(file.absPath);
      const { data: blob } = await octokit.git.createBlob({
        owner: user.login,
        repo: REPO_NAME,
        content: content.toString("base64"),
        encoding: "base64",
      });
      treeItems.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
      done++;
      if (done % 20 === 0) console.log(`  ${done}/${files.length} files...`);
    } catch (err: any) {
      console.warn(`  Skipping ${file.path}: ${err.message}`);
    }
  }

  console.log(`Created ${treeItems.length} blobs. Building tree...`);

  // Get current default branch SHA (try main, then master)
  let baseSha: string | undefined;
  let defaultBranch = "main";
  for (const branch of ["main", "master"]) {
    try {
      const { data: ref } = await octokit.git.getRef({
        owner: user.login,
        repo: REPO_NAME,
        ref: `heads/${branch}`,
      });
      baseSha = ref.object.sha;
      defaultBranch = branch;
      console.log(`Base branch: ${branch} @ ${baseSha}`);
      break;
    } catch { /* try next */ }
  }

  // Create tree
  const { data: tree } = await octokit.git.createTree({
    owner: user.login,
    repo: REPO_NAME,
    tree: treeItems,
    ...(baseSha ? { base_tree: baseSha } : {}),
  });
  console.log(`Tree created: ${tree.sha}`);

  // Create commit
  const { data: commit } = await octokit.git.createCommit({
    owner: user.login,
    repo: REPO_NAME,
    message: (repoExists && !isEmpty) ? "Update: NexusComm latest" : "Initial commit: NexusComm",
    tree: tree.sha,
    ...(baseSha ? { parents: [baseSha] } : { parents: [] }),
  });
  console.log(`Commit created: ${commit.sha}`);

  // Update or create the branch reference
  if (baseSha) {
    await octokit.git.updateRef({
      owner: user.login,
      repo: REPO_NAME,
      ref: `heads/${defaultBranch}`,
      sha: commit.sha,
      force: true,
    });
  } else {
    await octokit.git.createRef({
      owner: user.login,
      repo: REPO_NAME,
      ref: "refs/heads/main",
      sha: commit.sha,
    });
  }

  console.log(`\n✅ Done! Pushed ${treeItems.length} files.`);
  console.log(`🔗 https://github.com/${user.login}/${REPO_NAME}`);
}

run().catch(err => { console.error("Push failed:", err.message); process.exit(1); });
