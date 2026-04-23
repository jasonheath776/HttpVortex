/**
 * snippetsProvider.ts — HTTP request snippet completion provider for VS Code
 */

import * as vscode from 'vscode';

export class HttpSnippetsProvider implements vscode.CompletionItemProvider {
  private snippets = [
    {
      group: 'HTTP Methods',
      items: [
        {
          label: 'GET',
          hint: 'Read a resource',
          detail: 'Simple GET request with headers',
          snippet: '### ${1:GET Request}\nGET ${2:{{baseUrl\\}\\}/endpoint}\nAuthorization: Bearer {{token}}\nAccept: application/json\n',
        },
        {
          label: 'POST',
          hint: 'Create with JSON body',
          detail: 'POST request with JSON body',
          snippet: '### ${1:POST Request}\nPOST ${2:{{baseUrl\\}\\}/endpoint}\nContent-Type: application/json\nAuthorization: Bearer {{token}}\n\n{\n  ${3:"key": "value"}\n}\n',
        },
        {
          label: 'PUT',
          hint: 'Replace with JSON body',
          detail: 'PUT request with JSON body',
          snippet: '### ${1:PUT Request}\nPUT ${2:{{baseUrl\\}\\}/endpoint}\nContent-Type: application/json\nAuthorization: Bearer {{token}}\n\n{\n  ${3:"key": "value"}\n}\n',
        },
        {
          label: 'PATCH',
          hint: 'Partial update with JSON body',
          detail: 'PATCH request with JSON body',
          snippet: '### ${1:PATCH Request}\nPATCH ${2:{{baseUrl\\}\\}/endpoint}\nContent-Type: application/json\nAuthorization: Bearer {{token}}\n\n{\n  ${3:"key": "value"}\n}\n',
        },
        {
          label: 'DELETE',
          hint: 'Remove a resource',
          detail: 'DELETE request',
          snippet: '### ${1:DELETE Request}\nDELETE ${2:{{baseUrl\\}\\}/endpoint}\nAuthorization: Bearer {{token}}\n',
        },
      ],
    },
    {
      group: 'Authentication',
      items: [
        {
          label: 'Bearer Token',
          hint: 'OAuth2 Bearer Token',
          detail: 'Authorization: Bearer token pattern',
          snippet: 'Authorization: Bearer ${1:{{token\\}\\}}',
        },
        {
          label: 'Basic Auth',
          hint: 'HTTP Basic Authentication',
          detail: 'Authorization: Basic pattern',
          snippet: 'Authorization: Basic ${1:base64encodedcredentials}',
        },
        {
          label: 'API Key',
          hint: 'API Key header',
          detail: 'X-API-Key header pattern',
          snippet: 'X-API-Key: ${1:{{apiKey\\}\\}}',
        },
        {
          label: 'OAuth2 Token Request',
          hint: 'OAuth2 client_credentials flow',
          detail: 'Get access token from identity server',
          snippet: '### ${1:Get Access Token}\n@idpUrl = ${2:https://your-identityserver}\n\nPOST {{idpUrl}}/connect/token\nContent-Type: application/x-www-form-urlencoded\n\ngrant_type=client_credentials&client_id=${3:your-client}&client_secret=${4:your-secret}&scope=${5:your-scope}\n\n@token = res.data.access_token\n',
        },
      ],
    },
    {
      group: 'Headers',
      items: [
        {
          label: 'Content-Type JSON',
          hint: 'JSON content type',
          detail: 'Content-Type: application/json',
          snippet: 'Content-Type: application/json',
        },
        {
          label: 'Content-Type XML',
          hint: 'XML content type',
          detail: 'Content-Type: application/xml',
          snippet: 'Content-Type: application/xml',
        },
        {
          label: 'Content-Type Form',
          hint: 'Form-encoded content type',
          detail: 'Content-Type: application/x-www-form-urlencoded',
          snippet: 'Content-Type: application/x-www-form-urlencoded',
        },
        {
          label: 'Accept JSON',
          hint: 'Accept JSON response',
          detail: 'Accept: application/json',
          snippet: 'Accept: application/json',
        },
        {
          label: 'User-Agent',
          hint: 'User-Agent header',
          detail: 'User-Agent header pattern',
          snippet: 'User-Agent: ${1:MyApp/1.0}',
        },
      ],
    },
    {
      group: 'Variables & Capture',
      items: [
        {
          label: '@variable declaration',
          hint: 'Declare a global variable',
          detail: '@varName = value',
          snippet: '@${1:varName} = ${2:value}',
        },
        {
          label: '@capture from response',
          hint: 'Capture value from response',
          detail: '@varName = res.data.path',
          snippet: '@${1:varName} = res.data.${2:path}',
        },
        {
          label: '> debug statement',
          hint: 'Debug print expression',
          detail: '> debug(@varName) or > debug(res.data.field)',
          snippet: '> debug(${1:@varName})',
        },
      ],
    },
    {
      group: 'JSON Bodies',
      items: [
        {
          label: 'Empty JSON Object',
          hint: 'Empty JSON object',
          detail: '{}',
          snippet: '{\n  ${1}\n}',
        },
        {
          label: 'JSON Key-Value',
          hint: 'JSON with key-value pair',
          detail: '{ "key": "value" }',
          snippet: '{\n  "${1:key}": "${2:value}"\n}',
        },
        {
          label: 'JSON Array',
          hint: 'JSON array of objects',
          detail: '[{ ... }]',
          snippet: '[\n  {\n    "${1:key}": "${2:value}"\n  }\n]',
        },
      ],
    },
    {
      group: 'MIME Types',
      items: [
        {
          label: 'text/plain',
          hint: 'Plain text',
          detail: 'Content-Type: text/plain',
          snippet: 'Content-Type: text/plain',
        },
        {
          label: 'text/html',
          hint: 'HTML content',
          detail: 'Content-Type: text/html',
          snippet: 'Content-Type: text/html',
        },
        {
          label: 'text/csv',
          hint: 'CSV data',
          detail: 'Content-Type: text/csv',
          snippet: 'Content-Type: text/csv',
        },
        {
          label: 'application/json',
          hint: 'JSON data',
          detail: 'Content-Type: application/json',
          snippet: 'Content-Type: application/json',
        },
        {
          label: 'application/xml',
          hint: 'XML data',
          detail: 'Content-Type: application/xml',
          snippet: 'Content-Type: application/xml',
        },
        {
          label: 'application/x-www-form-urlencoded',
          hint: 'URL-encoded form data',
          detail: 'Content-Type: application/x-www-form-urlencoded',
          snippet: 'Content-Type: application/x-www-form-urlencoded',
        },
        {
          label: 'multipart/form-data',
          hint: 'Multipart form data (file uploads)',
          detail: 'Content-Type: multipart/form-data',
          snippet: 'Content-Type: multipart/form-data',
        },
        {
          label: 'application/octet-stream',
          hint: 'Binary / arbitrary data',
          detail: 'Content-Type: application/octet-stream',
          snippet: 'Content-Type: application/octet-stream',
        },
        {
          label: 'application/pdf',
          hint: 'PDF document',
          detail: 'Content-Type: application/pdf',
          snippet: 'Content-Type: application/pdf',
        },
        {
          label: 'application/graphql',
          hint: 'GraphQL query body',
          detail: 'Content-Type: application/graphql',
          snippet: 'Content-Type: application/graphql',
        },
        {
          label: 'image/png',
          hint: 'PNG image',
          detail: 'Content-Type: image/png',
          snippet: 'Content-Type: image/png',
        },
        {
          label: 'image/jpeg',
          hint: 'JPEG image',
          detail: 'Content-Type: image/jpeg',
          snippet: 'Content-Type: image/jpeg',
        },
        {
          label: 'Accept: */*',
          hint: 'Accept any response type',
          detail: 'Accept: */*',
          snippet: 'Accept: */*',
        },
        {
          label: 'Accept: text/plain',
          hint: 'Accept plain text response',
          detail: 'Accept: text/plain',
          snippet: 'Accept: text/plain',
        },
        {
          label: 'Accept: text/html',
          hint: 'Accept HTML response',
          detail: 'Accept: text/html',
          snippet: 'Accept: text/html',
        },
      ],
    },
    {
      group: 'Query Parameters',
      items: [
        {
          label: 'Single Parameter',
          hint: 'Single query parameter',
          detail: '?key=value',
          snippet: '?${1:key}=${2:value}',
        },
        {
          label: 'Multiple Parameters',
          hint: 'Multiple query parameters',
          detail: '?key1=value1&key2=value2',
          snippet: '?${1:key1}=${2:value1}&${3:key2}=${4:value2}',
        },
      ],
    },
  ];

  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    token: vscode.CancellationToken,
    context: vscode.CompletionContext
  ): vscode.CompletionItem[] {
    const completionItems: vscode.CompletionItem[] = [];

    for (const group of this.snippets) {
      for (const item of group.items) {
        const completionItem = new vscode.CompletionItem(
          item.label,
          vscode.CompletionItemKind.Snippet
        );
        completionItem.insertText = new vscode.SnippetString(item.snippet);
        completionItem.detail = item.detail;
        completionItem.documentation = item.hint;
        completionItem.sortText = `${group.group}_${item.label}`;
        completionItem.filterText = item.label;
        completionItems.push(completionItem);
      }
    }

    return completionItems;
  }

  resolveCompletionItem(
    item: vscode.CompletionItem,
    token: vscode.CancellationToken
  ): vscode.CompletionItem {
    return item;
  }
}

/**
 * Register the snippets provider with VS Code
 */
export function registerSnippetsProvider(context: vscode.ExtensionContext): void {
  const selector: vscode.DocumentSelector = [
    { language: 'http', scheme: 'file' },
    { language: 'http', scheme: 'untitled' },
  ];

  const provider = new HttpSnippetsProvider();
  const disposable = vscode.languages.registerCompletionItemProvider(selector, provider, '@', '>', '?');
  context.subscriptions.push(disposable);
}
