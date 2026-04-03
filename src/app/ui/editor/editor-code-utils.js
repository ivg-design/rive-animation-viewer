export function createTextareaEditorAdapter(textarea) {
    return {
        dispatch(transaction = {}) {
            const change = transaction?.changes;
            if (!change || typeof change.insert !== 'string') {
                return;
            }
            textarea.value = change.insert;
        },
        dom: textarea,
        state: {
            doc: {
                toString: () => textarea.value,
            },
        },
    };
}

export function replaceOnLoadBlock(code, replacement) {
    const onLoadIdx = code.indexOf('onLoad:');
    if (onLoadIdx === -1) {
        const lastClose = code.lastIndexOf('}');
        if (lastClose === -1) {
            return null;
        }
        const before = code.substring(0, lastClose).trimEnd();
        const needsComma = before.endsWith(',') ? '' : ',';
        return before + needsComma + '\n  ' + replacement.trim() + '\n' + code.substring(lastClose);
    }

    const braceStart = code.indexOf('{', onLoadIdx + 'onLoad:'.length);
    if (braceStart === -1) {
        return null;
    }

    let depth = 0;
    let end = -1;
    for (let index = braceStart; index < code.length; index += 1) {
        if (code[index] === '{') {
            depth += 1;
        } else if (code[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }
    if (end === -1) {
        return null;
    }

    return code.substring(0, onLoadIdx) + replacement.trim() + code.substring(end + 1);
}

export function extractBraceBlock(text, onLoadIdx, prefix) {
    const braceStart = text.indexOf('{', onLoadIdx + prefix.length);
    if (braceStart === -1) {
        return null;
    }

    let depth = 0;
    let end = -1;
    for (let index = braceStart; index < text.length; index += 1) {
        if (text[index] === '{') {
            depth += 1;
        } else if (text[index] === '}') {
            depth -= 1;
            if (depth === 0) {
                end = index;
                break;
            }
        }
    }
    if (end === -1) {
        return null;
    }

    return text.substring(onLoadIdx, end + 1);
}

export function evaluateEditorConfig(code, evalFn = eval) {
    const trimmed = String(code || '').trim();
    if (!trimmed) {
        return {};
    }

    let result;
    try {
        result = evalFn(`(function() {
            return (
                ${trimmed}
            );
        })()`);
    } catch (error) {
        throw new Error(`Invalid JavaScript config: ${error.message}`);
    }

    if (!result || Array.isArray(result) || typeof result !== 'object') {
        throw new Error('Initialization config must return an object');
    }

    return result;
}

export function hasVmExplorerSnippet(code) {
    const text = String(code || '');
    return text.includes('vmExplore') || text.includes('vmRootInstance');
}
