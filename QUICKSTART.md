# Quick Start Guide - Neon Playbook VS Code Extension

## Setup

1. **Install Dependencies**
   ```powershell
   cd neon-playbook-vscode
   npm install
   ```

2. **Compile the Extension**
   ```powershell
   npm run compile
   ```

3. **Run in Development**
   - Open the `neon-playbook-vscode` folder in VS Code
   - Press `F5` to launch a new VS Code window with the extension loaded
   - The extension will be available in the new window

## Try It Out

1. **Open the Example File**
   - In the Extension Development Host window, open `examples/example.http`
   - You'll see syntax highlighting for HTTP requests

2. **Run All Requests**
   - Press `Ctrl+Shift+R` (Windows/Linux) or `Cmd+Shift+R` (Mac)
   - Or click the "Play" button in the editor toolbar
   - The HTTP Results panel will open showing the results

3. **Run a Single Request**
   - Place your cursor inside any request block (after a `###` line)
   - Press `Ctrl+Alt+R` (Windows/Linux) or `Cmd+Alt+R` (Mac)
   - Or right-click and select "Neon Playbook: Run Current Request"

## Create Your Own Runbook

1. **Create a New File**
   - Create a file with `.http` or `.rest` extension
   - Example: `my-api-test.http`

2. **Write Your First Request**
   ```http
   @baseUrl = https://jsonplaceholder.typicode.com
   
   ### Get Posts
   GET {{baseUrl}}/posts
   Accept: application/json
   ```

3. **Add Variable Capture**
   ```http
   ### Get First Post
   GET {{baseUrl}}/posts/1
   Accept: application/json
   
   @postTitle = res.data.title
   > debug(@postTitle)
   ```

4. **Chain Requests**
   ```http
   ### Create Post
   POST {{baseUrl}}/posts
   Content-Type: application/json
   
   {
     "title": "My Post",
     "body": "Content here",
     "userId": 1
   }
   
   @newId = res.data.id
   
   ### Get Created Post
   GET {{baseUrl}}/posts/{{newId}}
   ```

## Building for Distribution

1. **Install VSCE (VS Code Extension CLI)**
   ```powershell
   npm install -g @vscode/vsce
   ```

2. **Package the Extension**
   ```powershell
   vsce package
   ```
   This creates a `.vsix` file

3. **Install the Package**
   - In VS Code, go to Extensions view (`Ctrl+Shift+X`)
   - Click the `...` menu (top right)
   - Select "Install from VSIX..."
   - Choose your `.vsix` file

## Development Tips

- **Watch Mode**: Run `npm run watch` to automatically recompile on changes
- **Debugging**: Use the Debug view in VS Code and select "Run Extension"
- **Reload**: In the Extension Development Host, press `Ctrl+R` to reload after changes

## Configuration

Set preferences in your VS Code settings:

```json
{
  "neonPlaybook.timeout": 30000,
  "neonPlaybook.followRedirects": true,
  "neonPlaybook.validateSSL": true
}
```

## Folder Structure

```
neon-playbook-vscode/
├── src/
│   ├── extension.ts       # Main extension entry point
│   ├── parser.ts          # HTTP runbook parser
│   ├── requester.ts       # HTTP request executor
│   └── resultsPanel.ts    # Webview panel for results
├── syntaxes/
│   └── http.tmLanguage.json  # Syntax highlighting
├── examples/
│   └── example.http       # Example runbook
├── package.json           # Extension manifest
├── tsconfig.json          # TypeScript config
└── README.md              # Documentation
```

## Next Steps

- Explore the [README.md](README.md) for full documentation
- Check out [CHANGELOG.md](CHANGELOG.md) for version history
- Review the example files in `examples/`
- Read the original Electron app docs at `../docs/flowhttp-plan.md`

## Troubleshooting

**Extension not activating?**
- Check that you're opening a `.http` or `.rest` file
- Look for errors in the Debug Console (Help > Toggle Developer Tools)

**Requests failing?**
- Check your internet connection
- Verify the URL is correct
- Check SSL validation settings if using self-signed certificates

**Changes not appearing?**
- Make sure you ran `npm run compile`
- Reload the Extension Development Host window (`Ctrl+R`)
