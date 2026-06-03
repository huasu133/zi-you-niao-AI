const GITHUB_TOKEN = process.env.GITHUB_TOKEN
const API = 'https://api.github.com'

async function githubRequest(endpoint, method = 'GET', body = null) {
  if (!GITHUB_TOKEN) return { error: '未配置 GitHub Token，请在 .env 中添加 GITHUB_TOKEN' }
  try {
    const res = await fetch(`${API}${endpoint}`, {
      method,
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Cyber-Claw',
      },
      body: body ? JSON.stringify(body) : null,
    })
    return await res.json()
  } catch (e) {
    return { error: `GitHub API 请求失败: ${e.message}` }
  }
}

module.exports = {
  listRepos: async (username) => ({ repos: await githubRequest(`/users/${username}/repos`) }),
  getFile: async (repo, filepath) => ({ content: await githubRequest(`/repos/${repo}/contents/${filepath}`) }),
  listIssues: async (repo) => ({ issues: await githubRequest(`/repos/${repo}/issues`) }),
  createIssue: async (repo, title, body) => ({ issue: await githubRequest(`/repos/${repo}/issues`, 'POST', { title, body }) }),
  searchCode: async (query) => ({ results: await githubRequest(`/search/code?q=${encodeURIComponent(query)}`) }),
  name: 'github',
  description: 'GitHub 仓库管理',
}
