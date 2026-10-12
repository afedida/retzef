Retzef on Windows

1. Unzip this folder anywhere.
2. Double-click start-retzef.bat.
3. The editor opens at http://localhost:43123
4. Close the command window to stop the server.

Use Chrome or Edge. The first automatic captions download the Whisper model
(an internet connection is required that one time). Export needs the same browsers.

The launcher serves the built site with PowerShell, which is already on Windows.
It sends the file types the editor needs, including .wasm, .js, .mjs, .json,
and model files such as .onnx. If PowerShell cannot listen on the port, the
launcher tries `npx serve`, then Python.
