function shellSingleQuote(value) {
    return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function buildMcpArgs(port) {
    return ['--stdio-only', '--port', String(port)];
}

export function buildClaudeCodeCommand(serverPath, port) {
    const payload = JSON.stringify({
        type: 'stdio',
        command: serverPath,
        args: buildMcpArgs(port),
    });
    return `claude mcp add-json -s user rav-mcp ${shellSingleQuote(payload)}`;
}

export function buildClaudeDesktopSnippet(serverPath, port) {
    return JSON.stringify({
        mcpServers: {
            'rav-mcp': {
                command: serverPath,
                args: buildMcpArgs(port),
            },
        },
    }, null, 2);
}

export function buildCodexSnippet(serverPath, port) {
    return [
        '[mcp_servers."rav-mcp"]',
        `command = ${JSON.stringify(serverPath)}`,
        `args = ${JSON.stringify(buildMcpArgs(port))}`,
    ].join('\n');
}

export function buildGenericSnippet(serverPath, port) {
    return JSON.stringify({
        name: 'rav-mcp',
        transport: {
            type: 'stdio',
            command: serverPath,
            args: buildMcpArgs(port),
        },
    }, null, 2);
}

export function setCopyHandlers(dialog, documentRef = globalThis.document, navigatorRef = globalThis.navigator) {
    dialog.querySelectorAll('.mcp-copy-btn').forEach((button) => {
        button.onclick = () => {
            const targetId = button.dataset.target;
            const pre = documentRef.getElementById(targetId);
            if (!pre) {
                return;
            }
            navigatorRef.clipboard.writeText(pre.textContent).then(() => {
                button.textContent = 'COPIED';
                button.classList.add('copied');
                setTimeout(() => {
                    button.textContent = 'COPY';
                    button.classList.remove('copied');
                }, 2000);
            });
        };
    });
}
