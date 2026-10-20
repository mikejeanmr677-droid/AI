Set ws = CreateObject("WScript.Shell")
ws.CurrentDirectory = "E:\XKZOOM\LLMApiManageBalance"
ws.Run "cmd /c cd /d E:\XKZOOM\LLMApiManageBalance && D:\node\node.exe src\server.js", 0, False
