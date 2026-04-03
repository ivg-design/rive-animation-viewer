export function reparentErudaContainer(host, documentRef = globalThis.document) {
    if (!host) {
        return;
    }
    const containers = Array.from(documentRef.querySelectorAll('.eruda-container'));
    if (!containers.length) {
        return;
    }
    const target = containers[containers.length - 1];
    if (target.parentElement !== host) {
        host.appendChild(target);
    }
    target.classList.add('rav-eruda');
    containers.forEach((container) => {
        if (container !== target && container.parentElement === documentRef.body) {
            container.remove();
        }
    });
}

export function loadScript(src, documentRef = globalThis.document) {
    return new Promise((resolve, reject) => {
        const existing = documentRef.querySelector(`script[data-src="${src}"]`);
        if (existing) {
            if (existing.dataset.loaded === 'true') {
                resolve();
                return;
            }
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => reject(new Error(`Failed: ${src}`)), { once: true });
            return;
        }
        const script = documentRef.createElement('script');
        script.src = src;
        script.dataset.src = src;
        script.onload = () => {
            script.dataset.loaded = 'true';
            resolve();
        };
        script.onerror = () => reject(new Error(`Failed: ${src}`));
        documentRef.head.appendChild(script);
    });
}

export function sleep(ms, setTimeoutFn = globalThis.setTimeout?.bind(globalThis)) {
    return new Promise((resolve) => setTimeoutFn(resolve, ms));
}
