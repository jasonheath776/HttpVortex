# HTTP Vortex for VS Code

A text-first HTTP runbook editor for Visual Studio Code. Write HTTP requests in a simple, readable format, execute them sequentially, and pass data between requests using variables.

[![GitHub](https://img.shields.io/badge/GitHub-HttpVortex-blue?logo=github)](https://github.com/jasonheath776/HttpVortex)

## Features

- **Text-First Editing**: Write HTTP requests in plain text with syntax highlighting
- **Sequential Execution**: Requests run in order, allowing you to chain dependent calls
- **Variable Interpolation**: Capture values from responses and use them in subsequent requests
- **Variable Management**: Define global variables and extract values from responses
- **Parallel Execution**: Toggle parallel mode to run all requests concurrently
- **Debug Support**: Use `> debug(@varName)` or `> debug(res.data.field)` to inspect values
- **Code Generation**: Generate C#, JavaScript, or Java code from your requests
- **Postman Integration**: Import and export Postman collections
- **Environment Support**: Load and switch between `.env` environment files
- **Auth Profiles**: Create and reuse authentication profiles
- **Request History**: View and replay previous requests
- **Clean UI**: Results displayed in a dedicated panel with collapsible sections

## Syntax

The extension supports the `.http` and `.rest` file extensions and uses a syntax compatible with VS Code REST Client:

```http
# Global variables
@baseUrl = https://api.example.com
@apiKey = your-api-key

### Login
POST {{baseUrl}}/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "secret"
}

# Capture the auth token from the response
@authToken = res.data.token

### Get User Profile
GET {{baseUrl}}/user/profile
Authorization: Bearer {{authToken}}
Accept: application/json

### Update Profile
PATCH {{baseUrl}}/user/profile
Authorization: Bearer {{authToken}}
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com"
}
```

### Syntax Reference

| Syntax | Purpose |
|--------|---------|
| `@key = value` | Declare a variable with a static value |
| `{{key}}` | Inject a variable into URL, header, or body |
| `### Name` | Separator between request blocks |
| `@key = res.data.path` | Capture a value from the response |
| `> debug(expr)` | Debug a variable or response value |
| `#` | Comment line |
| `\` | Line continuation character |

## Usage

### Run All Requests

1. Open an `.http` or `.rest` file
2. Press `Ctrl+Shift+R` (or `Cmd+Shift+R` on Mac)
3. Or click the "Run All" button in the editor toolbar
4. Results appear in the "HTTP Results" panel

### Run Current Request

1. Place your cursor inside a request block
2. Press `Ctrl+Alt+R` (or `Cmd+Alt+R` on Mac)
3. Or right-click and select "HTTP Vortex: Run Current Request"

### View Results

- Click on any result card to expand/collapse details
- Copy response bodies to clipboard with the "Copy" button
- See captured variables and debug output inline

## Commands

- **Run All Requests** (`Ctrl+Shift+R` / `Cmd+Shift+R`): Execute all requests in the file sequentially
- **Run Current Request** (`Ctrl+Alt+R` / `Cmd+Alt+R`): Execute the request at cursor position  
- **Run All from Here**: Execute all requests starting from the current one (via CodeLens)
- **Show Results Panel**: Open the results panel
- **Clear Variables**: Reset all runtime variables
- **Export to Postman Collection**: Export requests to a Postman collection file
- **Import from Postman Collection**: Import a Postman collection into .http format
- **Generate Markdown Report** (`Ctrl+Shift+M` / `Cmd+Shift+M`): Create a detailed markdown report of request results
- **Generate Code** (`Ctrl+Shift+C` / `Cmd+Shift+C`): Generate C#, JavaScript, or Java code from the current request
- **Manage Auth Profiles**: Create and manage reusable authentication profiles
- **Load Environment File**: Load variables from a .env file
- **Select Environment**: Switch between loaded environments
- **Create Environment File**: Create a new .env file template
- **Enable/Disable Parallel Execution**: Toggle between sequential and parallel request execution
- **Show Environment Variables**: Display current environment variables
- **Show Request History**: View and replay previous requests
- **Clear Request History**: Delete request history

## Configuration

Access settings via `File > Preferences > Settings` and search for "HTTP Vortex":

- `httpVortex.enableCodeLens`: Enable CodeLens markers above requests (default: `true`)
- `httpVortex.timeout`: Request timeout in milliseconds (default: `30000`)
- `httpVortex.followRedirects`: Follow HTTP redirects (default: `true`)
- `httpVortex.validateSSL`: Validate SSL certificates (default: `true`)

## Installation

### From Source

1. Clone the repository:
   ```bash
   git clone https://github.com/jasonheath776/HttpVortex.git
   cd HttpVortex/http-vortex-vscode
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Compile the extension:
   ```bash
   npm run compile
   ```

4. Press `F5` to open a new VS Code window with the extension loaded

### Package and Install

1. Install `vsce` (VS Code Extension Manager):
   ```bash
   npm install -g @vscode/vsce
   ```

2. Package the extension:
   ```bash
   vsce package
   ```

3. Install the `.vsix` file:
   - In VS Code, go to Extensions view
   - Click the "..." menu
   - Select "Install from VSIX..."
   - Choose the generated `.vsix` file

## Examples

### Simple GET Request

```http
@baseUrl = https://jsonplaceholder.typicode.com

### Get Post
GET {{baseUrl}}/posts/1
```

### POST with JSON Body

```http
### Create Post
POST https://jsonplaceholder.typicode.com/posts
Content-Type: application/json

{
  "title": "foo",
  "body": "bar",
  "userId": 1
}
```

### Chained Requests with Variable Capture

```http
@apiUrl = https://api.example.com

### Login
POST {{apiUrl}}/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}

@token = res.data.accessToken
> debug(@token)

### Get Protected Resource
GET {{apiUrl}}/protected/resource
Authorization: Bearer {{token}}
```

## Comparison with Original Neon Playbook

This VS Code extension is based on the Electron desktop application [Neon Playbook](../neon-playbook). Key differences:

| Feature | Electron App | VS Code Extension |
|---------|-------------|-------------------|
| Editor | CodeMirror | VS Code Native |
| UI | React + Tailwind | VS Code Webview |
| File Management | Custom | VS Code Native |
| Auto-save | Custom | VS Code Native |
| Syntax Highlighting | Custom CodeMirror | TextMate Grammar |
| Distribution | Standalone App | Extension Marketplace |

## Development

### Building

```bash
npm run compile
```

### Watching for Changes

```bash
npm run watch
```

### Running Tests

```bash
npm test
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

MIT

## Credits

Based on the Neon Playbook Electron application. Ported to VS Code extension by the community.
