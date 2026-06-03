// 浏览器操控工具：填表单、点按钮、浏览页面
// 安装：npm install playwright
// 默认控制电脑上已装的 Chrome（收藏夹/Cookie/登录状态都在）

let browser, context, page

async function ensureBrowser() {
  if (!browser) {
    const { chromium } = require('playwright')
    browser = await chromium.launch({
      channel: 'chrome',
      headless: false,
    })
    context = await browser.newContext()
    page = await context.newPage()
  }
  return page
}

async function navigate(url) {
  const p = await ensureBrowser()
  await p.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  return { title: await p.title(), url: p.url() }
}

async function fill(selector, value) {
  const p = await ensureBrowser()
  await p.fill(selector, value)
  return { success: true }
}

async function click(selector) {
  const p = await ensureBrowser()
  await p.click(selector)
  return { success: true }
}

async function screenshot() {
  const p = await ensureBrowser()
  return { path: await p.screenshot({ path: './screenshot.png' }) }
}

async function close() {
  if (browser) await browser.close()
  return { success: true }
}

module.exports = {
  navigate, fill, click, screenshot, close,
  name: 'browser',
  description: '操控浏览器：打开网页、填表单、点按钮、截图',
}
