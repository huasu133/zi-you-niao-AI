Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "F:\ziyouniao"

' 启动 node 服务器
WshShell.Run "cmd /c cd /d F:\ziyouniao && node app.js", 0, False

' 等服务器就绪
WScript.Sleep 3000

' 打开 Edge 独立窗口
WshShell.Run """C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"" --app=http://localhost:3456 --window-size=1100,750", 1, False
