const { app, BrowserWindow, shell } = require('electron')
const { fork } = require('child_process')
const path = require('path')

let serverProcess = null
let mainWindow = null

function startServer() {
  return new Promise((resolve) => {
    serverProcess = fork(path.join(__dirname, 'app.js'), [], {
      stdio: 'ignore',
      env: { ...process.env, ELECTRON_WORKER: '1' },
    })
    serverProcess.on('message', (msg) => {
      if (msg === 'ready') resolve()
    })
    // fallback: wait and assume ready
    setTimeout(resolve, 3000)
  })
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    icon: path.join(__dirname, 'ziyouniao-icon.ico'),
    title: '自由鸟',
    webPreferences: {
      sandbox: true,
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  })

  mainWindow.loadURL('http://localhost:3456')

  mainWindow.once('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 外部链接用系统浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

app.whenReady().then(async () => {
  await startServer()
  createWindow()
})

app.on('window-all-closed', () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
  app.quit()
})

app.on('before-quit', () => {
  if (serverProcess) {
    serverProcess.kill()
    serverProcess = null
  }
})
